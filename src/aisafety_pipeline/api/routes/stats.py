from __future__ import annotations
from fastapi import APIRouter, Depends
from ..deps import get_conn

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def get_stats(conn=Depends(get_conn)):
    total_raw = (conn.execute("SELECT COUNT(*) FROM papers_raw").fetchone() or [0])[0]
    total_filtered = (conn.execute(
        "SELECT COUNT(*) FROM papers WHERE ai_stage2_keep = TRUE"
    ).fetchone() or [0])[0]
    total_embedded = (conn.execute(
        "SELECT COUNT(*) FROM papers WHERE embedding IS NOT NULL"
    ).fetchone() or [0])[0]

    domain_rows = conn.execute(
        """
        SELECT domain_tag, COUNT(*) AS cnt
        FROM papers WHERE ai_stage2_keep = TRUE
        GROUP BY domain_tag ORDER BY cnt DESC
        """
    ).fetchall()

    cluster_rows = conn.execute(
        """
        SELECT kmeans_cluster, COUNT(*) AS cnt
        FROM papers WHERE ai_stage2_keep = TRUE AND kmeans_cluster IS NOT NULL
        GROUP BY kmeans_cluster ORDER BY kmeans_cluster
        """
    ).fetchall()

    date_rows = conn.execute(
        """
        SELECT DATE_TRUNC('month', published::date) AS month, COUNT(*) AS cnt
        FROM papers WHERE ai_stage2_keep = TRUE AND published IS NOT NULL
        GROUP BY month ORDER BY month
        """
    ).fetchall()

    return {
        "total_harvested": int(total_raw or 0),
        "total_filtered": int(total_filtered or 0),
        "total_embedded": int(total_embedded or 0),
        "domains": {r[0] or "unknown": int(r[1]) for r in domain_rows},
        "clusters": {str(r[0]): int(r[1]) for r in cluster_rows},
        "by_month": {
            str(r[0])[:7]: int(r[1]) for r in date_rows if r[0]
        },
    }
