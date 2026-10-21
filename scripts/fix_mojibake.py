#!/usr/bin/env python3
"""
Fix UTF-8-decoded-as-Latin-1 mojibake (e.g. "PaweÅ\\x82 Batorski" ->
"Paweł Batorski") in `papers_raw` and `papers`.

arXiv's OAI-PMH responses omit a charset, so before commit 74c7dec the
harvester let `requests` decode them as ISO-8859-1 and stored the mojibake.
New harvests are clean; this repairs the rows written before the fix.

Both tables are repaired: stage1 (`--full`) re-copies title/authors/summary
from `papers_raw` into `papers`, so fixing `papers` alone would be undone.

See `aisafety_pipeline.text_fix.fix_mojibake` for the repair rules.

Usage:
    DATABASE_URL=postgresql://... python scripts/fix_mojibake.py            # dry run, reports counts + samples
    DATABASE_URL=postgresql://... python scripts/fix_mojibake.py --apply    # writes the fixes
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from psycopg2.extras import execute_values  # noqa: E402

from aisafety_pipeline.db import connect  # noqa: E402
from aisafety_pipeline.text_fix import fix_mojibake  # noqa: E402

TABLES = ["papers_raw", "papers"]
COLUMNS = ["title", "authors", "summary"]

# Postgres-side prefilter: a mojibake sequence anywhere, or (authors only)
# a bare "Ã" closing a word, left behind when the harvester stripped \xa0.
_SEQ = r"[Â-ô][\u0080-¿]"
_PREFILTER = (
    f"title ~ '{_SEQ}' OR summary ~ '{_SEQ}' OR authors ~ '{_SEQ}' "
    r"OR authors ~ 'Ã([, ]|$)'"
)

# Keys per id-range window; each window's regex scan is bounded so it stays
# well under the DB's statement_timeout.
WINDOW = 5000


def _fix_row(row) -> dict[str, str]:
    updates = {}
    for col in COLUMNS:
        fixed = fix_mojibake(row[col], restore_stripped_nbsp=(col == "authors"))
        if fixed != row[col]:
            updates[col] = fixed
    return updates


def process_table(conn, table: str, apply: bool):
    write_cur = conn.raw_cursor()
    changed = scanned = 0
    per_col = dict.fromkeys(COLUMNS, 0)
    samples = []
    last_id = ""
    while True:
        bound = conn.execute(
            f"SELECT max(id) AS hi, count(*) AS n FROM "
            f"(SELECT id FROM {table} WHERE id > %s ORDER BY id LIMIT {WINDOW}) w",
            (last_id,),
        ).fetchone()
        if not bound["n"]:
            break
        hi = bound["hi"]
        rows = conn.execute(
            f"SELECT id, {', '.join(COLUMNS)} FROM {table} "
            f"WHERE id > %s AND id <= %s AND ({_PREFILTER})",
            (last_id, hi),
        ).fetchall()
        scanned += bound["n"]
        last_id = hi

        batch = []
        for r in rows:
            updates = _fix_row(r)
            if not updates:
                continue
            changed += 1
            for col in updates:
                per_col[col] += 1
            if len(samples) < 10:
                samples.append((r["id"], {c: (r[c], v) for c, v in updates.items()}))
            merged = {c: updates.get(c, r[c]) for c in COLUMNS}
            batch.append((r["id"], merged["title"], merged["authors"], merged["summary"]))

        if apply and batch:
            execute_values(
                write_cur,
                f"UPDATE {table} AS t SET title = v.title, authors = v.authors, summary = v.summary "
                "FROM (VALUES %s) AS v(id, title, authors, summary) WHERE t.id = v.id",
                batch,
                page_size=500,
            )
            conn.commit()
        print(f"  … {table}: {scanned} rows scanned, {changed} to fix", end="\r", file=sys.stderr)
    print(file=sys.stderr)
    return changed, scanned, per_col, samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write fixes (default: dry run)")
    args = ap.parse_args()

    conn = connect()
    total_changed = 0
    for table in TABLES:
        changed, scanned, per_col, samples = process_table(conn, table, args.apply)
        total_changed += changed
        cols = ", ".join(f"{c}={n}" for c, n in per_col.items())
        print(f"\n{table}: {changed}/{scanned} rows with mojibake ({cols})"
              + (" (fixed)" if args.apply else " (would fix)"))
        for pk_val, updates in samples:
            for col, (old, new) in updates.items():
                print(f"  [{pk_val}] {col}:\n      {old[:120]!r}\n   -> {new[:120]!r}")

    print(f"\n{'Applied' if args.apply else 'Would apply'} fixes to {total_changed} row(s) total.")
    if not args.apply and total_changed:
        print("Re-run with --apply to write these changes.")


if __name__ == "__main__":
    main()
