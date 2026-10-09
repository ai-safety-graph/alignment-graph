from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_conn

router = APIRouter(prefix="/api/batch", tags=["meta"])


# Written by `run-all` at the end of each run that added papers (see
# utils.record_latest_batch): {"date": "YYYY-MM-DD", "added": N}. Returns
# null until the first such run.
@router.get("/latest")
def latest_batch(conn=Depends(get_conn)):
    row = conn.execute(
        "SELECT value FROM pipeline_state WHERE key = 'latest_batch'"
    ).fetchone()
    return row["value"] if row is not None else None


# Overall size and date span of the collection, for the About page. Counts
# only LLM-relevant papers, same as everything else the API serves.
@router.get("/coverage")
def coverage(conn=Depends(get_conn)):
    row = conn.execute(
        """
        SELECT COUNT(*), MIN(published), MAX(published)
        FROM papers WHERE llm_relevant = TRUE
        """
    ).fetchone()
    return {
        "total": int(row[0]),
        "earliest": str(row[1]) if row[1] else None,
        "latest": str(row[2]) if row[2] else None,
    }
