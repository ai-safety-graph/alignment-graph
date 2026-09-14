#!/usr/bin/env python3
"""
Interactively build a hand-labeled ground-truth set for stage-2 relevance
("is this paper actually about AI safety/alignment?"), by sampling papers
that made it past stage 1 and asking a human to judge each one -- so
stage-2 filtering methods (single centroid vs. multi-centroid, different
tau) can be scored against a fixed yardstick instead of eyeballed sample
output, the same way scripts/eval_tagging.py scores tagging quality.

Scope / known limitation: this samples from `papers` (stage-1 survivors
only), stratified across the current ai_regex_hit / ai_stage2_keep split
so the reviewer sees a mix of clear hits, borderline cases, and current
rejects -- not from `papers_raw`. It can measure stage-2 precision/recall
(and compare stage-2 methods against each other), but NOT stage-1 recall,
since papers stage 1's regex already dropped never reach `papers` at all
and so are never sampled here. That's a separate, larger gap (see
CLAUDE.md-adjacent discussion) that would need sampling from `papers_raw`
and embedding candidates that currently never get embedded.

Usage:
    python scripts/build_relevance_eval_set.py --n 30
    python scripts/build_relevance_eval_set.py --n 30 --out data/relevance_eval_set.json
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from aisafety_pipeline.db import connect  # noqa: E402

GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; RESET = "\033[0m"


def load_eval_set(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_eval_set(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True))


def prompt_yes_no(prompt: str) -> bool | None:
    while True:
        ans = input(prompt).strip().lower()
        if ans in ("y", "yes"):
            return True
        if ans in ("n", "no"):
            return False
        if ans in ("s", "skip"):
            return None
        print("  please answer y, n, or s (skip)")


def stratified_sample(rows: list[dict], n: int, rng: random.Random) -> list[dict]:
    """Split candidates into (regex_hit, stage2_keep) strata and sample
    roughly evenly across them, so the eval set isn't dominated by
    whichever stratum happens to be largest (usually regex_hit=1,
    stage2_keep=1) -- borderline/rejected papers are exactly the ones
    that best distinguish filtering methods from each other.
    """
    strata: dict[tuple, list[dict]] = {}
    for r in rows:
        key = (bool(r["ai_regex_hit"]), bool(r["ai_stage2_keep"]))
        strata.setdefault(key, []).append(r)
    for group in strata.values():
        rng.shuffle(group)

    out: list[dict] = []
    keys = list(strata.keys())
    i = 0
    while len(out) < n and any(strata.values()):
        key = keys[i % len(keys)]
        if strata[key]:
            out.append(strata[key].pop())
        i += 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--n", type=int, default=30, help="Number of new papers to review this session")
    ap.add_argument("--out", default="data/relevance_eval_set.json")
    ap.add_argument("--seed", type=int, default=None, help="Random seed for sampling (unset = different sample each run)")
    args = ap.parse_args()

    out_path = Path(args.out)
    eval_set = load_eval_set(out_path)
    already_reviewed = set(eval_set.keys())

    conn = connect(args.db)
    try:
        rows = conn.execute(
            """
            SELECT id, title, summary, ai_regex_hit, ai_stage2_keep
            FROM papers
            """
        ).fetchall()
    finally:
        conn.close()

    candidates = [dict(r) for r in rows if r["id"] not in already_reviewed]
    if not candidates:
        print(f"{YELLOW}eval-set:{RESET} no unreviewed papers left.")
        return 0

    rng = random.Random(args.seed)
    batch = stratified_sample(candidates, args.n, rng)

    print(f"{BLUE}eval-set:{RESET} reviewing {len(batch)} papers, "
          f"{len(already_reviewed)} already done -> {out_path}\n")
    print("Is this paper actually about AI safety / alignment / governance? y/n/s (skip)\n")

    for r in batch:
        pid, title, summary = r["id"], r["title"], r["summary"]
        print(f"{'-' * 70}\n{BLUE}{pid}{RESET}\n{title}\n")
        print((summary or "")[:500] + ("..." if summary and len(summary) > 500 else ""))
        print(f"\n  [current: regex_hit={bool(r['ai_regex_hit'])} stage2_keep={bool(r['ai_stage2_keep'])}]")

        ans = prompt_yes_no("  Relevant? (y/n/s) ")
        print()
        if ans is None:
            continue
        eval_set[pid] = {"title": title, "relevant": ans}
        save_eval_set(out_path, eval_set)

    print(f"{GREEN}eval-set:{RESET} wrote {out_path} ({len(eval_set)} papers reviewed total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
