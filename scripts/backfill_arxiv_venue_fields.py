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

Usage:
    python scripts/backfill_arxiv_venue_fields.py [--db DSN] [--limit N] [--dry-run]
"""
from __future__ import annotations

import argparse

from psycopg2.extras import execute_values

from aisafety_pipeline.db import connect, get_state, set_state
from aisafety_pipeline.oai import ARXIV_API_BATCH, fetch_arxiv_venue_fields

STATE_KEY = "arxiv_venue_backfill"

_UPDATE = """
    UPDATE papers_raw AS r
    SET journal_ref = v.journal_ref, doi = v.doi, comments = v.comments
    FROM (VALUES %s) AS v(id, journal_ref, doi, comments)
    WHERE r.id = v.id
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--limit", type=int, default=None, help="Stop after this many papers")
    ap.add_argument("--dry-run", action="store_true", help="Fetch and report, write nothing")
    ap.add_argument("--restart", action="store_true", help="Ignore the saved checkpoint")
    args = ap.parse_args()

    conn = connect(args.db)
    try:
        after = "" if args.restart else (get_state(conn, STATE_KEY) or {}).get("last_id", "")
        rows = conn.execute(
            "SELECT id FROM papers WHERE llm_relevant AND id > %s ORDER BY id",
            (after,),
        ).fetchall()
        ids = [r[0] for r in rows][: args.limit]
        print(f"backfill: {len(ids)} papers to fetch" + (f" (resuming after {after})" if after else ""))

        done = with_any = missing = 0
        cur = conn.raw_cursor()
        for i in range(0, len(ids), ARXIV_API_BATCH):
            chunk = ids[i : i + ARXIV_API_BATCH]
            found = fetch_arxiv_venue_fields(chunk)
            missing += sum(1 for pid in chunk if pid not in found)
            values = [
                (pid, f["journal_ref"], f["doi"], f["comments"])
                for pid, f in found.items()
            ]
            with_any += sum(1 for v in values if any(v[1:]))
            if not args.dry_run:
                if values:
                    execute_values(cur, _UPDATE, values)
                set_state(conn, STATE_KEY, {"last_id": chunk[-1]})  # commits
            done += len(chunk)
            print(f"backfill: {done}/{len(ids)} fetched, {with_any} with any field, {missing} not returned")
        print("backfill: done" + (" (dry run, nothing written)" if args.dry_run else ""))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
