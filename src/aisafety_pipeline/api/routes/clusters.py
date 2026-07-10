from __future__ import annotations
from fastapi import APIRouter, Depends
from ..deps import get_conn

router = APIRouter(prefix="/api/clusters", tags=["clusters"])


@router.get("")
def list_clusters(conn=Depends(get_conn)):
    rows = conn.execute(
        """
        SELECT cm.cluster_id, cm.label, cm.confidence, cm.terms,
               COUNT(p.id) AS size
        FROM cluster_meta cm
        LEFT JOIN papers p ON p.kmeans_cluster = cm.cluster_id
            AND p.ai_stage2_keep = TRUE
        WHERE cm.method = 'default'
        GROUP BY cm.cluster_id, cm.label, cm.confidence, cm.terms
        ORDER BY cm.cluster_id
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
