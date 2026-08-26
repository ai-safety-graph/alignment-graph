#!/usr/bin/env python3
"""
Sweep k-means over a range of k on the stage-2-kept papers, reporting
inertia (elbow) and silhouette score for each k, to help pick a better
`--kmeans` value for `aisafety-pipeline cluster` than an arbitrary default.

Scoped to `ai_stage2_keep = TRUE` only -- the same set `cluster` itself
clusters -- not the full harvested corpus.

Usage:
    python scripts/sweep_kmeans_k.py --db postgresql://...
    python scripts/sweep_kmeans_k.py --k-min 4 --k-max 30 --k-step 2
    python scripts/sweep_kmeans_k.py --out data/kmeans_k_sweep.csv
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from aisafety_pipeline.db import connect  # noqa: E402
from aisafety_pipeline.clustering import (  # noqa: E402
    ClusterManager,
    compute_and_store_missing_embeddings,
    get_papers,
    load_embeddings_for_df,
)

GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; RESET = "\033[0m"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=None, help="PostgreSQL DSN; defaults to $DATABASE_URL")
    ap.add_argument("--k-min", type=int, default=4)
    ap.add_argument("--k-max", type=int, default=30)
    ap.add_argument("--k-step", type=int, default=2)
    ap.add_argument("--n-init", type=int, default=10, help="Matches `cluster`'s default n_init")
    ap.add_argument("--reduce-dim", type=int, default=None, help="Optional PCA dim before k-means, matches `cluster --reduce-dim`")
    ap.add_argument("--silhouette-sample", type=int, default=5000,
                     help="Cap on points used for silhouette (it's O(n^2)); use --full-silhouette to disable")
    ap.add_argument("--full-silhouette", action="store_true", help="Compute silhouette on every kept paper, no sampling")
    ap.add_argument("--device", default="auto", help="Used only if any kept paper is missing an embedding")
    ap.add_argument("--out", default="data/kmeans_k_sweep.csv")
    args = ap.parse_args()

    conn = connect(args.db)
    try:
        df = get_papers(conn, only_kept=True)
        if df.empty:
            print(f"{YELLOW}sweep:{RESET} no stage-2-kept papers found (ai_stage2_keep is empty).")
            return 1
        print(f"{BLUE}sweep:{RESET} {len(df)} stage-2-kept papers")

        compute_and_store_missing_embeddings(conn, df, device=args.device)
        X = load_embeddings_for_df(conn, df)
    finally:
        conn.close()

    cm = ClusterManager(X, normalise=True, pca_dim=args.reduce_dim)
    X = cm.embeddings  # normalized (+ optionally PCA-reduced), same preprocessing `cluster` uses

    sample_size = None if args.full_silhouette else min(args.silhouette_sample, len(X))

    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    ks = list(range(args.k_min, args.k_max + 1, args.k_step))
    rows = []
    print(f"\n{'k':>4}  {'inertia':>14}  {'silhouette':>10}  {'time':>6}")
    for k in ks:
        t0 = time.time()
        km = KMeans(n_clusters=k, random_state=42, n_init=args.n_init)
        labels = km.fit_predict(X)
        sil = silhouette_score(X, labels, sample_size=sample_size, random_state=42)
        elapsed = time.time() - t0
        rows.append((k, km.inertia_, sil))
        print(f"{k:>4}  {km.inertia_:>14.2f}  {sil:>10.4f}  {elapsed:>5.1f}s")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        f.write("k,inertia,silhouette\n")
        for k, inertia, sil in rows:
            f.write(f"{k},{inertia},{sil}\n")

    best_k, _, best_sil = max(rows, key=lambda r: r[2])
    print(f"\n{GREEN}sweep:{RESET} wrote {out_path} ({len(rows)} k values)")
    print(f"{GREEN}sweep:{RESET} highest silhouette: k={best_k} (silhouette={best_sil:.4f})")
    print(f"{YELLOW}sweep:{RESET} pick the elbow in `inertia`, cross-check against the silhouette peak, "
          f"then sample some actual papers from a couple of candidate k's before committing -- "
          f"neither metric knows what a human would call a coherent topic.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
