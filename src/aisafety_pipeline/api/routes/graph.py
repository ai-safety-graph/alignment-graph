from __future__ import annotations
import datetime as dt
import time
from collections import defaultdict
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends
from ..deps import get_conn
from ...config import EMB_MODEL, EMB_DIMS

router = APIRouter(prefix="/api/graph", tags=["graph"])

# Simple in-process cache (TTL = 1 hour)
_CACHE_TTL = 3600
_cache: Dict[str, Any] = {"data": None, "ts": 0.0}


def _to_jsonable(obj):
    import numpy as _np
    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, (_np.integer,)):
        return int(obj)
    if isinstance(obj, (_np.floating,)):
        return float(obj)
    return obj


def _build_graph(conn) -> dict:
    rows = conn.execute("""
        SELECT id, title, authors, published, link, domain_tag, kmeans_cluster,
               graph_x, graph_y
        FROM papers
        WHERE ai_stage2_keep = TRUE AND kmeans_cluster IS NOT NULL
        ORDER BY kmeans_cluster ASC, published DESC
    """).fetchall()

    if not rows:
        return {"meta": {}, "clusters": {}, "nodes": [], "links": []}

    labels: Dict[int, str] = {}
    try:
        lab_rows = conn.execute(
            "SELECT cluster_id, label FROM cluster_meta WHERE method = 'default'"
        ).fetchall()
        for r in lab_rows:
            labels[int(r[0])] = r[1] or ""
    except Exception:
        pass

    papers = []
    ids = []
    cluster_ids = []
    cluster_counts: Dict[int, int] = defaultdict(int)

    for r in rows:
        cid = int(r[6]) if r[6] is not None else -1
        papers.append({
            "aid": r[0],
            "t": r[1] or "",
            "au": r[2] or "",
            "pd": str(r[3]) if r[3] else "",
            "dm": r[5] or "unknown",
            "ln": r[4] or r[0],
            "cid": cid,
            "x": float(r[7]) if r[7] is not None else 0.0,
            "y": float(r[8]) if r[8] is not None else 0.0,
        })
        ids.append(r[0])
        cluster_ids.append(cid)
        cluster_counts[cid] += 1

    N = len(papers)
    nodes = [
        {"id": i, "aid": p["aid"], "t": p["t"], "au": p["au"],
         "pd": p["pd"], "dm": p["dm"], "ln": p["ln"], "cid": p["cid"],
         "x": p["x"], "y": p["y"]}
        for i, p in enumerate(papers)
    ]

    # Build neighbor links using pgvector
    import numpy as np
    TOP_K = 5
    MIN_SIM = 0.85

    id_to_idx = {aid: i for i, aid in enumerate(ids)}
    seen: set = set()
    edge_list = []

    batch_size = 200
    for start in range(0, N, batch_size):
        batch_ids = ids[start:start + batch_size]
        rows_emb = conn.execute(
            """
            SELECT a.id AS aid, b.id AS bid,
                   1 - (a.embedding <=> b.embedding) AS sim
            FROM papers a
            JOIN papers b ON b.id = ANY(%s)
            WHERE a.id = ANY(%s)
              AND a.id != b.id
              AND 1 - (a.embedding <=> b.embedding) >= %s
              AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
            """,
            (ids, batch_ids, MIN_SIM),
        ).fetchall()
        for aid, bid, sim in rows_emb:
            i, j = id_to_idx.get(aid), id_to_idx.get(bid)
            if i is None or j is None:
                continue
            a, b = (i, j) if i < j else (j, i)
            if (a, b) not in seen:
                seen.add((a, b))
                edge_list.append((a, b, float(sim)))

    links = [{"s": a, "t": b, "w": round(w, 6)} for a, b, w in edge_list]

    clusters = {
        str(cid): {"label": labels.get(cid), "size": int(cluster_counts[cid])}
        for cid in sorted(set(cluster_ids))
    }

    return {
        "meta": {
            "model": EMB_MODEL,
            "embedding_dim": EMB_DIMS,
            "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "neighbors": {"top_k": TOP_K, "min_sim": MIN_SIM, "same_cluster_only": False},
            "coords": {"included": True, "method": "stored", "canvas": {"w": 1000, "h": 700, "pad": 24}},
            "compact": True,
        },
        "clusters": clusters,
        "nodes": nodes,
        "links": links,
    }


@router.get("")
def get_graph(conn=Depends(get_conn)):
    now = time.time()
    if _cache["data"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]
    data = _build_graph(conn)
    _cache["data"] = data
    _cache["ts"] = now
    return data
