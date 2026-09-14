from __future__ import annotations

import numpy as np
from psycopg2.extras import execute_values

from .config import BLUE, EMB_MODEL, GREEN, RESET, TOPIC_EMB_MODEL, YELLOW

_EMBED_WRITE_BATCH = 500

# Column each model's vectors live in. The column name only ever comes from
# this fixed internal dict, never caller-supplied text, so the f-string
# interpolations below have no injection surface.
_MODEL_COLUMNS = {
    "specter2": "embedding",
    "topic": "embedding_topic",
}


def _upsert_sql(model: str) -> str:
    col = _MODEL_COLUMNS[model]
    return f"""
        UPDATE papers AS p SET {col} = v.embedding
        FROM (VALUES %s) AS v(id, embedding)
        WHERE p.id = v.id
    """


# -------- Upsert / fetch --------

def upsert_embedding(conn, paper_id: str, model: str, vec: np.ndarray) -> None:
    col = _MODEL_COLUMNS[model]
    vec = vec.astype(np.float32)
    vec = vec / (np.linalg.norm(vec) + 1e-12)
    conn.execute(
        f"UPDATE papers SET {col} = %s WHERE id = %s",
        (vec.tolist(), paper_id),
    )


def fetch_existing_embeddings(conn, paper_ids: list[str], model: str) -> dict[str, np.ndarray]:
    """Return {paper_id: None} for IDs that already have an embedding.

    Callers only check presence (`pid in existing`) — the embedding vectors
    themselves are never read back out, so we avoid pulling them over the
    wire (which is enough data to trip a remote DB's statement timeout).
    """
    if not paper_ids:
        return {}
    col = _MODEL_COLUMNS[model]
    rows = conn.execute(
        f"SELECT id FROM papers WHERE {col} IS NOT NULL AND id = ANY(%s)",
        (paper_ids,),
    ).fetchall()
    return {row[0]: None for row in rows}


# -------- Embedding model --------

class EmbeddingGenerator:
    def __init__(self, batch_size: int = 32, device: str | None = "auto"):
        try:
            import torch  # noqa: F401
        except ImportError as e:
            raise SystemExit("PyTorch is required for embedding.") from e
        self.batch_size = batch_size
        self.device = self._select_device(device or "auto")

    @staticmethod
    def _select_device(requested: str) -> str:
        import torch

        req = (requested or "auto").lower()

        def _have_cuda() -> bool:
            try:
                return torch.cuda.is_available()
            except Exception:
                return False

        def _have_mps() -> bool:
            try:
                return torch.backends.mps.is_available()
            except Exception:
                return False

        if req == "auto":
            if _have_cuda():
                return "cuda"
            if _have_mps():
                return "mps"
            return "cpu"
        if req.startswith("cuda"):
            if not _have_cuda():
                raise SystemExit("Requested CUDA, but torch.cuda.is_available() is False.")
            return req
        if req == "mps":
            if not _have_mps():
                raise SystemExit("Requested MPS, but torch.backends.mps.is_available() is False.")
            return "mps"
        if req == "cpu":
            return "cpu"
        raise SystemExit(f"Unknown device specifier: {requested!r}.")

