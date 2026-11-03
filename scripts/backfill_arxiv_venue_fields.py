#!/usr/bin/env python3
"""
One-off backfill of papers_raw.journal_ref / doi / comments for papers
harvested before the harvest stored those fields.

Only llm_relevant papers are fetched (the ones the API serves); the rest
fill in as the regular OAI harvest sees them again. Uses the arXiv API's
`id_list` lookup, ARXIV_API_BATCH ids per request with the harvest's 3s
throttle -- ~35k papers take ~10 minutes.

Resumable: ids are processed in order and the last finished id is
checkpointed in pipeline_state, so re-running continues where it stopped
(a paper with none of the fields can't be told apart from an unfetched one
by its columns alone). --restart ignores the checkpoint.

Ids arXiv doesn't return (after one retry) or rejects are never dropped
silently: they're recorded under `missing` in the checkpoint and the run
reports them. --retry-missing fetches just those.

Usage:
    python scripts/backfill_arxiv_venue_fields.py [--db DSN] [--limit N] [--dry-run]
    python scripts/backfill_arxiv_venue_fields.py --retry-missing
"""
from __future__ import annotations

import argparse
import time
from collections.abc import Callable

from psycopg2.extras import execute_values

from aisafety_pipeline.config import OAI_THROTTLE_SEC
from aisafety_pipeline.db import connect, get_state, set_state
from aisafety_pipeline.oai import ARXIV_API_BATCH, fetch_arxiv_venue_fields

STATE_KEY = "arxiv_venue_backfill"
_RETRY_SLEEP_SEC = 5

_UPDATE = """
    UPDATE papers_raw AS r
    SET journal_ref = v.journal_ref, doi = v.doi, comments = v.comments
    FROM (VALUES %s) AS v(id, journal_ref, doi, comments)
    WHERE r.id = v.id
"""


def _is_bad_request(exc: Exception) -> bool:
    """HTTP 400: arXiv rejecting the id_list (a malformed id). Other 4xx
    (403 block, 404, ...) say nothing about a particular id and must stop
    the run rather than be bisected into hundreds of failing requests."""
    resp = getattr(exc, "response", None)
    return getattr(resp, "status_code", None) == 400


def fetch_resilient(
    ids: list[str],
    fetch: Callable[[list[str]], dict[str, dict]] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    retry: bool = True,
) -> tuple[dict[str, dict], list[str]]:
    """Fetch venue fields for `ids`, returning (found, missing).

    - A 400 for the batch (arXiv rejecting an id) splits it in halves until
      the rejected id is isolated, so one bad id can't block the rest. Each
      split request waits the arXiv throttle first.
    - Ids absent from an otherwise fine response are retried once (the API
      occasionally returns short feeds); those still absent are `missing`.
    Other errors (403/other 4xx, 5xx, network) propagate: the checkpoint
    hasn't moved, so a rerun redoes this batch.
    """
    fetch = fetch or fetch_arxiv_venue_fields
    try:
        found = fetch(ids)
    except Exception as exc:
        if not _is_bad_request(exc):
            raise
        if len(ids) == 1:
            return {}, list(ids)
        # A failed request skips _oai_fetch's post-success throttle, so wait
        # before each half ourselves.
        mid = len(ids) // 2
        sleep(OAI_THROTTLE_SEC)
        f1, m1 = fetch_resilient(ids[:mid], fetch, sleep, retry)
        sleep(OAI_THROTTLE_SEC)
        f2, m2 = fetch_resilient(ids[mid:], fetch, sleep, retry)
        return {**f1, **f2}, m1 + m2

    absent = [pid for pid in ids if pid not in found]
    if absent and retry:
        sleep(_RETRY_SLEEP_SEC)
        more, absent = fetch_resilient(absent, fetch, sleep, retry=False)
        found.update(more)
    return found, absent


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--limit", type=int, default=None, help="Stop after this many papers")
    ap.add_argument("--dry-run", action="store_true", help="Fetch and report, write nothing")
    ap.add_argument("--restart", action="store_true", help="Ignore the saved checkpoint")
    ap.add_argument("--retry-missing", action="store_true",
                    help="Only re-fetch ids recorded as missing by earlier runs")
    args = ap.parse_args()

    conn = connect(args.db)
    try:
        state = {} if args.restart else (get_state(conn, STATE_KEY) or {})
        last_id = state.get("last_id", "")
        missing: set[str] = set(state.get("missing", []))

        if args.retry_missing:
            ids = sorted(missing)[: args.limit]
            print(f"backfill: retrying {len(ids)} previously missing papers")
        else:
            rows = conn.execute(
                "SELECT id FROM papers WHERE llm_relevant AND id > %s ORDER BY id",
                (last_id,),
            ).fetchall()
            ids = [r[0] for r in rows][: args.limit]
            print(f"backfill: {len(ids)} papers to fetch" + (f" (resuming after {last_id})" if last_id else ""))

        done = with_any = 0
        cur = conn.raw_cursor()
        for i in range(0, len(ids), ARXIV_API_BATCH):
            chunk = ids[i : i + ARXIV_API_BATCH]
            found, chunk_missing = fetch_resilient(chunk)
            if chunk and not found:
                # Nothing came back at all: an outage or empty feed, not a
                # few bad ids. Stop without touching the checkpoint.
                raise SystemExit(
                    f"backfill: arXiv returned none of {len(chunk)} papers starting at {chunk[0]}; "
                    "stopping with the checkpoint unchanged. Rerun later."
                )
            values = [
                (pid, f["journal_ref"], f["doi"], f["comments"])
                for pid, f in found.items()
            ]
            with_any += sum(1 for v in values if any(v[1:]))
            missing.difference_update(found)
            missing.update(chunk_missing)
            if not args.dry_run:
                if values:
                    execute_values(cur, _UPDATE, values)
                if not args.retry_missing:
                    last_id = chunk[-1]
                # Commits the UPDATE and the checkpoint together.
                set_state(conn, STATE_KEY, {"last_id": last_id, "missing": sorted(missing)})
            done += len(chunk)
            print(f"backfill: {done}/{len(ids)} fetched, {with_any} with any field, {len(missing)} missing so far")

        if missing:
            print(f"backfill: {len(missing)} papers not returned by arXiv; rerun with --retry-missing")
        print("backfill: done" + (" (dry run, nothing written)" if args.dry_run else ""))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
