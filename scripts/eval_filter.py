#!/usr/bin/env python3
"""
Score stage-2 relevance filtering methods against the hand-labeled set
built by build_relevance_eval_set.py, so the single global centroid and
the multi-centroid (seeds_subtopics.tsv) approach can be compared on the
same yardstick instead of by eyeballing `filter` output -- same idea as
scripts/eval_tagging.py, applied to the stage-2 keep/reject decision
instead of tag selection.

The two methods use tau on different scales (single: raw cosine; multi:
per-group z-score, see filters._col_zscore), so this sweeps each
independently and reports its own best-F1 point rather than assuming a
shared tau is comparable.

Usage:
    python scripts/eval_filter.py
    python scripts/eval_filter.py --seeds seeds.txt --seeds-subtopics seeds_subtopics.tsv
    python scripts/eval_filter.py --sweep=-2.0:2.0:0.1
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
from aisafety_pipeline.filters import (  # noqa: E402
    _col_zscore,
    build_centroid,
    build_group_centroids,
    load_vectors,
)

GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; RESET = "\033[0m"


def parse_sweep(spec: str) -> list[float]:
    lo, hi, step = (float(x) for x in spec.split(":"))
    n = round((hi - lo) / step)
    return [round(lo + i * step, 4) for i in range(n + 1)]


def prf1(scores: dict[str, float], labels: dict[str, bool], tau: float) -> tuple[float, float, float, int, int, int]:
    tp = fp = fn = 0
    for pid, label in labels.items():
        pred = scores[pid] >= tau
        if pred and label:
            tp += 1
        elif pred and not label:
            fp += 1
        elif not pred and label:
            fn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1, tp, fp, fn


def report(name: str, scores: dict[str, float], labels: dict[str, bool], floors: list[float]) -> None:
    print(f"\n{BLUE}{name}{RESET}")
    print(f"{'tau':>7}  {'precision':>9}  {'recall':>7}  {'f1':>6}  {'tp':>4}  {'fp':>4}  {'fn':>4}")
    best = None
    for tau in floors:
        p, r, f1, tp, fp, fn = prf1(scores, labels, tau)
        print(f"{tau:>7.3f}  {p:>9.3f}  {r:>7.3f}  {f1:>6.3f}  {tp:>4}  {fp:>4}  {fn:>4}")
        if best is None or f1 > best[1]:
            best = (tau, f1)
    print(f"{GREEN}{name}:{RESET} best F1={best[1]:.3f} at tau={best[0]:.3f}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--eval-set", default="data/relevance_eval_set.json")
    ap.add_argument("--seeds", default="seeds.txt")
    ap.add_argument("--seeds-subtopics", default="seeds_subtopics.tsv")
    ap.add_argument("--sweep", default="-2.0:2.0:0.1", help="lo:hi:step for both methods' tau ranges")
    args = ap.parse_args()

    eval_path = Path(args.eval_set)
    if not eval_path.exists():
        print(f"{YELLOW}eval:{RESET} {eval_path} not found -- run build_relevance_eval_set.py first.")
        return 1
    eval_set = json.loads(eval_path.read_text())
    if not eval_set:
        print(f"{YELLOW}eval:{RESET} {eval_path} is empty -- label some papers first.")
        return 1

    labels = {pid: entry["relevant"] for pid, entry in eval_set.items()}
    ids = list(labels.keys())
    n_pos = sum(labels.values())
    print(f"{BLUE}eval:{RESET} {len(ids)} papers labeled ({n_pos} relevant, {len(ids) - n_pos} not)\n")

    conn = connect(args.db)
    try:
        V = load_vectors(conn, ids)
        missing = [pid for pid in ids if pid not in V]
        if missing:
            print(f"{YELLOW}eval:{RESET} {len(missing)} labeled paper(s) missing embeddings, skipping them.")
        ids = [pid for pid in ids if pid in V]
        if not ids:
            print(f"{YELLOW}eval:{RESET} no scorable papers.")
            return 1
        labels = {pid: labels[pid] for pid in ids}

        C_single = build_centroid(conn, args.seeds)
        single_scores = {pid: float(V[pid] @ C_single) for pid in ids}

        group_centroids = build_group_centroids(conn, args.seeds_subtopics)
        topics = sorted(group_centroids)
        C_multi = np.vstack([group_centroids[t] for t in topics])
        raw = np.vstack([V[pid] for pid in ids]) @ C_multi.T
        z = _col_zscore(raw)
        best_z = z.max(axis=1)
        multi_scores = {pid: float(best_z[i]) for i, pid in enumerate(ids)}
    finally:
        conn.close()

    floors = parse_sweep(args.sweep)
    report("centroid (single, raw cosine)", single_scores, labels, floors)
    report("centroid-multi (best sub-centroid z-score)", multi_scores, labels, floors)

    print(f"\n{YELLOW}eval:{RESET} pick based on whether you'd rather over- or under-keep "
          f"(precision vs recall), not F1 alone -- then re-check a few papers by eye before "
          f"changing the production --tau for either method.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
