from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from psycopg2.extras import execute_values
from .config import EMB_MODEL, GREEN, YELLOW, BLUE, RESET

_EMBED_WRITE_BATCH = 500

_UPSERT_EMBEDDING = """
    UPDATE papers AS p SET embedding = v.embedding
    FROM (VALUES %s) AS v(id, embedding)
    WHERE p.id = v.id
"""


# -------- Upsert / fetch --------

def upsert_embedding(conn, paper_id: str, model: str, vec: np.ndarray) -> None:
    vec = vec.astype(np.float32)
    vec = vec / (np.linalg.norm(vec) + 1e-12)
    conn.execute(
        "UPDATE papers SET embedding = %s WHERE id = %s",
        (vec.tolist(), paper_id),
    )


def fetch_existing_embeddings(conn, paper_ids: List[str], model: str) -> Dict[str, np.ndarray]:
    """Return {paper_id: None} for IDs that already have an embedding.

    Callers only check presence (`pid in existing`) — the embedding vectors
    themselves are never read back out, so we avoid pulling them over the
    wire (which is enough data to trip a remote DB's statement timeout).
    """
    if not paper_ids:
        return {}
    rows = conn.execute(
        "SELECT id FROM papers WHERE embedding IS NOT NULL AND id = ANY(%s)",
        (paper_ids,),
    ).fetchall()
    return {row[0]: None for row in rows}


# -------- Embedding model --------

class EmbeddingGenerator:
    def __init__(self, batch_size: int = 32, device: Optional[str] = "auto"):
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
    def encode(self, titles: List[str], summaries: List[str]) -> np.ndarray:
        import time
        from transformers import AutoTokenizer
        from adapters import AutoAdapterModel
        import torch

        torch.set_grad_enabled(False)
        tokenizer = AutoTokenizer.from_pretrained("allenai/specter2_base")
        model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
        model.load_adapter("allenai/specter2", source="hf", load_as="specter2", set_active=True)
        model.eval().to(self.device)

        sep = tokenizer.sep_token
        texts = [(t or "") + sep + (s or "") for t, s in zip(titles, summaries)]
        chunks: List[np.ndarray] = []

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
    meta: Dict[str, Tuple[Optional[str], Optional[str]]] = {
        row[0]: (row[1], row[2]) for row in rows
    }

    titles: List[str] = []
    sums: List[str] = []
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
        for pid, vec in zip(chunk_ids, chunk_vecs):
            v = vec.astype(np.float32)
            v = v / (np.linalg.norm(v) + 1e-12)
            rows.append((pid, v.tolist()))
        execute_values(write_cur, _UPSERT_EMBEDDING, rows, template="(%s, %s::vector)")
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
