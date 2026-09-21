#!/usr/bin/env python3
"""
Interactively build a hand-labeled ground-truth set for the combined
LLM relevance + taxonomy classification stage (llm_classify.py), by
sampling stage-2-kept, topic-embedded papers and asking a human to judge
both relevance and which taxonomy phrases apply -- merges the two label
types build_relevance_eval_set.py and build_tag_eval_set.py collect
separately, since llm_classify.py produces both from one call and needs
both to be scored (see eval_llm_classify.py).

Progress is written after every paper, so runs are resumable and `--n`
just controls how many *additional* papers to review this session.

Usage:
    python scripts/build_llm_eval_set.py --n 40
    python scripts/build_llm_eval_set.py --n 40 --out data/llm_eval_set.json
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
from aisafety_pipeline.taxonomy import TAXONOMY  # noqa: E402

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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--n", type=int, default=30, help="Number of new papers to review this session")
    ap.add_argument("--out", default="data/llm_eval_set.json")
    ap.add_argument("--seed", type=int, default=None, help="Random seed for sampling (unset = different sample each run)")
    args = ap.parse_args()

    out_path = Path(args.out)
    eval_set = load_eval_set(out_path)
    already_reviewed = set(eval_set.keys())

    conn = connect(args.db)
    try:
        rows = conn.execute(
            """
            SELECT id, title, summary FROM papers
            WHERE ai_stage2_keep AND embedding_topic IS NOT NULL
            ORDER BY id
            """
        ).fetchall()
    finally:
        conn.close()

    candidates = [r for r in rows if r["id"] not in already_reviewed]
    if not candidates:
        print(f"{YELLOW}eval-set:{RESET} no unreviewed kept+embedded papers left.")
        return 0

    rng = random.Random(args.seed)
    rng.shuffle(candidates)
    batch = candidates[: args.n]

    print(f"{BLUE}eval-set:{RESET} reviewing {len(batch)} papers, "
          f"{len(already_reviewed)} already done -> {out_path}\n")
    print("First: is this paper actually about AI safety / alignment / governance? y/n/s (skip)")
    print("If yes, you'll then be asked y/n for each taxonomy phrase.\n")

    for r in batch:
        pid, title, summary = r["id"], r["title"], r["summary"]
        print(f"{'-' * 70}\n{BLUE}{pid}{RESET}\n{title}\n")
        print((summary or "")[:500] + ("..." if summary and len(summary) > 500 else ""))
        print()

        relevant = prompt_yes_no("  Relevant? (y/n/s) ")
        print()
        if relevant is None:
            continue

        tags: dict[str, bool] = {}
        if relevant:
            print("  Which taxonomy phrases apply?")
            for phrase in TAXONOMY:
                ans = prompt_yes_no(f"    {phrase}? (y/n/s) ")
                if ans is None:
                    break
                tags[phrase] = ans
            print()

        eval_set[pid] = {"title": title, "relevant": relevant, "tags": tags}
        save_eval_set(out_path, eval_set)

    print(f"{GREEN}eval-set:{RESET} wrote {out_path} ({len(eval_set)} papers reviewed total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
