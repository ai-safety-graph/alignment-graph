from __future__ import annotations

from types import SimpleNamespace

import pytest

from aisafety_pipeline.db import get_state, set_state
from aisafety_pipeline.filters import _STAGE1_STATE_KEY, cmd_stage1

_MATCH = ("Mitigating Reward Hacking in RLHF",
          "We study reward hacking in reinforcement learning from human feedback.")
_OLD_ID = "test-stage1-old"
_NEW_ID = "test-stage1-new"


@pytest.fixture(autouse=True)
def _cleanup(conn):
    """cmd_stage1 opens its own connection and commits, so the `conn`
    fixture's rollback can't undo its writes -- clean up explicitly."""
    yield
    conn.execute("DELETE FROM papers_raw WHERE id IN (%s, %s)", (_OLD_ID, _NEW_ID))
    conn.execute("DELETE FROM pipeline_state WHERE key = %s", (_STAGE1_STATE_KEY,))
    conn.commit()


def _insert_raw(conn, pid, harvested_at):
    conn.execute(
        "INSERT INTO papers_raw (id, title, summary, categories, harvested_at) "
        "VALUES (%s, %s, %s, 'cs.AI', %s::timestamptz)",
        (pid, *_MATCH, harvested_at),
    )
    conn.commit()


def _in_papers(conn, pid):
    return conn.execute("SELECT 1 FROM papers WHERE id = %s", (pid,)).fetchone() is not None


def _args(dsn, full=False):
    return SimpleNamespace(db=dsn, keep_all_and_filter=False, full=full)


def test_stage1_only_scans_rows_harvested_after_watermark(conn, test_dsn):
    _insert_raw(conn, _OLD_ID, "2000-01-01T00:00:00+00:00")
    _insert_raw(conn, _NEW_ID, "2000-01-03T00:00:00+00:00")
    set_state(conn, _STAGE1_STATE_KEY, {"harvested_at": "2000-01-02T00:00:00+00:00"})

    cmd_stage1(_args(test_dsn))

    assert _in_papers(conn, _NEW_ID)
    assert not _in_papers(conn, _OLD_ID)


def test_stage1_full_flag_ignores_watermark(conn, test_dsn):
    _insert_raw(conn, _OLD_ID, "2000-01-01T00:00:00+00:00")
    set_state(conn, _STAGE1_STATE_KEY, {"harvested_at": "2000-01-02T00:00:00+00:00"})

    cmd_stage1(_args(test_dsn, full=True))

    assert _in_papers(conn, _OLD_ID)


def test_stage1_advances_watermark_to_newest_harvested_row(conn, test_dsn):
    set_state(conn, _STAGE1_STATE_KEY, {"harvested_at": "2000-01-02T00:00:00+00:00"})
    _insert_raw(conn, _NEW_ID, "2000-01-03T00:00:00+00:00")
    newest = conn.execute("SELECT max(harvested_at) AS m FROM papers_raw").fetchone()["m"]

    cmd_stage1(_args(test_dsn))

    assert get_state(conn, _STAGE1_STATE_KEY) == {"harvested_at": newest.isoformat()}
