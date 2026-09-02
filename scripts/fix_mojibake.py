#!/usr/bin/env python3
"""
Fix UTF-8-decoded-as-Latin-1 mojibake left over from the old SQLite pipeline
(e.g. "FranÃ§ois" -> "François") in the PostgreSQL database.

The corruption happened when the original harvester wrote UTF-8 bytes into
SQLite after decoding them as Latin-1/cp1252, so the bad text was carried
verbatim into Postgres by the (now-removed) sqlite_to_postgres.py migration
-- no encoding conversion happened there.

The fix: for the affected text columns, try
    value.encode("latin-1").decode("utf-8")
This only succeeds when `value` is itself the mojibake pattern (the encode
step recovers the original UTF-8 byte sequence, and the decode step parses
it back into the correct characters). Correctly-stored UTF-8 text almost
always raises UnicodeDecodeError on this roundtrip and is left untouched;
pure ASCII round-trips to itself, so it's also a safe no-op.

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

from aisafety_pipeline.db import connect  # noqa: E402

# (table, primary key column, [text columns to check])
TARGETS = [
    ("papers", "id", ["title", "authors", "summary", "domain_tag"]),
]

# Scope to the papers that actually made it through stage-2 filtering --
# these are the only ones the API/UI ever surfaces.
WHERE_CLAUSE = "ai_stage2_keep = true"


def try_fix(value: str | None) -> str | None:
    if not value:
        return None
    try:
        fixed = value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    if fixed == value:
        return None
    return fixed


BATCH = 2000


def process_simple_table(conn, table: str, pk: str, columns: list[str], apply: bool, where: str | None = None):
    col_list = ", ".join([pk] + columns)
    base_where = f"({where})" if where else None
    changed = 0
    total = 0
    samples = []
    last_pk = None
    while True:
        if last_pk is None:
            clause = f"WHERE {base_where}" if base_where else ""
            batch_rows = conn.execute(
                f"SELECT {col_list} FROM {table} {clause} ORDER BY {pk} LIMIT {BATCH}"
            ).fetchall()
        else:
            clause = f"WHERE {base_where} AND {pk} > %s" if base_where else f"WHERE {pk} > %s"
            batch_rows = conn.execute(
                f"SELECT {col_list} FROM {table} {clause} ORDER BY {pk} LIMIT {BATCH}",
                (last_pk,),
            ).fetchall()
        if not batch_rows:
            break
        last_pk = batch_rows[-1][pk]
        total += len(batch_rows)
        for r in batch_rows:
            updates = {}
            for col in columns:
                fixed = try_fix(r[col])
                if fixed is not None:
                    updates[col] = fixed
            if updates:
                changed += 1
                if len(samples) < 8:
                    samples.append((r[pk], updates))
                if apply:
                    set_clause = ", ".join(f"{c} = %({c})s" for c in updates)
                    params = dict(updates)
                    params["pk"] = r[pk]
                    conn.execute(
                        f"UPDATE {table} SET {set_clause} WHERE {pk} = %(pk)s", params
                    )
        if apply:
            conn.commit()
        print(f"  … {total} rows scanned", end="\r", file=sys.stderr)
    print(file=sys.stderr)
    return changed, total, samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write fixes (default: dry run)")
    args = ap.parse_args()

    conn = connect()
    total_changed = 0
    for table, pk, columns in TARGETS:
        changed, total, samples = process_simple_table(
            conn, table, pk, columns, args.apply, where=WHERE_CLAUSE
        )
        total_changed += changed
        print(f"\n{table}: {changed}/{total} rows with mojibake" + (" (fixed)" if args.apply else " (would fix)"))
        for pk_val, updates in samples:
            for col, new_val in updates.items():
                print(f"  [{pk_val}] {col}: {new_val!r}")

    print(f"\n{'Applied' if args.apply else 'Would apply'} fixes to {total_changed} row(s) total.")
    if not args.apply and total_changed:
        print("Re-run with --apply to write these changes.")


if __name__ == "__main__":
    main()
