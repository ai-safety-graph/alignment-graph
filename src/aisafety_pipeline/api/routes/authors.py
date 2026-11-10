from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..deps import get_conn
from ..recipe import MAX_TERM_LENGTH, MIN_KEYWORD_LENGTH, keyword_pattern

router = APIRouter(prefix="/api/authors", tags=["authors"])

# Author names for the graph-recipe author facet, most prolific first. `q`
# matches at the start of any word of a name ("nan" finds "Neel Nanda"), the
# same prefix rule as recipe keywords. The outer `authors ~*` uses
# idx_papers_authors_trgm to find candidate papers before their author lists
# are split, so only those rows are unnested. `q` needs a trigram (3+
# characters) for that index; shorter ones scan every relevant paper.
_AUTHORS_SQL = """
    SELECT a AS name, count(*) AS n
    FROM papers, unnest(string_to_array(authors, ', ')) AS a
    WHERE llm_relevant = TRUE AND authors ~* %s AND a ~* %s
    GROUP BY a
    ORDER BY n DESC, a
    LIMIT %s
"""


@router.get("")
def list_authors(
    q: str = Query(..., min_length=MIN_KEYWORD_LENGTH, max_length=MAX_TERM_LENGTH),
    limit: int = Query(10, ge=1, le=20),
    conn=Depends(get_conn),
):
    q = " ".join(q.split())
    if len(q) < MIN_KEYWORD_LENGTH:
        return []
    pattern = keyword_pattern(q)
    rows = conn.execute(_AUTHORS_SQL, (pattern, pattern, limit)).fetchall()
    return [{"name": r[0], "n": int(r[1])} for r in rows]
