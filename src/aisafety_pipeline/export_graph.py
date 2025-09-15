## Only uses the kmeans clustering

from __future__ import annotations

import json, gzip, sqlite3
import datetime as dt
from collections import defaultdict
from typing import Dict, List, Tuple, Optional

import numpy as np

from .config import DB_PATH, GREEN, RESET
from .config import EMB_MODEL, EMB_DIMS
from .embeddings import vec_from_bytes


def _to_jsonable(obj):
    """Recursively convert NumPy scalars/arrays to native Python for json.dump."""
    import numpy as _np
    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, (_np.integer,)):
        return int(obj)
    if isinstance(obj, (_np.floating,)):
        return float(obj)
    if isinstance(obj, (_np.ndarray,)):
        return obj.tolist()
    return obj


def _trim(s: Optional[str], max_len: int = 500) -> Optional[str]:
    if s is None:
        return None
    s = s.strip()
    return (s[:max_len] + "…") if len(s) > max_len else s


def export_json_graph(
    db_path: str = DB_PATH,
    out_path: str = "force_graph.json",
    # Size/UX controls
    compact: bool = True,
    include_summaries: bool = False,
    max_summary_len: int = 400,
    top_k: int = 8,
    min_sim: float = 0.85,
    same_cluster_only: bool = False,
    include_coords: bool = True,
    # Layout seed (graph/DR)
    coords_method: str = "fr",       # "fa2" | "fr" | "umap" | "pca" | "none"
    # ForceAtlas2 params
    fa2_iterations: int = 800,
    fa2_scaling: float = 2.0,
    fa2_gravity: float = 1.0,
    # FR (spring) params
    fr_iterations: int = 300,
    fr_seed: int = 42,
    # UMAP/PCA params
    umap_n_neighbors: int = 15,
    umap_min_dist: float = 0.10,
    umap_random_state: int = 42,
    pca_random_state: int = 42,
    canvas_w: int = 1000, canvas_h: int = 700, canvas_pad: int = 24,
    # Connectivity control
    add_cluster_mst: bool = True,
    # Output options
    gzip_out: bool = False,
) -> str:
    """
    Emit nodes/links JSON for react-force-graph-2d.

    Compact schema:
      nodes: { id:int, aid:str, t:str, au:str, pd:str, dm:str, ln:str, cid:int, [sm], [x],[y] }
      links: { s:int, t:int, w:float }
      clusters: { "<cid>": { label:str|null, size:int } }
      meta: generation info
    """
    conn = sqlite3.connect(db_path); conn.row_factory = sqlite3.Row
    try:
        # 1) Load kept + clustered papers
        rows = conn.execute("""
            SELECT id, title, authors, published, summary, link, kmeans_cluster AS cid, domain_tag
            FROM papers
            WHERE ai_stage2_keep=1 AND kmeans_cluster IS NOT NULL
            ORDER BY cid ASC, published DESC
        """).fetchall()
        if not rows:
            raise RuntimeError("No kept/clustered papers. Run filter & cluster first.")

        # 2) Cluster labels (if present)
        labels_by_cid: Dict[int, Dict[str, float | str]] = {}
        try:
            any_rows = conn.execute("SELECT 1 FROM cluster_meta LIMIT 1").fetchone()
            if any_rows:
                have_default = conn.execute(
                    "SELECT 1 FROM cluster_meta WHERE method='default' LIMIT 1"
                ).fetchone() is not None
                lab_rows = conn.execute(
                    "SELECT cluster_id, label, confidence FROM cluster_meta " +
                    ("WHERE method='default'" if have_default else "")
                ).fetchall()
                for r in lab_rows:
                    labels_by_cid[int(r["cluster_id"])] = {
                        "label": r["label"],
                        "confidence": float(r["confidence"] or 0.0)
                    }
        except sqlite3.OperationalError:
            pass

        # 3) Paper records + indices
        papers = []
        ids: List[str] = []
        cluster_ids: List[int] = []
        cluster_counts = defaultdict(int)
        for r in rows:
            cid = int(r["cid"])
            papers.append({
                "aid": r["id"],
                "t": r["title"] or "",
                "au": r["authors"] or "",
                "pd": r["published"] or "",
                "dm": r["domain_tag"] or "unknown",
                "sm": _trim(r["summary"], max_summary_len) if include_summaries else None,
                "ln": r["link"] or r["id"],
                "cid": cid,
            })
            ids.append(r["id"]); cluster_ids.append(cid); cluster_counts[cid] += 1

        # 4) Embeddings (neighbors + optional coords)
        placeholders = ",".join(["?"] * len(ids))
        emb_rows = conn.execute(
            f"SELECT paper_id, dim, vector FROM embeddings WHERE model=? AND paper_id IN ({placeholders})",
            (EMB_MODEL, *ids)
        ).fetchall()
        vec_by_id = {}
        dim = None
        for pid, d, blob in emb_rows:
            v = vec_from_bytes(blob, d).astype(np.float32)
            v /= (np.linalg.norm(v) + 1e-12)
            vec_by_id[pid] = v
            dim = d
        missing = [pid for pid in ids if pid not in vec_by_id]
        if missing:
            raise RuntimeError(f"{len(missing)} papers missing embeddings; run embed/cluster.")

        X = np.vstack([vec_by_id[pid] for pid in ids])
        N = X.shape[0]

        # 5) Neighbors (top-k edges per node)
        neigh_pairs: List[List[Tuple[int, float]]] = [[] for _ in range(N)]
        if N > 1:
            if same_cluster_only:
                cluster_to_indices = defaultdict(list)
                for idx, p in enumerate(papers):
                    cluster_to_indices[p["cid"]].append(idx)

            BATCH = 1024 if N > 20000 else 4096
            if same_cluster_only:
                import numpy as _np
                for i in range(N):
                    cid = papers[i]["cid"]
                    indices = cluster_to_indices[cid]
                    sims = X[i:i+1] @ X[indices].T
                    sims = sims.ravel()
                    gidx = _np.array(indices, dtype=_np.int64)
                    sims[gidx == i] = -np.inf
                    k_eff = min(top_k, sims.size)
                    if k_eff > 0:
                        top_idx = _np.argpartition(sims, -k_eff)[-k_eff:]
                        top_idx = top_idx[_np.argsort(-sims[top_idx])]
                        for jj in top_idx:
                            sim = float(sims[jj])
                            if sim < min_sim: continue
                            j = int(gidx[jj])
                            neigh_pairs[i].append((j, sim))
            else:
                import numpy as _np
                for start in range(0, N, BATCH):
                    stop = min(start + BATCH, N)
                    sims_block = X[start:stop] @ X.T
                    for row in range(stop - start):
                        i = start + row
                        sims_row = sims_block[row]
                        sims_row[i] = -np.inf
                        k_eff = min(top_k, N - 1)
                        if k_eff > 0:
                            top_idx = _np.argpartition(sims_row, -k_eff)[-k_eff:]
                            top_idx = top_idx[_np.argsort(-sims_row[top_idx])]
                            for j in top_idx:
                                sim = float(sims_row[j])
                                if sim < min_sim: continue
                                neigh_pairs[i].append((j, sim))

        # 6) Optional per-cluster MST for connectivity
        def _cluster_mst(indices: list[int]):
            if len(indices) <= 1: return []
            in_tree = {indices[0]}
            edges = []
            import heapq
            for j in indices[1:]:
                sim = float(X[indices[0]] @ X[j])
                heapq.heappush(edges, (1.0 - sim, indices[0], j, sim))
            mst = []
            while len(in_tree) < len(indices) and edges:
                _, u, v, sim = heapq.heappop(edges)
                if v in in_tree:
                    continue
                in_tree.add(v)
                mst.append((u, v, sim))
                for w in indices:
                    if w in in_tree: 
                        continue
                    sw = float(X[v] @ X[w])
                    heapq.heappush(edges, (1.0 - sw, v, w, sw))
            return mst

        mst_edges = []
        if add_cluster_mst:
            by_cluster = defaultdict(list)
            for i, p in enumerate(papers):
                by_cluster[p["cid"]].append(i)
            for idxs in by_cluster.values():
                mst_edges.extend(_cluster_mst(idxs))

        # 7) Dedup edges
        seen = set()
        edge_list: List[Tuple[int,int,float]] = []
        def _emit_edge(u: int, v: int, sim: float):
            a, b = (u, v) if u < v else (v, u)
            key = (a, b)
            if key in seen:
                return
            seen.add(key)
            edge_list.append((a, b, float(sim)))

        for i, lst in enumerate(neigh_pairs):
            for j, sim in lst:
                _emit_edge(i, j, sim)
        for (u, v, sim) in mst_edges:
            if sim >= min_sim * 0.5:
                _emit_edge(u, v, sim)

        # 8) Coords
        xs = ys = None
        layout_method_used = "none"
        if include_coords and N >= 2 and coords_method.lower() != "none":
            method_req = coords_method.lower()
            coords_arr = None
            method_used = "none"

            if method_req in ("fa2", "fr"):
                try:
                    import networkx as nx
                except ImportError as e:
                    raise RuntimeError("coords_method='fa2'/'fr' requires networkx (pip install networkx)") from e

                G = nx.Graph()
                G.add_nodes_from(range(N))
                for u, v, w in edge_list:
                    if u != v and w > 0:
                        G.add_edge(int(u), int(v), weight=float(w))

                if method_req == "fa2":
                    try:
                        from fa2 import ForceAtlas2  # pip install fa2
                        fa2 = ForceAtlas2(
                            outboundAttractionDistribution=True,
                            linLogMode=True,
                            adjustSizes=False,
                            edgeWeightInfluence=1.0,
                            jitterTolerance=1.0,
                            barnesHutOptimize=True,
                            barnesHutTheta=1.2,
                            scalingRatio=float(fa2_scaling),
                            gravity=float(fa2_gravity),
                            verbose=False,
                        )
                        pos = fa2.forceatlas2_networkx_layout(G, pos=None, iterations=int(fa2_iterations))
                        coords_arr = np.vstack([pos[i] for i in range(N)]).astype(np.float32)
                        method_used = "fa2"
                    except Exception:
                        method_req = "fr"

                if method_req == "fr" and coords_arr is None:
                    pos = nx.spring_layout(
                        G, dim=2, weight="weight",
                        iterations=int(fr_iterations), seed=int(fr_seed), k=None, scale=1.0
                    )
                    coords_arr = np.vstack([pos[i] for i in range(N)]).astype(np.float32)
                    method_used = "fr"

            elif method_req == "umap":
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

            if coords_arr is not None:
                mins = coords_arr.min(axis=0); maxs = coords_arr.max(axis=0)
                rng = np.maximum(maxs - mins, 1e-9)
                norm = (coords_arr - mins) / rng

                def _spread(points: np.ndarray, r_min: float = 0.01, iters: int = 1):
                    P = points.copy()
                    for _ in range(iters):
                        cell = r_min
                        buckets: dict[tuple[int,int], list[int]] = {}
                        for i, (x, y) in enumerate(P):
                            gx = int(np.floor(x / cell))
                            gy = int(np.floor(y / cell))
                            buckets.setdefault((gx, gy), []).append(i)
                        for (gx, gy), idxs in buckets.items():
                            neigh_keys = [(gx+dx, gy+dy) for dx in (-1,0,1) for dy in (-1,0,1)]
                            hot = set()
                            for k in neigh_keys:
                                hot.update(buckets.get(k, ()))
                            hot = list(hot)
                            for ii in idxs:
                                xi, yi = P[ii]
                                for jj in hot:
                                    if jj <= ii: continue
                                    dx = xi - P[jj,0]; dy = yi - P[jj,1]
                                    d2 = dx*dx + dy*dy
                                    if d2 < (r_min*r_min) and d2 > 1e-12:
                                        d = np.sqrt(d2)
                                        push = 0.5*(r_min - d)/d
                                        P[ii,0] += dx*push; P[ii,1] += dy*push
                                        P[jj,0] -= dx*push; P[jj,1] -= dy*push
                    return P

                if method_used in ("fa2", "fr"):
                    norm = _spread(norm, r_min=0.01, iters=1)

                xs = (canvas_pad + norm[:, 0] * (canvas_w - 2 * canvas_pad)).astype(np.int32)
                ys = (canvas_pad + norm[:, 1] * (canvas_h - 2 * canvas_pad)).astype(np.int32)
            layout_method_used = method_used
        else:
            layout_method_used = "none"

        # 9) Build nodes
        nodes = []
        for i, p in enumerate(papers):
            if compact:
                nd = {
                    "id": i,
                    "aid": p["aid"],
                    "t": p["t"],
                    "au": p["au"],
                    "pd": p["pd"],
                    "dm": p["dm"],
                    "ln": p["ln"],
                    "cid": p["cid"],
                }
                if include_summaries and p["sm"] is not None:
                    nd["sm"] = p["sm"]
                if xs is not None and ys is not None:
                    nd["x"] = int(xs[i]); nd["y"] = int(ys[i])
            else:
                nd = {
                    "id": p["aid"],
                    "title": p["t"], "authors": p["au"], "published": p["pd"],
                    "domain": p["dm"], "summary": p["sm"], "link": p["ln"],
                    "cid": p["cid"],
                }
                if xs is not None and ys is not None:
                    nd["x"] = int(xs[i]); nd["y"] = int(ys[i])
            nodes.append(nd)

        # 10) Links (deduped)
        links = [{"s": int(a), "t": int(b), "w": round(float(w), 6)}
                 for (a, b, w) in edge_list] if compact else \
                [{"source": ids[a], "target": ids[b], "weight": round(float(w), 6)}
                 for (a, b, w) in edge_list]

        # 11) Clusters legend
        clusters = {}
        for cid in sorted(set(cluster_ids)):
            clusters[str(cid)] = {
                "label": labels_by_cid.get(cid, {}).get("label"),
                "size": int(cluster_counts[cid]),
            }

        payload = {
            "meta": {
                "model": EMB_MODEL,
                "embedding_dim": int(dim or EMB_DIMS),
                "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "neighbors": {"top_k": top_k, "min_sim": min_sim, "same_cluster_only": bool(same_cluster_only)},
                "coords": {
                    "included": bool(xs is not None),
                    "method": layout_method_used,
                    "canvas": {"w": canvas_w, "h": canvas_h, "pad": canvas_pad},
                },
                "compact": bool(compact)
            },
            "clusters": clusters,
            "nodes": nodes,
            "links": links,
        }

        safe = _to_jsonable(payload)
        if gzip_out:
            gz_path = out_path + ".gz"
            with gzip.open(gz_path, "wt", encoding="utf-8") as f:
                json.dump(safe, f, ensure_ascii=False, separators=(",", ":"))
            return gz_path
        else:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(safe, f, ensure_ascii=False, separators=(",", ":"))
            print(f"{GREEN}export-graph:{RESET} wrote {out_path} (nodes={len(nodes)} links={len(links)})")
            return out_path
    finally:
        conn.close()


def cmd_export_graph(args):
    return export_json_graph(
        db_path=args.db,
        out_path=args.out,
        compact=not args.verbose,
        include_summaries=args.include_summaries,
        max_summary_len=args.max_summary_len,
        top_k=args.top_k,
        min_sim=args.min_sim,
        same_cluster_only=args.same_cluster_only,
        include_coords=(args.coords != "none"),
        coords_method=args.coords,
        umap_n_neighbors=args.umap_n_neighbors,
        umap_min_dist=args.umap_min_dist,
        umap_random_state=args.umap_rand,
        pca_random_state=args.pca_rand,
        canvas_w=args.canvas_w,
        canvas_h=args.canvas_h,
        canvas_pad=args.canvas_pad,
        add_cluster_mst=not args.no_mst,
        gzip_out=args.gzip,
    )
