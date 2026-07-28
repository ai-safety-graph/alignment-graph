from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from .config import EMB_MODEL, GREEN, YELLOW, BLUE, RESET


# -------- Upsert / fetch --------

def upsert_embedding(conn, paper_id: str, model: str, vec: np.ndarray) -> None:
    vec = vec.astype(np.float32)
    vec = vec / (np.linalg.norm(vec) + 1e-12)
    conn.execute(
        "UPDATE papers SET embedding = %s WHERE id = %s",
        (vec.tolist(), paper_id),
    )


def fetch_existing_embeddings(conn, paper_ids: List[str], model: str) -> Dict[str, np.ndarray]:
    """Return {paper_id: vector} for the given IDs."""
    if not paper_ids:
        return {}
    out: Dict[str, np.ndarray] = {}
    rows = conn.execute(
        "SELECT id, embedding FROM papers WHERE embedding IS NOT NULL AND id = ANY(%s)",
        (paper_ids,),
    ).fetchall()
    for pid, vec in rows:
        if vec is not None:
            out[pid] = np.array(vec, dtype=np.float32)
    return out


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

        for i in range(0, len(texts), self.batch_size):
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

        embs = np.concatenate(chunks, axis=0)
        embs = embs / (np.linalg.norm(embs, axis=1, keepdims=True) + 1e-12)
        return embs.astype(np.float32)
######

# -------- Pipeline entry points --------

def ensure_embeddings_for_candidates(conn, device: str = "auto") -> None:
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
    embs = EmbeddingGenerator(batch_size=32, device=device).encode(titles, sums)

    cur = conn.cursor()
    cur.execute("BEGIN")
    try:
        for pid, vec in zip(missing, embs):
            upsert_embedding(conn, pid, EMB_MODEL, vec)
        cur.execute("COMMIT")
    except Exception:
        cur.execute("ROLLBACK")
        raise

    print(f"{GREEN}embed:{RESET} added {len(missing)} embeddings.")


def cmd_embed(args) -> None:
    from .db import connect
    conn = connect(args.db)
    try:
        ensure_embeddings_for_candidates(conn, device=args.device)
    finally:
        conn.close()
