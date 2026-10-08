from __future__ import annotations

import datetime as dt

import pytest

from aisafety_pipeline.db import get_state, set_state
from aisafety_pipeline.utils import LATEST_BATCH_STATE_KEY, record_latest_batch

_IDS = ["2610.00001", "2610.00002", "2610.00003"]


@pytest.fixture(autouse=True)
def _cleanup(conn):
    """record_latest_batch commits via set_state, which also commits the
    fixture papers inserted on the same connection -- remove both."""
    yield
    conn.rollback()
    conn.execute(
        "DELETE FROM papers_raw WHERE id = ANY(%s)",
        ([f"https://arxiv.org/abs/{i}" for i in _IDS],),
    )
    conn.execute("DELETE FROM pipeline_state WHERE key = %s", (LATEST_BATCH_STATE_KEY,))
    conn.commit()


def _classify(conn, aid: str, at: dt.datetime) -> None:
    conn.execute("UPDATE papers SET llm_classified_at = %s WHERE id = %s", (at, aid))


def test_records_papers_classified_relevant_since_run_start(conn, make_paper):
    started_at = dt.datetime(2099, 1, 2, 6, 0, tzinfo=dt.UTC)
    later = started_at + dt.timedelta(hours=3)
    _classify(conn, make_paper(_IDS[0]), later)
    _classify(conn, make_paper(_IDS[1]), later)
    _classify(conn, make_paper(_IDS[2], llm_relevant=False), later)  # not shown in UI

    assert record_latest_batch(conn, started_at) == 2
    assert get_state(conn, LATEST_BATCH_STATE_KEY) == {"date": "2099-01-02", "added": 2}


def test_run_that_adds_nothing_keeps_previous_batch(conn, make_paper):
    set_state(conn, LATEST_BATCH_STATE_KEY, {"date": "2099-01-01", "added": 7})
    started_at = dt.datetime(2099, 1, 2, 6, 0, tzinfo=dt.UTC)
    _classify(conn, make_paper(_IDS[0]), started_at - dt.timedelta(days=1))  # previous run

    assert record_latest_batch(conn, started_at) == 0
    assert get_state(conn, LATEST_BATCH_STATE_KEY) == {"date": "2099-01-01", "added": 7}
