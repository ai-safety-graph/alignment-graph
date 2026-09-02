#!/usr/bin/env python3
"""
Chunked, resumable arXiv OAI-PMH backfill.

Runs `aisafety-pipeline harvest` in date-range chunks instead of one huge
multi-year call. Each chunk is retried a few times on failure (safe, since
harvest upserts are idempotent — ON CONFLICT DO UPDATE) and checkpointed to
disk, so killing/restarting this script skips chunks already completed
instead of rescanning the whole range.

Usage:
    python scripts/run_harvest_chunked.py \
        --db postgresql://user:pass@host:5432/dbname \
        --start 2005-09-16 --end 2024-01-01 --chunk-months 3

Re-run the same command to resume after an interruption — completed chunks
are skipped via the checkpoint file.
"""
from __future__ import annotations

import argparse
import datetime as dt
import subprocess
import sys
import time
from pathlib import Path

GREEN = "\033[92m"; YELLOW = "\033[93m"; RED = "\033[91m"; BLUE = "\033[94m"; RESET = "\033[0m"


def iso(d: dt.date) -> str:
    return d.strftime("%Y-%m-%d")


def add_months(d: dt.date, months: int) -> dt.date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
                       31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return dt.date(y, m, day)


def build_chunks(start: dt.date, end: dt.date, chunk_months: int) -> list[tuple[str, str]]:
    chunks = []
    cur = start
    while cur < end:
        nxt = min(add_months(cur, chunk_months), end)
        chunks.append((iso(cur), iso(nxt)))
        cur = nxt
    return chunks


def load_checkpoint(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {ln.strip() for ln in path.read_text().splitlines() if ln.strip()}


def mark_done(path: Path, key: str) -> None:
    with path.open("a") as f:
        f.write(key + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, help="PostgreSQL DSN for the target database (e.g. your Supabase DSN)")
    ap.add_argument("--start", default="2005-09-16", help="YYYY-MM-DD, backfill start (default: %(default)s)")
    ap.add_argument("--end", default=None, help="YYYY-MM-DD, backfill end (default: today)")
    ap.add_argument("--chunk-months", type=int, default=3, help="Months per chunk (default: %(default)s)")
    ap.add_argument("--max-retries", type=int, default=3, help="Retries per chunk before giving up on it")
    ap.add_argument("--retry-backoff", type=float, default=30.0, help="Seconds, multiplied by attempt number")
    ap.add_argument("--checkpoint", default="data/harvest_chunks_done.txt", help="Progress file")
    ap.add_argument("--state-file", default="data/harvest_chunk_state.txt",
                     help="Dedicated OAI state file for this backfill (kept separate from the normal "
                          "incremental data/last_run.txt so it doesn't get clobbered)")
    ap.add_argument("--run-stage1", action="store_true",
                     help="Run `aisafety-pipeline stage1` once, after all chunks complete")
    args = ap.parse_args()

    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end) if args.end else dt.date.today()
    checkpoint = Path(args.checkpoint)
    checkpoint.parent.mkdir(parents=True, exist_ok=True)

    chunks = build_chunks(start, end, args.chunk_months)
    done = load_checkpoint(checkpoint)

    print(f"{BLUE}Backfill plan:{RESET} {len(chunks)} chunks, {iso(start)} -> {iso(end)}, "
          f"{args.chunk_months} month(s)/chunk. {len(done)} already checkpointed as done.")

    failed: list[str] = []
    for chunk_from, chunk_until in chunks:
        key = f"{chunk_from} {chunk_until}"
        if key in done:
            continue

        print(f"\n{BLUE}=== chunk {chunk_from} -> {chunk_until} ==={RESET}")
        ok = False
        for attempt in range(1, args.max_retries + 1):
            cmd = [
                "aisafety-pipeline", "harvest",
                "--from", chunk_from, "--until", chunk_until,
                "--db", args.db,
                "--state-file", args.state_file,
            ]
            result = subprocess.run(cmd)
            if result.returncode == 0:
                ok = True
                break
            print(f"{YELLOW}chunk {chunk_from}->{chunk_until} failed "
                  f"(attempt {attempt}/{args.max_retries}, exit {result.returncode}){RESET}")
            if attempt < args.max_retries:
                sleep_s = args.retry_backoff * attempt
                print(f"{YELLOW}retrying in {sleep_s:.0f}s...{RESET}")
                time.sleep(sleep_s)

        if ok:
            mark_done(checkpoint, key)
            print(f"{GREEN}chunk {chunk_from}->{chunk_until} done{RESET}")
        else:
            failed.append(key)
            print(f"{RED}giving up on chunk {chunk_from}->{chunk_until} after {args.max_retries} attempts{RESET}")

    print(f"\n{BLUE}=== backfill summary ==={RESET}")
    print(f"{GREEN}completed: {len(chunks) - len(failed)}/{len(chunks)} chunks{RESET}")
    if failed:
        print(f"{RED}failed chunks (rerun this script to retry — already-done chunks are skipped):{RESET}")
        for k in failed:
            print(f"  {k}")

    if args.run_stage1 and not failed:
        print(f"\n{BLUE}running stage1...{RESET}")
        subprocess.run(["aisafety-pipeline", "stage1", "--db", args.db], check=True)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
