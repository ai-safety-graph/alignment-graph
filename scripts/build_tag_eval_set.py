#!/usr/bin/env python3
"""
Interactively build a hand-labeled ground-truth set for tagging quality,
by sampling kept papers and asking a human to judge the taxonomy phrases
closest to each one -- not just whichever the current floor happens to
keep, so the resulting eval set stays usable after floor/top_n/embedding
changes rather than only reflecting today's config.

For each sampled paper, shows the top `--candidates` taxonomy phrases by
raw cosine similarity (regardless of the tagging floor) and asks y/n for
each. Progress is written after every paper, so runs are resumable and
`--n` just controls how many *additional* papers to review this session.

Usage:
    python scripts/build_tag_eval_set.py --n 30
    python scripts/build_tag_eval_set.py --n 30 --out data/tag_eval_set.json
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
from aisafety_pipeline.embeddings import TopicEmbeddingGenerator  # noqa: E402
from aisafety_pipeline.filters import load_vectors  # noqa: E402
from aisafety_pipeline.taxonomy import TAXONOMY, embedding_texts  # noqa: E402

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
        print("  please answer y, n, or s (skip this paper)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--n", type=int, default=30, help="Number of new papers to review this session")
    ap.add_argument("--candidates", type=int, default=8, help="Top-K phrases by raw similarity shown per paper")
    ap.add_argument("--out", default="data/tag_eval_set.json")
    ap.add_argument("--seed", type=int, default=None, help="Random seed for sampling (unset = different sample each run)")
    ap.add_argument("--dump", default=None,
                    help="Skip the interactive y/n prompts and write raw candidates "
                         "(paper text + top-K phrases/scores) to this JSON path instead, "
                         "for an external reviewer to label offline.")
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
        candidates = [r for r in rows if r["id"] not in already_reviewed]
        if not candidates:
            print(f"{YELLOW}eval-set:{RESET} no unreviewed kept+embedded papers left.")
            return 0

        rng = random.Random(args.seed)
        rng.shuffle(candidates)
        batch = candidates[: args.n]
        meta = {r["id"]: (r["title"], r["summary"]) for r in batch}
        ids = [r["id"] for r in batch]

        V = load_vectors(conn, ids, model="topic")
        ids = [pid for pid in ids if pid in V]
        if not ids:
            print(f"{YELLOW}eval-set:{RESET} sampled papers have no topic embedding.")
            return 1

        phrases = list(TAXONOMY)
        eg = TopicEmbeddingGenerator(batch_size=64)
        phrase_embs = eg.encode_queries(embedding_texts(phrases))
        import numpy as np
        phrase_embs = phrase_embs / (np.linalg.norm(phrase_embs, axis=1, keepdims=True) + 1e-12)
    finally:
        conn.close()

    if args.dump:
        dump = []
        for pid in ids:
            title, summary = meta[pid]
            emb = V[pid]
            sims = phrase_embs @ emb
            order = np.argsort(sims)[::-1][: args.candidates]
            dump.append({
                "id": pid,
                "title": title,
                "summary": summary,
                "candidates": [{"phrase": phrases[j], "score": float(sims[j])} for j in order],
            })
        dump_path = Path(args.dump)
        dump_path.parent.mkdir(parents=True, exist_ok=True)
        dump_path.write_text(json.dumps(dump, indent=2))
        print(f"{GREEN}eval-set:{RESET} dumped {len(dump)} papers' candidates to {dump_path}")
        return 0

    print(f"{BLUE}eval-set:{RESET} reviewing {len(ids)} papers, "
          f"{len(already_reviewed)} already done -> {out_path}\n")
    print("For each phrase: y = correct tag, n = not a correct tag, s = skip this paper entirely\n")

    for pid in ids:
        title, summary = meta[pid]
        emb = V[pid]
        sims = phrase_embs @ emb
        order = np.argsort(sims)[::-1][: args.candidates]

        print(f"{'-' * 70}\n{BLUE}{pid}{RESET}\n{title}\n")
        print((summary or "")[:500] + ("..." if summary and len(summary) > 500 else ""))
        print()

        reviewed: dict[str, bool] = {}
        skipped = False
        for j in order:
            phrase = phrases[j]
            score = float(sims[j])
            ans = prompt_yes_no(f"  [{score:.3f}] {phrase}? (y/n/s) ")
            if ans is None:
                skipped = True
                break
            reviewed[phrase] = ans
        print()

        if skipped:
            continue
        eval_set[pid] = {"title": title, "reviewed": reviewed}
        save_eval_set(out_path, eval_set)

    print(f"{GREEN}eval-set:{RESET} wrote {out_path} ({len(eval_set)} papers reviewed total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
