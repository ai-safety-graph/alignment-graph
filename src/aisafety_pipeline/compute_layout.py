## Only uses the kmeans clustering

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from .config import GREEN, RESET
from .config import EMB_DIMS


def compute_graph_layout(
    db_path: str | None = None,
    # Layout method
    coords_method: str = "umap",     # "umap" | "pca" | "none"
    # UMAP/PCA params
    umap_n_neighbors: int = 15,
    umap_min_dist: float = 0.10,
    umap_random_state: int = 42,
    pca_random_state: int = 42,
    canvas_w: int = 1000, canvas_h: int = 700, canvas_pad: int = 24,
) -> int:
    """
    Compute 2D layout coordinates for kept+clustered papers and persist them
    to `papers.graph_x` / `papers.graph_y`. Returns the number of papers updated.
    """
    from .db import connect
    conn = connect(db_path)
    try:
        # 1) Load kept + clustered papers
        rows = conn.execute("""
            SELECT id, kmeans_cluster AS cid
            FROM papers
            WHERE ai_stage2_keep AND kmeans_cluster IS NOT NULL
            ORDER BY cid ASC, published DESC
        """).fetchall()
        if not rows:
            raise RuntimeError("No kept/clustered papers. Run filter & cluster first.")

        ids: List[str] = [r["id"] for r in rows]

        if coords_method.lower() == "none":
            print(f"{GREEN}compute-layout:{RESET} coords_method=none, nothing to do")
            return 0

        # 2) Embeddings
        emb_rows = conn.execute(
            "SELECT id, embedding FROM papers WHERE embedding IS NOT NULL AND id = ANY(%s)",
            (ids,),
        ).fetchall()
        vec_by_id: Dict[str, np.ndarray] = {}
        for pid, vec in emb_rows:
            if vec is not None:
                v = np.array(vec, dtype=np.float32)
                v /= (np.linalg.norm(v) + 1e-12)
                vec_by_id[pid] = v
        missing = [pid for pid in ids if pid not in vec_by_id]
        if missing:
            raise RuntimeError(f"{len(missing)} papers missing embeddings; run embed/cluster.")

        X = np.vstack([vec_by_id[pid] for pid in ids])
        N = X.shape[0]

        # 3) Coords
        method_req = coords_method.lower()
        coords_arr = None
        method_used = "none"

        if method_req == "umap":
            try:
                import umap.umap_ as umap
                reducer = umap.UMAP(
                    n_components=2, n_neighbors=umap_n_neighbors,
                    min_dist=umap_min_dist, metric="cosine",
                    random_state=umap_random_state, verbose=False
                )
                coords_arr = reducer.fit_transform(X)
                method_used = "umap"
            except Exception:
                method_req = "pca"

        if coords_arr is None and method_req == "pca":
            from sklearn.decomposition import PCA as _PCA
            reducer = _PCA(n_components=2, random_state=pca_random_state)
            coords_arr = reducer.fit_transform(X)
            method_used = "pca"

        xs = ys = None
        if coords_arr is not None:
            mins = coords_arr.min(axis=0); maxs = coords_arr.max(axis=0)
            rng = np.maximum(maxs - mins, 1e-9)
            norm = (coords_arr - mins) / rng

            xs = (canvas_pad + norm[:, 0] * (canvas_w - 2 * canvas_pad)).astype(np.int32)
            ys = (canvas_pad + norm[:, 1] * (canvas_h - 2 * canvas_pad)).astype(np.int32)

        # 4) Persist coords back to DB
        if xs is not None and ys is not None:
            cur = conn.cursor()
            cur.execute("BEGIN")
            for i, aid in enumerate(ids):
                cur.execute(
                    "UPDATE papers SET graph_x=?, graph_y=? WHERE id=?",
                    (float(xs[i]), float(ys[i]), aid),
                )
            cur.execute("COMMIT")

        print(f"{GREEN}compute-layout:{RESET} updated graph_x/y for {N} papers (method={method_used})")
        return N
    finally:
        conn.close()


def cmd_compute_layout(args):
    return compute_graph_layout(
        db_path=args.db,
        coords_method=args.coords,
        umap_n_neighbors=args.umap_n_neighbors,
        umap_min_dist=args.umap_min_dist,
        umap_random_state=args.umap_rand,
        pca_random_state=args.pca_rand,
        canvas_w=args.canvas_w,
        canvas_h=args.canvas_h,
        canvas_pad=args.canvas_pad,
    )
