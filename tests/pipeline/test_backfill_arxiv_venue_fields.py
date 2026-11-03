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
    fetch, _ = _fake_fetch(rejected={"c"})
    found, missing = backfill.fetch_resilient(list("abcde"), fetch, sleep=lambda s: None)
    assert set(found) == {"a", "b", "d", "e"} and missing == ["c"]


def test_server_errors_propagate_so_the_batch_is_redone():
    def fetch(ids):
        raise _http_error(503)

    with pytest.raises(requests.HTTPError):
        backfill.fetch_resilient(["a"], fetch, sleep=lambda s: None)


def test_run_records_missing_ids_and_retry_missing_recovers_them(conn, test_dsn, make_paper, monkeypatch):
    """End to end against the local DB: a paper arXiv omits is recorded in
    the checkpoint (not silently skipped) and --retry-missing fills it."""
    from aisafety_pipeline.db import get_state

    ids = [make_paper(f"2401.4000{i}", llm_relevant=True) for i in range(3)]
    conn.commit()
    omitted = ids[1]
    arxiv_down_for = {omitted}

    def fetch(chunk):
        return {
            pid: {"journal_ref": "ICLR 2026", "doi": None, "comments": None}
            for pid in chunk if pid not in arxiv_down_for
        }

    monkeypatch.setattr(backfill, "fetch_arxiv_venue_fields", fetch)
    monkeypatch.setattr(backfill, "_RETRY_SLEEP_SEC", 0)
    monkeypatch.setattr(backfill.time, "sleep", lambda s: None)
    monkeypatch.setattr(backfill, "ARXIV_API_BATCH", 2)

    def run(*extra):
        monkeypatch.setattr(sys, "argv", ["backfill", "--db", test_dsn, "--restart", *extra])
        backfill.main()

    def jr(aid):
        return conn.execute("SELECT journal_ref FROM papers_raw WHERE id = %s", (aid,)).fetchone()[0]

    try:
        run()
        state = get_state(conn, backfill.STATE_KEY)
        assert omitted in state["missing"]
        assert jr(ids[0]) == "ICLR 2026" and jr(ids[2]) == "ICLR 2026"
        assert jr(omitted) is None

        arxiv_down_for.clear()
        monkeypatch.setattr(sys, "argv", ["backfill", "--db", test_dsn, "--retry-missing"])
        backfill.main()
        assert jr(omitted) == "ICLR 2026"
        assert omitted not in get_state(conn, backfill.STATE_KEY)["missing"]
    finally:
        conn.execute("DELETE FROM papers_raw WHERE id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM pipeline_state WHERE key = %s", (backfill.STATE_KEY,))
        conn.commit()
