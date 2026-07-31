from __future__ import annotations
import datetime as dt
from collections import defaultdict
from typing import Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from ..deps import get_conn
from ...config import EMB_MODEL, EMB_DIMS

router = APIRouter(prefix="/api/graph", tags=["graph"])

_MAX_SUBSET = 500


class SubsetRequest(BaseModel):
    ids: List[str]

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("ids must not be empty")
        if len(v) > _MAX_SUBSET:
            raise ValueError(f"ids must contain at most {_MAX_SUBSET} items")
        return v


def _build_subgraph(conn, paper_ids: List[str]) -> dict:
    rows = conn.execute("""
        SELECT id, title, authors, published, link, domain_tag, kmeans_cluster,
               graph_x, graph_y
        FROM papers
        WHERE id = ANY(%s) AND ai_stage2_keep = TRUE AND kmeans_cluster IS NOT NULL
        ORDER BY kmeans_cluster ASC, published DESC
    """, (paper_ids,)).fetchall()

    if not rows:
        return {
            "meta": {
                "model": EMB_MODEL,
                "embedding_dim": EMB_DIMS,
                "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "neighbors": None,
                "coords": {
                    "included": False,
                    "method": "none",
                    "canvas": {"w": 1000, "h": 700, "pad": 24},
                    "bounds": None,
                },
                "compact": True,
            },
            "clusters": {},
            "nodes": [],
            "links": [],
        }

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
            "aid": r[0], "t": r[1] or "", "au": r[2] or "",
            "pd": str(r[3]) if r[3] else "", "dm": r[5] or "unknown",
            "ln": r[4] or r[0], "cid": cid,
            "raw_x": float(r[7]) if r[7] is not None else None,
            "raw_y": float(r[8]) if r[8] is not None else None,
        })
        ids.append(r[0])
        cluster_ids.append(cid)
        cluster_counts[cid] += 1

    N = len(papers)
    CANVAS_W, CANVAS_H, PAD = 1000, 700, 24

    x_vals = [p["raw_x"] for p in papers if p["raw_x"] is not None]
    y_vals = [p["raw_y"] for p in papers if p["raw_y"] is not None]
    has_coords = len(x_vals) == N

    if has_coords:
        x_min, x_max = min(x_vals), max(x_vals)
        y_min, y_max = min(y_vals), max(y_vals)
        x_range = max(x_max - x_min, 1e-9)
        y_range = max(y_max - y_min, 1e-9)
        for p in papers:
            p["x"] = PAD + (p["raw_x"] - x_min) / x_range * (CANVAS_W - 2 * PAD)
            p["y"] = PAD + (p["raw_y"] - y_min) / y_range * (CANVAS_H - 2 * PAD)
    else:
        for p in papers:
            p["x"] = 0.0
            p["y"] = 0.0

    nodes = [
        {"id": i, "aid": p["aid"], "t": p["t"], "au": p["au"],
         "pd": p["pd"], "dm": p["dm"], "ln": p["ln"], "cid": p["cid"],
         "x": p["x"], "y": p["y"], "rx": p["raw_x"], "ry": p["raw_y"]}
        for i, p in enumerate(papers)
    ]

    clusters = {
        str(cid): {"label": labels.get(cid), "size": int(cluster_counts[cid])}
        for cid in sorted(set(cluster_ids))
    }

    return {
        "meta": {
            "model": EMB_MODEL,
            "embedding_dim": EMB_DIMS,
            "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "neighbors": None,
            "coords": {
                "included": has_coords,
                "method": "stored-subset" if has_coords else "none",
                "canvas": {"w": CANVAS_W, "h": CANVAS_H, "pad": PAD},
                "bounds": (
                    {"x_min": x_min, "x_max": x_max, "y_min": y_min, "y_max": y_max}
                    if has_coords else None
                ),
            },
            "compact": True,
        },
        "clusters": clusters,
        "nodes": nodes,
        "links": [],
    }


@router.post("/subset")
def get_subgraph(body: SubsetRequest, conn=Depends(get_conn)):
    try:
        return _build_subgraph(conn, body.ids)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
