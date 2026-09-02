from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_conn

router = APIRouter(prefix="/api/clusters", tags=["clusters"])


@router.get("")
def list_clusters(conn=Depends(get_conn)):
    # size is precomputed and stored on cluster_meta by label_clusters_default
    # (labeling.py) at label time -- no need to recount papers on every request.
    rows = conn.execute(
        """
        SELECT cluster_id, label, confidence, terms, size
        FROM cluster_meta
        WHERE method = 'default'
        ORDER BY cluster_id
        """
    ).fetchall()

    import json
    return [
        {
            "cid": int(r[0]),
            "label": r[1],
            "confidence": float(r[2]) if r[2] is not None else None,
            "terms": json.loads(r[3]) if isinstance(r[3], str) else (r[3] or []),
            "size": int(r[4]) if r[4] else 0,
        }
        for r in rows
    ]
