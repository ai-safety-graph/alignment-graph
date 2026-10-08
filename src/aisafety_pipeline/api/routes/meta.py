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
