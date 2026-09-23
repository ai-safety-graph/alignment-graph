from __future__ import annotations

import pytest

from aisafety_pipeline.db import get_state, set_state
from aisafety_pipeline.oai import harvest_arxiv_oai_to_papers_raw


@pytest.fixture(autouse=True)
def _cleanup_test_keys(conn):
    """set_state commits immediately (see its docstring), so the `conn`
    fixture's rollback-on-teardown can't undo writes made here -- clean up
    explicitly so one test's keys don't leak into another's. Includes the
    real "harvest_watermark" key since the harvest test below writes it via
    the actual production code path."""
    yield
    conn.execute(
        "DELETE FROM pipeline_state WHERE key LIKE %s OR key = %s",
        ("test_%", "harvest_watermark"),
    )
    conn.commit()


def test_get_state_returns_default_when_unset(conn):
    assert get_state(conn, "test_missing_key", default="fallback") == "fallback"
    assert get_state(conn, "test_missing_key") is None


def test_set_state_then_get_state_round_trips(conn):
    set_state(conn, "test_watermark", {"until_date": "2026-09-22"})
    assert get_state(conn, "test_watermark") == {"until_date": "2026-09-22"}


def test_set_state_overwrites_existing_value(conn):
    set_state(conn, "test_watermark", {"until_date": "2026-09-01"})
    set_state(conn, "test_watermark", {"until_date": "2026-09-22"})
    assert get_state(conn, "test_watermark") == {"until_date": "2026-09-22"}


def test_harvest_uses_db_watermark_over_local_file_when_no_explicit_range(conn, tmp_path, monkeypatch):
    """A cron-triggered run gets a fresh container per invocation, so the
    local state file may not exist even though the DB watermark does --
    the DB value must win whenever both could apply."""
    set_state(conn, "harvest_watermark", {"until_date": "2026-09-10"})
    stale_local_file = tmp_path / "last_run.txt"
    stale_local_file.write_text("2005-09-16")

    captured: dict = {}

    def _fake_iter_records(from_date, until_date, oai_set):
        captured["from_date"] = from_date
        return iter(())

    monkeypatch.setattr("aisafety_pipeline.oai._oai_iter_records", _fake_iter_records)

    harvest_arxiv_oai_to_papers_raw(
        conn, until_date="2026-09-23", state_file=str(stale_local_file)
    )

    assert captured["from_date"] == "2026-09-10"
