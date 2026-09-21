from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_conn

router = APIRouter(prefix="/api/tags", tags=["tags"])

# `size` counts every paper that holds the tag at any rank (drives filter-chip
# counts and "how many papers match if I filter by this tag"). `primary_size`
# counts only papers where this tag is their top-scored (rank-0) tag -- used
# by the pie chart so percentages sum to 100% instead of being inflated by
# multi-tag overlap. The LLM lists tags in its own order; the first is
# treated as primary. Only LLM-relevant papers are counted.
_TAGS_SQL = """
    WITH relevant AS (
        SELECT llm_tags FROM papers
        WHERE llm_relevant = TRUE AND cardinality(llm_tags) > 0
    ),
    sizes AS (
        SELECT tag, COUNT(*) AS size FROM relevant, unnest(llm_tags) AS tag GROUP BY tag
    ),
    primary_sizes AS (
        SELECT llm_tags[1] AS tag, COUNT(*) AS primary_size FROM relevant GROUP BY llm_tags[1]
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
