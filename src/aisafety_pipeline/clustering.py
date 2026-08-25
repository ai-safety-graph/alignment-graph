from __future__ import annotations
import numpy as np, pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import normalize
from .config import GREEN, YELLOW, BLUE, RESET
from .embeddings import upsert_embedding, fetch_existing_embeddings, EmbeddingGenerator
from .filters import load_vectors

## Contributed by mnm-matin
class ClusterManager:
    def __init__(self, embeddings: np.ndarray, normalise: bool = True, pca_dim: int | None = None):
        embs = embeddings
        if pca_dim is not None:
            embs = PCA(n_components=pca_dim).fit_transform(embs)
        self.embeddings = normalize(embs, axis=1) if normalise else embs
    def kmeans(self, n_clusters: int = 8, random_state: int = 42, n_init: int = 10):
        from sklearn.cluster import KMeans
        km = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=n_init)
        return km.fit_predict(self.embeddings)


_GET_PAPERS_CHUNK = 5000


def get_papers(conn, only_kept=True) -> pd.DataFrame:
    # Paginated by id (keyset, not OFFSET) rather than one single-shot SELECT:
    # title/summary are large TOASTed text columns, and fetching all of them
    # for the full kept set in one statement can exceed a hosted DB's
    # statement_timeout even though the query plan itself is fine.
    cond = "ai_stage2_keep" if only_kept else "TRUE"
    rows_all = []
    last_id = ""
    while True:
        page = conn.execute(
            f"SELECT id, title, summary FROM papers WHERE {cond} AND id > %s ORDER BY id LIMIT %s",
            (last_id, _GET_PAPERS_CHUNK),
        ).fetchall()
        if not page:
            break
        rows_all.extend(page)
        last_id = page[-1]["id"]
        if len(page) < _GET_PAPERS_CHUNK:
            break
    return pd.DataFrame([list(r) for r in rows_all], columns=["id", "title", "summary"])


def compute_and_store_missing_embeddings(conn, df: pd.DataFrame, device="auto"):
    ids = df["id"].tolist()
    existing = fetch_existing_embeddings(conn, ids, "specter2")
    missing_mask = ~df["id"].isin(existing.keys())
    if not missing_mask.any():
        print(f"{GREEN}All embeddings already present (model=specter2).{RESET}")
        return
    missing_df = df.loc[missing_mask].reset_index(drop=True)
    print(f"{BLUE}Computing embeddings for {len(missing_df)} new papers…{RESET}")
    eg = EmbeddingGenerator(batch_size=32, device=device)
    embs = eg.encode(missing_df["title"].tolist(), missing_df["summary"].tolist())
    cur = conn.cursor(); cur.execute("BEGIN")
    for pid, vec in zip(missing_df["id"].tolist(), embs):
        upsert_embedding(conn, pid, "specter2", vec)
    cur.execute("COMMIT")
    print(f"{GREEN}Stored {len(missing_df)} embeddings.{RESET}")


def load_embeddings_for_df(conn, df: pd.DataFrame) -> np.ndarray:
    ids = df["id"].tolist()
    by_id = load_vectors(conn, ids)
    mat = np.vstack([by_id[pid] for pid in ids])
    return mat


def cmd_cluster(args):
    from .db import connect
    conn = connect(args.db)
    try:
        df = get_papers(conn, only_kept=True)
        if df.empty:
            print(f"{YELLOW}cluster:{RESET} nothing to cluster (ai_stage2_keep=1 is empty)."); return
        compute_and_store_missing_embeddings(conn, df, device=args.device)
        embeddings = load_embeddings_for_df(conn, df)
        print(f"{BLUE}Embeddings loaded:{RESET} {embeddings.shape}")
        print(f"{BLUE}Clustering…{RESET}")
        cm = ClusterManager(embeddings, normalise=True, pca_dim=args.reduce_dim)
        df["kmeans_cluster"] = cm.kmeans(n_clusters=args.kmeans)
        cur = conn.cursor(); cur.execute("BEGIN")
        for pid, k in df[["id", "kmeans_cluster"]].itertuples(index=False, name=None):
            cur.execute("UPDATE papers SET kmeans_cluster=? WHERE id=?", (int(k), pid))
        cur.execute("COMMIT")
        print(f"{GREEN}clusters updated.{RESET}")
    finally:
        conn.close()
