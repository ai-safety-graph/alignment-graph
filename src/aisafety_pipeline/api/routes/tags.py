from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from ...taxonomy import TAXONOMY_DESCRIPTIONS
from ..deps import get_conn

router = APIRouter(prefix="/api/tags", tags=["tags"])

# `size` counts every paper that holds the tag at any rank (drives filter-chip
# counts and "how many papers match if I filter by this tag"). `primary_size`
# counts only papers where this tag is their primary (first-listed) tag -- used
# by the pie chart so percentages sum to 100% instead of being inflated by
# multi-tag overlap. The LLM lists tags in its own order; the first is
# treated as primary. Only LLM-relevant papers are counted. `description` is
# the taxonomy text the LLM classifier is given for the tag (None for a tag
# no longer in the taxonomy); the About page shows it as a glossary.
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


# Tags only change when the daily pipeline runs, but the query reads every
# relevant paper's heap page (~26k pages), so serve it from memory between
# refreshes. Per-process; a stale window of up to the TTL is fine.
_CACHE_TTL_S = 600.0
_cache: tuple[float, dict] | None = None


def clear_cache() -> None:
    global _cache
    _cache = None


def _fresh(cached: tuple[float, dict] | None) -> bool:
    return cached is not None and time.monotonic() - cached[0] < _CACHE_TTL_S


def tags_conn():
    """Like get_conn, but borrows nothing while the cache is fresh, so a hit
    is served without waiting on (or 503-ing from) a saturated pool."""
    if _fresh(_cache):
        yield None
        return
    yield from get_conn()


@router.get("")
def list_tags(conn=Depends(tags_conn)):
    global _cache
    cached = _cache
    # conn is None when tags_conn saw a fresh cache; serve it even if the TTL
    # lapsed a moment since (it's only ever replaced, never cleared, outside
    # tests). The freshness check covers callers that always pass a conn.
    if cached is not None and (conn is None or _fresh(cached)):
        return cached[1]
    rows = conn.execute(_TAGS_SQL).fetchall()
    result = {
        r[0]: {
            "size": int(r[1]),
            "primary_size": int(r[2]),
            "description": TAXONOMY_DESCRIPTIONS.get(r[0]),
        }
        for r in rows
    }
    _cache = (time.monotonic(), result)
    return result
