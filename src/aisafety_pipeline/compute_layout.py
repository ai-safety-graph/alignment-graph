from __future__ import annotations

import numpy as np
from psycopg2.extras import execute_values

from .config import GREEN, RESET, YELLOW

_LAYOUT_WRITE_BATCH = 500

_UPDATE_COORDS = """
    UPDATE papers AS p SET graph_x = v.x, graph_y = v.y
    FROM (VALUES %s) AS v(id, x, y)
    WHERE p.id = v.id
"""

# Implies the predicate of idx_papers_embedding_topic_llm (db.py), so the
# HNSW index serves the nearest-neighbour ORDER BY.
_NEAREST_PLACED = """
    SELECT graph_x, graph_y FROM papers
    WHERE llm_relevant = TRUE AND embedding_topic IS NOT NULL AND graph_x IS NOT NULL
    ORDER BY embedding_topic <=> %s::vector
    LIMIT %s
"""


def _write_coords(conn, rows: list[tuple[str, float, float]]) -> None:
    """Batched UPDATE -- this used to issue one UPDATE (one network round
    trip, plus new entries in every index on `papers`) per paper."""
    write_cur = conn.raw_cursor()
    for i in range(0, len(rows), _LAYOUT_WRITE_BATCH):
        execute_values(
            write_cur, _UPDATE_COORDS, rows[i:i + _LAYOUT_WRITE_BATCH],
            template="(%s, %s::real, %s::real)",
        )
        conn.commit()


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
    full: bool = False,
    knn_k: int = 10,
) -> int:
    """
    Persist 2D layout coordinates for llm_relevant, topic-embedded papers to
    `papers.graph_x` / `papers.graph_y`. Returns the number of papers updated.

    Incremental by default: only papers without coordinates are placed, each
    at the mean position of its `knn_k` nearest already-placed neighbours in
    topic space, so existing points never move. `full=True` refits the whole
    layout instead (also done automatically when nothing is placed yet) --
    needed now and then so genuinely new topics get their own cluster.
    """
    from .db import connect
    conn = connect(db_path)
    try:
        if coords_method.lower() == "none":
            print(f"{GREEN}compute-layout:{RESET} coords_method=none, nothing to do")
            return 0
        if not full:
            placed = conn.execute(
                "SELECT 1 FROM papers WHERE llm_relevant AND graph_x IS NOT NULL LIMIT 1"
            ).fetchone()
            if placed is None:
                print(f"{YELLOW}compute-layout:{RESET} no existing layout, doing a full fit")
                full = True
        if not full:
            return _place_new_papers(conn, knn_k)
        return _fit_full_layout(
            conn, coords_method,
            umap_n_neighbors=umap_n_neighbors, umap_min_dist=umap_min_dist,
            umap_random_state=umap_random_state, pca_random_state=pca_random_state,
            canvas_w=canvas_w, canvas_h=canvas_h, canvas_pad=canvas_pad,
        )
    finally:
        conn.close()


def _place_new_papers(conn, knn_k: int) -> int:
    from .filters import load_vectors

    ids = [r["id"] for r in conn.execute("""
        SELECT id FROM papers
        WHERE llm_relevant AND embedding_topic IS NOT NULL AND graph_x IS NULL
        ORDER BY id
    """).fetchall()]
    if not ids:
        print(f"{GREEN}compute-layout:{RESET} no new papers to place")
        return 0

    vec_by_id = load_vectors(conn, ids, model="topic")
    updates: list[tuple[str, float, float]] = []
    for pid in ids:
        nbrs = conn.execute(_NEAREST_PLACED, (vec_by_id[pid].tolist(), knn_k)).fetchall()
        x, y = np.mean([[r["graph_x"], r["graph_y"]] for r in nbrs], axis=0)
        # Whole canvas units, matching what the full fit stores.
        updates.append((pid, float(round(x)), float(round(y))))

    _write_coords(conn, updates)
    print(f"{GREEN}compute-layout:{RESET} placed {len(updates)} new papers (knn_k={knn_k})")
    return len(updates)


def _fit_full_layout(
    conn, coords_method: str, *,
    umap_n_neighbors: int, umap_min_dist: float,
    umap_random_state: int, pca_random_state: int,
    canvas_w: int, canvas_h: int, canvas_pad: int,
) -> int:
    from .filters import load_vectors

    # 1) Load relevant + topic-embedded papers -- the same set the API
    # serves (graph and search both filter on llm_relevant).
    rows = conn.execute("""
        SELECT id, graph_x, graph_y
        FROM papers
        WHERE llm_relevant AND embedding_topic IS NOT NULL
        ORDER BY published DESC
    """).fetchall()
    if not rows:
        raise RuntimeError("No relevant/embedded papers. Run llm-classify & embed-topic first.")

    ids: list[str] = [r["id"] for r in rows]
    prev = {r["id"]: (r["graph_x"], r["graph_y"]) for r in rows}

    # 2) Embeddings (already L2-normalized by load_vectors). Uses the topic
    # embedding, not SPECTER2, so graph proximity reflects topical
    # similarity rather than citation proximity.
    vec_by_id: dict[str, np.ndarray] = load_vectors(conn, ids, model="topic")
    missing = [pid for pid in ids if pid not in vec_by_id]
    if missing:
        raise RuntimeError(f"{len(missing)} papers missing topic embeddings; run embed-topic first.")

    X = np.vstack([vec_by_id[pid] for pid in ids])

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

    if coords_arr is None:
        return 0

    mins = coords_arr.min(axis=0); maxs = coords_arr.max(axis=0)
    rng = np.maximum(maxs - mins, 1e-9)
    norm = (coords_arr - mins) / rng
    xs = (canvas_pad + norm[:, 0] * (canvas_w - 2 * canvas_pad)).astype(np.int32)
    ys = (canvas_pad + norm[:, 1] * (canvas_h - 2 * canvas_pad)).astype(np.int32)

    # 4) Persist coords back to DB, skipping rows whose position didn't change
    updates = [
        (pid, float(xs[i]), float(ys[i]))
        for i, pid in enumerate(ids)
        if prev[pid] != (float(xs[i]), float(ys[i]))
    ]
    _write_coords(conn, updates)

    print(
        f"{GREEN}compute-layout:{RESET} refit {len(ids)} papers, updated graph_x/y for "
        f"{len(updates)} (method={method_used})"
    )
    return len(updates)


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
        full=args.full,
        knn_k=args.knn_k,
    )
