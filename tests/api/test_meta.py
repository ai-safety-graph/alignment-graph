from __future__ import annotations

import pytest

from aisafety_pipeline.db import set_state


@pytest.fixture(autouse=True)
def _cleanup_latest_batch(conn):
    yield
    conn.execute("DELETE FROM pipeline_state WHERE key = 'latest_batch'")
    conn.commit()


def test_latest_batch_null_when_never_recorded(client, conn):
    conn.execute("DELETE FROM pipeline_state WHERE key = 'latest_batch'")

    res = client.get("/api/batch/latest")
    assert res.status_code == 200
    assert res.json() is None


def test_latest_batch_returns_recorded_value(client, conn):
    set_state(conn, "latest_batch", {"date": "2026-10-07", "added": 42})

    res = client.get("/api/batch/latest")
    assert res.status_code == 200
    assert res.json() == {"date": "2026-10-07", "added": 42}


def test_coverage_counts_relevant_papers_and_date_span(client, make_paper):
    make_paper("2401.00090", published="2023-03-01")
    make_paper("2401.00091", published="2025-06-15")
    make_paper("2401.00092", published="2020-01-01", llm_relevant=False)

    res = client.get("/api/batch/coverage")
    assert res.status_code == 200
    assert res.json() == {
        "total": 2,
        "earliest": "2023-03-01",
        "latest": "2025-06-15",
    }
