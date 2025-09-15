from __future__ import annotations
import sqlite3, numpy as np, pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import normalize
from .config import GREEN, YELLOW, BLUE, RESET
from .embeddings import vec_from_bytes, upsert_embedding, fetch_existing_embeddings, EmbeddingGenerator

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
    def agglomerative(self, n_clusters: int = 8, linkage: str = 'ward'):
        from sklearn.cluster import AgglomerativeClustering
        ac = AgglomerativeClustering(n_clusters=n_clusters, linkage=linkage)
        return ac.fit_predict(self.embeddings)
    def hdbscan(self, min_cluster_size: int = 10, **kwargs):
        import hdbscan
        cl = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, **kwargs)
        return cl.fit_predict(self.embeddings)


def get_papers(conn: sqlite3.Connection, only_kept=True) -> pd.DataFrame:
    if only_kept:
        return pd.read_sql_query("SELECT id, title, summary FROM papers WHERE ai_stage2_keep=1", conn)
    return pd.read_sql_query("SELECT id, title, summary FROM papers", conn)


def compute_and_store_missing_embeddings(conn: sqlite3.Connection, df: pd.DataFrame, device="auto"):
    ids = df["id"].tolist()
    existing = fetch_existing_embeddings(conn, ids, "specter2")
    missing_mask = ~df["id"].isin(existing.keys())
    if not missing_mask.any():
        print(f"{GREEN}All embeddings already present in SQLite (model=specter2).{RESET}")
        return
    missing_df = df.loc[missing_mask].reset_index(drop=True)
    print(f"{BLUE}Computing embeddings for {len(missing_df)} new papers…{RESET}")
    eg = EmbeddingGenerator(batch_size=32, device=device)
    embs = eg.encode(missing_df["title"].tolist(), missing_df["summary"].tolist())
    cur = conn.cursor(); cur.execute("BEGIN")
    for pid, vec in zip(missing_df["id"].tolist(), embs):
        upsert_embedding(conn, pid, "specter2", vec)
    cur.execute("COMMIT")
    print(f"{GREEN}Stored {len(missing_df)} embeddings in SQLite.{RESET}")


def load_embeddings_for_df(conn: sqlite3.Connection, df: pd.DataFrame) -> np.ndarray:
    ids = df["id"].tolist()
    placeholders = ",".join(["?"] * len(ids))
    rows = conn.execute(
        f"SELECT paper_id, dim, vector FROM embeddings WHERE model=? AND paper_id IN ({placeholders})",
        ("specter2", *ids)
    ).fetchall()
    by_id = {pid: vec_from_bytes(blob, dim) for (pid, dim, blob) in rows}
    mat = np.vstack([by_id[pid] for pid in ids])
    return mat


def cmd_cluster(args):
    conn = sqlite3.connect(args.db)
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
        df["agg_cluster"] = cm.agglomerative(n_clusters=args.agg)
        df["hdbscan_cluster"] = cm.hdbscan(min_cluster_size=args.hdbscan_min, min_samples=3, metric="euclidean")
        cur = conn.cursor(); cur.execute("BEGIN")
        for pid, k1, k2, k3 in df[["id", "kmeans_cluster", "agg_cluster", "hdbscan_cluster"]].itertuples(index=False, name=None):
            cur.execute("UPDATE papers SET kmeans_cluster=?, agg_cluster=?, hdbscan_cluster=? WHERE id=?", (int(k1), int(k2), int(k3), pid))
        cur.execute("COMMIT")
        print(f"{GREEN}cluster:{RESET} labels updated.")
    finally:
        conn.close()