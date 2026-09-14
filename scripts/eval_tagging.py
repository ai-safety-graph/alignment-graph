#!/usr/bin/env python3
"""
Score the tagging algorithm's precision/recall against a hand-labeled
eval set built by build_tag_eval_set.py, for one floor or a sweep of
floors -- so floor/top_n/embedding changes can be judged against a fixed
yardstick instead of by eyeballing sample output.

Only the taxonomy phrases a human actually reviewed for a given paper
count toward that paper's score (the eval set records the top-K phrases
by raw similarity at review time, not the full taxonomy) -- a predicted
tag outside the reviewed set is excluded from precision for that paper,
and recall is computed only over reviewed positives.

Scores are per-phrase z-scores (see aisafety_pipeline.tagging.zscore), not
raw cosine similarity -- some taxonomy phrases sit in a denser region of
embedding space than others (generic-sounding phrases like "robustness and
generalization" score high against nearly every paper regardless of topic),
so a shared floor only makes sense once each phrase's column is standardized
against its own corpus-wide mean/std.

Usage:
    python scripts/eval_tagging.py                        # score the current CLI default (floor=0.8, top_n=2)
    python scripts/eval_tagging.py --floor 0.5
    python scripts/eval_tagging.py --sweep=-0.5:2.0:0.1    # scan floors, report precision/recall/F1 per floor
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from aisafety_pipeline.db import connect  # noqa: E402
from aisafety_pipeline.filters import load_vectors  # noqa: E402
from aisafety_pipeline.tagging import (  # noqa: E402
    corpus_phrase_similarities,
    encode_phrases,
    phrase_stats,
    select_tags,
    zscore,
)
from aisafety_pipeline.taxonomy import TAXONOMY  # noqa: E402

GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; RESET = "\033[0m"


def score_at(
    sims_by_paper: dict[str, np.ndarray],
    reviewed_by_paper: dict[str, dict[str, bool]],
    phrases: list[str],
    floor: float,
    top_n: int,
) -> tuple[float, float, float, int, int, int]:
    """Micro precision/recall/F1 over reviewed phrases only. Returns (p, r, f1, tp, fp, fn)."""
    tp = fp = fn = 0
    for pid, sims_row in sims_by_paper.items():
        reviewed = reviewed_by_paper[pid]
        predicted = {tag for tag, _ in select_tags(sims_row, phrases, floor, top_n)}
        for phrase, is_correct in reviewed.items():
            pred = phrase in predicted
            if pred and is_correct:
                tp += 1
            elif pred and not is_correct:
                fp += 1
            elif not pred and is_correct:
                fn += 1
            # not pred and not correct: true negative, not scored (no precision/recall signal)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1, tp, fp, fn


def parse_sweep(spec: str) -> list[float]:
    lo, hi, step = (float(x) for x in spec.split(":"))
    n = round((hi - lo) / step)
    return [round(lo + i * step, 4) for i in range(n + 1)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--eval-set", default="data/tag_eval_set.json")
    ap.add_argument("--floor", type=float, default=0.8)
    ap.add_argument("--top-n", type=int, default=2, dest="top_n")
    ap.add_argument("--sweep", default=None, help="lo:hi:step, e.g. -0.5:2.0:0.1 -- overrides --floor")
    args = ap.parse_args()

    eval_path = Path(args.eval_set)
    if not eval_path.exists():
        print(f"{YELLOW}eval:{RESET} {eval_path} not found -- run build_tag_eval_set.py first.")
        return 1
    eval_set = json.loads(eval_path.read_text())
    if not eval_set:
        print(f"{YELLOW}eval:{RESET} {eval_path} is empty.")
        return 1

    reviewed_by_paper = {pid: entry["reviewed"] for pid, entry in eval_set.items()}
    ids = list(reviewed_by_paper.keys())

    phrases = list(TAXONOMY)
    phrase_embs = encode_phrases(phrases)

    conn = connect(args.db)
    try:
        V = load_vectors(conn, ids, model="topic")
        # Corpus-wide phrase stats for z-score normalization -- computed from
        # the full tagged population, not the (small, similarity-biased) eval
        # set, so it matches what tag_papers_default uses in production.
        _, corpus_sims = corpus_phrase_similarities(conn, phrase_embs)
    finally:
        conn.close()
    missing = [pid for pid in ids if pid not in V]
    if missing:
        print(f"{YELLOW}eval:{RESET} {len(missing)} eval-set paper(s) missing topic embeddings, skipping them.")
    ids = [pid for pid in ids if pid in V]
    if not ids:
        print(f"{YELLOW}eval:{RESET} no scorable papers (none have topic embeddings).")
        return 1

    mean, std = phrase_stats(corpus_sims)
    sims_by_paper = {pid: zscore(phrase_embs @ V[pid], mean, std) for pid in ids}
    n_reviewed_pairs = sum(len(reviewed_by_paper[pid]) for pid in ids)
    print(f"{BLUE}eval:{RESET} {len(ids)} papers, {n_reviewed_pairs} reviewed phrase judgments\n")

    floors = parse_sweep(args.sweep) if args.sweep else [args.floor]
    print(f"{'floor':>6}  {'precision':>9}  {'recall':>7}  {'f1':>6}  {'tp':>4}  {'fp':>4}  {'fn':>4}")
    best = None
    for floor in floors:
        p, r, f1, tp, fp, fn = score_at(sims_by_paper, reviewed_by_paper, phrases, floor, args.top_n)
        print(f"{floor:>6.3f}  {p:>9.3f}  {r:>7.3f}  {f1:>6.3f}  {tp:>4}  {fp:>4}  {fn:>4}")
        if best is None or f1 > best[1]:
            best = (floor, f1)

    if args.sweep:
        print(f"\n{GREEN}eval:{RESET} highest F1: floor={best[0]:.3f} (F1={best[1]:.3f})")
        print(f"{YELLOW}eval:{RESET} pick based on whether you'd rather over- or under-tag "
              f"(precision vs recall), not F1 alone -- then re-check a few papers by eye before committing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
