from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_conn

router = APIRouter(prefix="/api/tags", tags=["tags"])

# `size` counts every paper that holds the tag at any rank (drives filter-chip
# counts and "how many papers match if I filter by this tag"). `primary_size`
# counts only papers where this tag is their top-scored (rank-0) tag -- used
# by the pie chart so percentages sum to 100% instead of being inflated by
# multi-tag overlap. DISTINCT ON picks each paper's single highest-scoring
# tag row.
_TAGS_SQL = """
    WITH primary_tags AS (
        SELECT DISTINCT ON (paper_id) paper_id, tag
        FROM paper_tags
        ORDER BY paper_id, score DESC
    ),
    sizes AS (
        SELECT tag, COUNT(*) AS size FROM paper_tags GROUP BY tag
    ),
    primary_sizes AS (
        SELECT tag, COUNT(*) AS primary_size FROM primary_tags GROUP BY tag
    )
    SELECT s.tag, s.size, COALESCE(p.primary_size, 0) AS primary_size
    FROM sizes s
    LEFT JOIN primary_sizes p ON p.tag = s.tag
    ORDER BY s.tag
"""


@router.get("")
def list_tags(conn=Depends(get_conn)):
    rows = conn.execute(_TAGS_SQL).fetchall()
    return {
        r[0]: {"size": int(r[1]), "primary_size": int(r[2])}
        for r in rows
    }