### Contributed by mnm-matin ###
    def encode(self, titles: list[str], summaries: list[str]) -> np.ndarray:
        import time

        import torch
        from adapters import AutoAdapterModel
        from transformers import AutoTokenizer

        torch.set_grad_enabled(False)
        tokenizer = AutoTokenizer.from_pretrained("allenai/specter2_base")
        model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
        model.load_adapter("allenai/specter2", source="hf", load_as="specter2", set_active=True)
        model.eval().to(self.device)

        sep = tokenizer.sep_token
        texts = [(t or "") + sep + (s or "") for t, s in zip(titles, summaries, strict=True)]
        chunks: list[np.ndarray] = []

        total = len(texts)
        n_batches = (total + self.batch_size - 1) // self.batch_size
        start = time.monotonic()
        for bi, i in enumerate(range(0, total, self.batch_size), start=1):
            batch = texts[i : i + self.batch_size]
            inputs = tokenizer(
                batch,
                padding=True,
                truncation=True,
                return_tensors="pt",
                return_token_type_ids=False,
                max_length=512,
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            with torch.inference_mode():
                out = model(**inputs)
            cls = out.last_hidden_state[:, 0, :].detach().cpu().numpy()
            chunks.append(cls)

            done = min(i + self.batch_size, total)
            if bi % 10 == 0 or bi == n_batches:
                elapsed = time.monotonic() - start
                rate = done / elapsed if elapsed > 0 else 0.0
                eta_s = (total - done) / rate if rate > 0 else float("inf")
                print(
                    f"{BLUE}embed encode:{RESET} {done}/{total} "
                    f"({rate:.1f} papers/s, ETA {eta_s/60:.1f} min)"
                )

        embs = np.concatenate(chunks, axis=0)
        embs = embs / (np.linalg.norm(embs, axis=1, keepdims=True) + 1e-12)
        return embs.astype(np.float32)
######

# -------- Topic embedding model (tagging / search / graph layout) --------

_BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def _apply_query_prefix(texts: list[str]) -> list[str]:
    """BGE's documented asymmetric convention: queries get this prefix,
    passages/documents get none. Kept as a standalone pure function so it's
    unit-testable without loading a model.
    """
    return [_BGE_QUERY_PREFIX + (t or "") for t in texts]


class TopicEmbeddingGenerator:
    """BGE-based encoder for tagging, semantic search, and the graph layout.

    SPECTER2 (EmbeddingGenerator, above) is trained on citation proximity --
    a poor fit for matching against generic topic phrases or short queries,
    which is what this encoder is for instead.
    """

    def __init__(self, batch_size: int = 32, device: str | None = "auto"):
        try:
            import torch  # noqa: F401
        except ImportError as e:
            raise SystemExit("PyTorch is required for embedding.") from e
        self.batch_size = batch_size
        self.device = EmbeddingGenerator._select_device(device or "auto")
        self._model = None

    def _load_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(TOPIC_EMB_MODEL, device=self.device)
        return self._model

    def encode_passages(self, texts: list[str]) -> np.ndarray:
        """Encode documents (papers, taxonomy phrases) -- no prefix."""
        model = self._load_model()
        embs = model.encode(
            [t or "" for t in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(embs, dtype=np.float32)

    def encode_queries(self, texts: list[str]) -> np.ndarray:
        """Encode search queries -- BGE query prefix applied."""
        model = self._load_model()
        embs = model.encode(
            _apply_query_prefix(texts),
            batch_size=self.batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(embs, dtype=np.float32)


# -------- Pipeline entry points --------

def ensure_embeddings_for_candidates(conn, device: str = "auto", batch_size: int = 32) -> None:
    ids = [row[0] for row in conn.execute("SELECT id FROM papers").fetchall()]
    if not ids:
        print(f"{YELLOW}embed:{RESET} no rows in `papers`. Run stage1 first.")
        return

    have = fetch_existing_embeddings(conn, ids, EMB_MODEL)
    missing = [pid for pid in ids if pid not in have]
    if not missing:
        print(f"{GREEN}embed:{RESET} all embeddings present.")
        return

    # Fetch titles/summaries for missing
    rows = conn.execute(
        "SELECT id, title, summary FROM papers WHERE id = ANY(%s)",
        (missing,),
    ).fetchall()
    meta: dict[str, tuple[str | None, str | None]] = {
        row[0]: (row[1], row[2]) for row in rows
    }

    titles: list[str] = []
    sums: list[str] = []
    for pid in missing:
        t, s = meta.get(pid, ("", ""))
        titles.append(t or "")
        sums.append(s or "")

    print(f"{BLUE}embed:{RESET} computing embeddings for {len(missing)} papers…")
    embs = EmbeddingGenerator(batch_size=batch_size, device=device).encode(titles, sums)

    write_cur = conn.raw_cursor()
    written = 0
    for i in range(0, len(missing), _EMBED_WRITE_BATCH):
        chunk_ids = missing[i:i + _EMBED_WRITE_BATCH]
        chunk_vecs = embs[i:i + _EMBED_WRITE_BATCH]
        rows = []
        for pid, vec in zip(chunk_ids, chunk_vecs, strict=True):
            v = vec.astype(np.float32)
            v = v / (np.linalg.norm(v) + 1e-12)
            rows.append((pid, v.tolist()))
        execute_values(write_cur, _upsert_sql("specter2"), rows, template="(%s, %s::vector)")
        conn.commit()
        written += len(rows)
        print(f"{BLUE}embed progress:{RESET} {written}/{len(missing)} written")

    print(f"{GREEN}embed:{RESET} added {written} embeddings.")


def cmd_embed(args) -> None:
    from .db import connect
    conn = connect(args.db)
    try:
        ensure_embeddings_for_candidates(conn, device=args.device, batch_size=args.batch_size)
    finally:
        conn.close()


def ensure_topic_embeddings_for_candidates(conn, device: str = "auto", batch_size: int = 32) -> None:
    # Unlike SPECTER2 embeddings (needed for every stage-1 candidate so the
    # stage-2 filter has vectors to decide keep/reject), the topic embedding
    # only feeds tag/search/compute-layout, which only ever look at kept
    # papers -- so embedding rejected papers here would be pure waste.
    ids = [row[0] for row in conn.execute("SELECT id FROM papers WHERE ai_stage2_keep").fetchall()]
    if not ids:
        print(f"{YELLOW}embed-topic:{RESET} no kept rows in `papers`. Run stage1 & filter first.")
        return

    have = fetch_existing_embeddings(conn, ids, "topic")
    missing = [pid for pid in ids if pid not in have]
    if not missing:
        print(f"{GREEN}embed-topic:{RESET} all embeddings present.")
        return

    rows = conn.execute(
        "SELECT id, title, summary FROM papers WHERE id = ANY(%s)",
        (missing,),
    ).fetchall()
    meta: dict[str, tuple[str | None, str | None]] = {
        row[0]: (row[1], row[2]) for row in rows
    }

    texts: list[str] = []
    for pid in missing:
        t, s = meta.get(pid, ("", ""))
        texts.append(f"{t or ''}\n{s or ''}")

    print(f"{BLUE}embed-topic:{RESET} computing embeddings for {len(missing)} papers…")
    embs = TopicEmbeddingGenerator(batch_size=batch_size, device=device).encode_passages(texts)

    write_cur = conn.raw_cursor()
    written = 0
    for i in range(0, len(missing), _EMBED_WRITE_BATCH):
        chunk_ids = missing[i:i + _EMBED_WRITE_BATCH]
        chunk_vecs = embs[i:i + _EMBED_WRITE_BATCH]
        rows = []
        for pid, vec in zip(chunk_ids, chunk_vecs, strict=True):
            v = vec.astype(np.float32)
            v = v / (np.linalg.norm(v) + 1e-12)
            rows.append((pid, v.tolist()))
        execute_values(write_cur, _upsert_sql("topic"), rows, template="(%s, %s::vector)")
        conn.commit()
        written += len(rows)
        print(f"{BLUE}embed-topic progress:{RESET} {written}/{len(missing)} written")

    print(f"{GREEN}embed-topic:{RESET} added {written} embeddings.")


def cmd_embed_topic(args) -> None:
    from .db import connect
    conn = connect(args.db)
    try:
        ensure_topic_embeddings_for_candidates(conn, device=args.device, batch_size=args.batch_size)
    finally:
        conn.close()
