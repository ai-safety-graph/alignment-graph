#!/usr/bin/env python3
"""
Score the LLM classification stage (llm_classify.py) against the
hand-labeled set built by build_llm_eval_set.py, WITHOUT writing to the
production `papers` table -- reads paper text read-only, calls
llm_classify.classify_paper directly for each labeled paper, and reports
relevance precision/recall/F1 plus tag-level micro precision/recall/F1
(only over taxonomy phrases the human actually reviewed for a paper, same
convention as eval_tagging.py). Also prints running token/cost totals,
since this script itself spends LLM API budget.

Usage:
    python scripts/eval_llm_classify.py
    python scripts/eval_llm_classify.py --limit 10   # cheap smoke-test
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from aisafety_pipeline import config  # noqa: E402
from aisafety_pipeline.db import connect  # noqa: E402
from aisafety_pipeline.llm_classify import TokenUsage, classify_paper, estimate_cost  # noqa: E402

GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; RESET = "\033[0m"


def prf1(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return precision, recall, f1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--eval-set", default="data/llm_eval_set.json")
    ap.add_argument("--model", default=config.LLM_MODEL)
    ap.add_argument("--limit", type=int, default=None, help="Score at most N eval-set papers")
    args = ap.parse_args()

    eval_path = Path(args.eval_set)
    if not eval_path.exists():
        print(f"{YELLOW}eval:{RESET} {eval_path} not found -- run build_llm_eval_set.py first.")
        return 1
    eval_set = json.loads(eval_path.read_text())
    if not eval_set:
        print(f"{YELLOW}eval:{RESET} {eval_path} is empty -- label some papers first.")
        return 1

    ids = list(eval_set.keys())
    if args.limit is not None:
        ids = ids[: args.limit]

    conn = connect(args.db)
    try:
        rows = conn.execute(
            "SELECT id, title, summary FROM papers WHERE id = ANY(%s)",
            (ids,),
        ).fetchall()
    finally:
        conn.close()
    text_by_id = {r["id"]: (r["title"], r["summary"]) for r in rows}
    missing = [pid for pid in ids if pid not in text_by_id]
    if missing:
        print(f"{YELLOW}eval:{RESET} {len(missing)} eval-set paper(s) no longer in `papers`, skipping them.")
    ids = [pid for pid in ids if pid in text_by_id]
    if not ids:
        print(f"{YELLOW}eval:{RESET} no scorable papers.")
        return 1

    print(f"{BLUE}eval:{RESET} scoring {len(ids)} papers against model={args.model!r}\n")

    rel_tp = rel_fp = rel_fn = rel_tn = 0
    tag_tp = tag_fp = tag_fn = 0
    total_usage = TokenUsage()
    errors = 0

    for pid in ids:
        title, summary = text_by_id[pid]
        entry = eval_set[pid]
        gold_relevant = entry["relevant"]
        gold_tags: dict[str, bool] = entry.get("tags") or {}

        try:
            classification, usage = classify_paper(title, summary or "", model=args.model)
        except Exception as exc:
            errors += 1
            print(f"{YELLOW}eval:{RESET} error classifying {pid}: {exc}")
            continue

        total_usage.prompt_tokens += usage.prompt_tokens
        total_usage.cached_tokens += usage.cached_tokens
        total_usage.completion_tokens += usage.completion_tokens

        pred_relevant = classification.relevant
        if pred_relevant and gold_relevant:
            rel_tp += 1
        elif pred_relevant and not gold_relevant:
            rel_fp += 1
        elif not pred_relevant and gold_relevant:
            rel_fn += 1
        else:
            rel_tn += 1

        predicted_tags = set(classification.tags)
        for phrase, is_correct in gold_tags.items():
            pred = phrase in predicted_tags
            if pred and is_correct:
                tag_tp += 1
            elif pred and not is_correct:
                tag_fp += 1
            elif not pred and is_correct:
                tag_fn += 1
            # not pred and not correct: true negative, not scored

    rel_p, rel_r, rel_f1 = prf1(rel_tp, rel_fp, rel_fn)
    tag_p, tag_r, tag_f1 = prf1(tag_tp, tag_fp, tag_fn)

    print(f"{BLUE}relevance{RESET}  precision={rel_p:.3f} recall={rel_r:.3f} f1={rel_f1:.3f} "
          f"(tp={rel_tp} fp={rel_fp} fn={rel_fn} tn={rel_tn})")
    print(f"{BLUE}tags{RESET}       precision={tag_p:.3f} recall={tag_r:.3f} f1={tag_f1:.3f} "
          f"(tp={tag_tp} fp={tag_fp} fn={tag_fn})")
    if errors:
        print(f"{YELLOW}eval:{RESET} {errors} paper(s) failed to classify (parse/retry errors).")

    cost = estimate_cost(args.model, total_usage)
    cost_str = f"${cost:.2f}" if cost is not None else "n/a"
    print(
        f"\n{GREEN}eval:{RESET} tokens(prompt={total_usage.prompt_tokens} "
        f"cached={total_usage.cached_tokens} completion={total_usage.completion_tokens}) "
        f"est_cost={cost_str}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
