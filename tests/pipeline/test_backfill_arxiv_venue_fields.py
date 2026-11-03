"""The backfill must never lose track of papers arXiv didn't return."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

requests = pytest.importorskip("requests")

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backfill_arxiv_venue_fields.py"
_spec = importlib.util.spec_from_file_location("backfill_arxiv_venue_fields", _SCRIPT)
backfill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backfill)

_FIELDS = {"journal_ref": None, "doi": None, "comments": "15 pages"}


def _http_error(status: int) -> requests.HTTPError:
    resp = requests.Response()
    resp.status_code = status
    return requests.HTTPError(response=resp)


def _fake_fetch(*, short_first: set[str] = frozenset(), never: set[str] = frozenset(),
                rejected: set[str] = frozenset()):
    calls: list[list[str]] = []

    def fetch(ids):
        calls.append(list(ids))
        if rejected & set(ids):
            raise _http_error(400)
        skip = set(never) | (set(short_first) if len(calls) == 1 else set())
        return {pid: dict(_FIELDS) for pid in ids if pid not in skip}

    return fetch, calls


def test_short_feed_is_retried_once():
    fetch, calls = _fake_fetch(short_first={"b"})
    found, missing = backfill.fetch_resilient(["a", "b", "c"], fetch, sleep=lambda s: None)
    assert set(found) == {"a", "b", "c"} and missing == []
    assert calls == [["a", "b", "c"], ["b"]]


def test_ids_absent_after_retry_are_reported_missing():
    fetch, _ = _fake_fetch(never={"b"})
    found, missing = backfill.fetch_resilient(["a", "b", "c"], fetch, sleep=lambda s: None)
    assert set(found) == {"a", "c"} and missing == ["b"]


def test_a_rejected_id_is_isolated_and_the_rest_still_fetched():
    fetch, calls = _fake_fetch(rejected={"c"})
    sleeps = []
    found, missing = backfill.fetch_resilient(list("abcde"), fetch, sleep=sleeps.append)
    assert set(found) == {"a", "b", "d", "e"} and missing == ["c"]
    # Every request after a rejection is throttled like any other arXiv
    # call (a rejected leaf may add one extra wait; that's harmless).
    assert len(sleeps) >= len(calls) - 1


@pytest.mark.parametrize("status", [403, 404, 503])
def test_non_400_errors_propagate_without_bisecting(status):
    calls = []

    def fetch(ids):
        calls.append(ids)
        raise _http_error(status)

    with pytest.raises(requests.HTTPError):
        backfill.fetch_resilient(list("abcd"), fetch, sleep=lambda s: None)
    assert len(calls) == 1


def test_a_rejected_single_id_still_waits_before_the_next_request():
    sleeps = []

    def fetch(ids):
        raise _http_error(400)

    found, missing = backfill.fetch_resilient(["a"], fetch, sleep=sleeps.append)
    assert (found, missing) == ({}, ["a"])
    assert sleeps == [backfill.OAI_THROTTLE_SEC]


def _isolate(monkeypatch, test_dsn, ids):
    """Confine main() to the test DB, the fixture papers and a test-only
    checkpoint key. main() connects via db.connect(), which falls back to
    DATABASE_URL (production) for a --db that isn't a postgresql:// URL,
    so it's bypassed; other relevant papers in a local DB and a real
    backfill checkpoint are never touched."""
    from aisafety_pipeline.db import PgConnection

    monkeypatch.setattr(backfill, "connect", lambda _db: PgConnection(test_dsn))
    monkeypatch.setattr(backfill, "STATE_KEY", "test_arxiv_venue_backfill")
    monkeypatch.setattr(
        backfill, "select_pending_ids",
        lambda conn, after: [pid for pid in sorted(ids) if pid > after],
    )
    monkeypatch.setattr(backfill, "_RETRY_SLEEP_SEC", 0)
    monkeypatch.setattr(backfill.time, "sleep", lambda s: None)


def _run(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["backfill", *argv])
    backfill.main()


@pytest.fixture
def fixture_papers(conn, make_paper):
    created: list[str] = []

    def _make(*arxiv_ids):
        ids = [make_paper(a, llm_relevant=True) for a in arxiv_ids]
        conn.commit()
        created.extend(ids)
        return ids

    yield _make
    conn.execute("DELETE FROM papers_raw WHERE id = ANY(%s)", (created,))
    conn.execute("DELETE FROM pipeline_state WHERE key = 'test_arxiv_venue_backfill'")
    conn.commit()


def _jr(conn, aid):
    return conn.execute("SELECT journal_ref FROM papers_raw WHERE id = %s", (aid,)).fetchone()[0]


def _fields(chunk, skip=()):
    return {pid: {"journal_ref": "ICLR 2026", "doi": None, "comments": None}
            for pid in chunk if pid not in skip}


def test_run_records_missing_ids_and_retry_missing_recovers_them(conn, test_dsn, fixture_papers, monkeypatch):
    """A paper arXiv omits is recorded in the checkpoint (not silently
    skipped) and --retry-missing fills it."""
    from aisafety_pipeline.db import get_state

    ids = fixture_papers("2401.40000", "2401.40001", "2401.40002")
    _isolate(monkeypatch, test_dsn, ids)
    omitted = ids[1]
    down = {omitted}
    monkeypatch.setattr(backfill, "fetch_arxiv_venue_fields", lambda chunk: _fields(chunk, down))
    monkeypatch.setattr(backfill, "ARXIV_API_BATCH", 2)

    _run(monkeypatch, "--restart")
    state = get_state(conn, backfill.STATE_KEY)
    assert state["missing"] == [omitted] and state["last_id"] == ids[2]
    assert _jr(conn, ids[0]) == "ICLR 2026" and _jr(conn, ids[2]) == "ICLR 2026"
    assert _jr(conn, omitted) is None

    down.clear()
    _run(monkeypatch, "--retry-missing")
    assert _jr(conn, omitted) == "ICLR 2026"
    assert get_state(conn, backfill.STATE_KEY)["missing"] == []


def test_a_chunk_of_only_bad_ids_is_recorded_and_passed(conn, test_dsn, fixture_papers, monkeypatch):
    """No permanent stall: a chunk arXiv never returns is recorded as
    missing and the run moves on to the next one."""
    from aisafety_pipeline.db import get_state

    ids = fixture_papers("2401.40010", "2401.40011", "2401.40012")
    _isolate(monkeypatch, test_dsn, ids)
    bad = set(ids[:2])
    monkeypatch.setattr(backfill, "fetch_arxiv_venue_fields", lambda chunk: _fields(chunk, bad))
    monkeypatch.setattr(backfill, "ARXIV_API_BATCH", 2)

    _run(monkeypatch)
    state = get_state(conn, backfill.STATE_KEY)
    assert sorted(state["missing"]) == sorted(bad)
    assert state["last_id"] == ids[2]
    assert _jr(conn, ids[2]) == "ICLR 2026"


def test_an_outage_stops_the_run_with_misses_recorded(conn, test_dsn, fixture_papers, monkeypatch):
    from aisafety_pipeline.db import get_state

    ids = fixture_papers(*(f"2401.4002{i}" for i in range(5)))
    _isolate(monkeypatch, test_dsn, ids)
    monkeypatch.setattr(backfill, "fetch_arxiv_venue_fields", lambda chunk: {})
    monkeypatch.setattr(backfill, "ARXIV_API_BATCH", 1)

    with pytest.raises(SystemExit):
        _run(monkeypatch)
    state = get_state(conn, backfill.STATE_KEY)
    # Stopped after _MAX_EMPTY_CHUNKS chunks, each recorded, the rest untouched.
    assert sorted(state["missing"]) == sorted(ids)[: backfill._MAX_EMPTY_CHUNKS]
    assert state["last_id"] == sorted(ids)[backfill._MAX_EMPTY_CHUNKS - 1]


def test_filled_papers_are_requeued_for_the_venue_stage(conn, test_dsn, fixture_papers, monkeypatch):
    """The backfill doesn't move harvested_at, so it clears venue_derived_at
    for the papers it fills; otherwise an earlier "unknown" would stick."""
    ids = fixture_papers("2401.40030", "2401.40031")
    conn.execute("UPDATE papers SET venue_derived_at = now() WHERE id = ANY(%s)", (ids,))
    conn.commit()
    _isolate(monkeypatch, test_dsn, ids)
    monkeypatch.setattr(backfill, "fetch_arxiv_venue_fields", lambda chunk: _fields(chunk, {ids[1]}))

    _run(monkeypatch, "--restart")
    derived = dict(conn.execute(
        "SELECT id, venue_derived_at FROM papers WHERE id = ANY(%s)", (ids,)
    ).fetchall())
    assert derived[ids[0]] is None
    assert derived[ids[1]] is not None  # not returned by arXiv, nothing new to derive
