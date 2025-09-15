from __future__ import annotations
import numpy as np, sqlite3
from typing import Dict, List, Optional
from .config import EMB_MODEL, GREEN, YELLOW, BLUE, RESET

# Byte helpers

def bytes_from_vec(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def vec_from_bytes(blob: bytes, dim: int) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32, count=dim)


def upsert_embedding(conn: sqlite3.Connection, paper_id: str, model: str, vec: np.ndarray):
    vec = vec.astype(np.float32)
    vec = vec / (np.linalg.norm(vec) + 1e-12)
    conn.execute(
        """
        INSERT INTO embeddings (paper_id, model, dim, vector)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(paper_id) DO UPDATE SET model=excluded.model, dim=excluded.dim, vector=excluded.vector
        """,
        (paper_id, model, vec.shape[0], sqlite3.Binary(bytes_from_vec(vec)))
    )


def fetch_existing_embeddings(conn: sqlite3.Connection, paper_ids: List[str], model: str) -> Dict[str, np.ndarray]:
    if not paper_ids:
        return {}
    placeholders = ",".join(["?"] * len(paper_ids))
    rows = conn.execute(
        f"SELECT paper_id, dim, vector FROM embeddings WHERE model=? AND paper_id IN ({placeholders})",
        (model, *paper_ids)
    ).fetchall()
    out = {}
    for pid, dim, blob in rows:
        out[pid] = vec_from_bytes(blob, dim)
    return out

## Contributed by mnm-matin
class EmbeddingGenerator:
    def __init__(self, batch_size: int = 32, device: Optional[str] = "auto"):
        try:
            import torch  # noqa
        except ImportError as e:
            raise SystemExit("PyTorch is required for embedding.") from e
        self.batch_size = batch_size
        self.device = self._select_device(device or "auto")

    @staticmethod
    def _select_device(requested: str) -> str:
        import torch
        req = (requested or "auto").lower()
        def _have_cuda() -> bool:
            try: return torch.cuda.is_available()
            except Exception: return False
        def _have_mps() -> bool:
            try: return torch.backends.mps.is_available()
            except Exception: return False
        if req == "auto":
            if _have_cuda(): return "cuda"
            if _have_mps(): return "mps"
            return "cpu"
        if req.startswith("cuda"):
            if not _have_cuda():
                raise SystemExit("Requested CUDA, but torch.cuda.is_available() is False.")
            return req
        if req == "mps":
            if not _have_mps():
                raise SystemExit("Requested MPS, but torch.backends.mps.is_available() is False.")
            return "mps"
        if req == "cpu": return "cpu"
        raise SystemExit(f"Unknown device specifier: {requested!r}.")

    def encode(self, titles: List[str], summaries: List[str]) -> np.ndarray:
        from transformers import AutoTokenizer
        from adapters import AutoAdapterModel
        import torch, numpy as np
        torch.set_grad_enabled(False)
        tokenizer = AutoTokenizer.from_pretrained("allenai/specter2_base")
        model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
        model.load_adapter("allenai/specter2", source="hf", load_as="specter2", set_active=True)
        model.eval().to(self.device)
        sep = tokenizer.sep_token
        texts = [(t or "") + sep + (s or "") for t, s in zip(titles, summaries)]
        chunks = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            inputs = tokenizer(batch, padding=True, truncation=True, return_tensors="pt", return_token_type_ids=False, max_length=512)
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            with torch.inference_mode():
                out = model(**inputs)
            cls = out.last_hidden_state[:, 0, :].detach().cpu().numpy()
            chunks.append(cls)
        embs = np.concatenate(chunks, axis=0)
        embs = embs / (np.linalg.norm(embs, axis=1, keepdims=True) + 1e-12)
        return embs.astype(np.float32)


def ensure_embeddings_for_candidates(conn, device="auto"):
    ids = [row[0] for row in conn.execute("SELECT id FROM papers").fetchall()]
    if not ids:
        print(f"{YELLOW}embed:{RESET} no rows in `papers`. Run stage1 first."); return
    have = fetch_existing_embeddings(conn, ids, EMB_MODEL)
    missing = [pid for pid in ids if pid not in have]
    if not missing:
        print(f"{GREEN}embed:{RESET} all embeddings present."); return
    titles, sums = zip(*conn.execute(
        f"SELECT title, summary FROM papers WHERE id IN ({','.join(['?']*len(missing))})", missing
    ).fetchall())
    print(f"{BLUE}embed:{RESET} computing embeddings for {len(missing)} papers…")
    embs = EmbeddingGenerator(batch_size=32, device=device).encode(list(titles), list(sums))
    cur = conn.cursor(); cur.execute("BEGIN")
    for pid, vec in zip(missing, embs):
        upsert_embedding(conn, pid, EMB_MODEL, vec)
    cur.execute("COMMIT")
    print(f"{GREEN}embed:{RESET} added {len(missing)} embeddings.")


def cmd_embed(args):
    import sqlite3
    conn = sqlite3.connect(args.db)
    try:
        ensure_embeddings_for_candidates(conn, device=args.device)
    finally:
        conn.close()