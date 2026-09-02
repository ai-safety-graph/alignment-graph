from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import GREEN
from .embeddings import EmbeddingGenerator
from .filters import load_vectors
from .taxonomy import TAXONOMY

# Cluster labels are zero-shot: each cluster's centroid embedding is matched
# against a fixed, human-curated topic list (`taxonomy.TAXONOMY`) by cosine
# similarity, rather than mined from cluster text via TF-IDF. This trades
# discovering unnamed topics for labels that are stable and meaningful to
# readers -- see the k-sweep results (silhouette highest at k=4, no elbow)
# for why clusters here don't reliably correspond to distinct vocabulary.

def label_clusters_default(conn, method_name: str = "default", topk_terms: int = 4, extra_phrases: list[str] | None = None, cosine_floor: float = 0.60, enforce_unique: bool = True):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cluster_meta (
            method TEXT NOT NULL,
            cluster_id INTEGER NOT NULL,
            label TEXT,
            confidence REAL,
            terms TEXT,
            size INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (method, cluster_id)
        )
    """)
    # In case cluster_meta already existed from before `size` was added.
    try:
        conn.execute("ALTER TABLE cluster_meta ADD COLUMN IF NOT EXISTS size INTEGER")
    except Exception:
        pass
    conn.commit()

    # Paginated by id (keyset), not a single-shot SELECT: title/summary are
    # large TOASTed text columns, and fetching all of them for the full
    # kept+clustered set in one statement can exceed a hosted DB's
    # statement_timeout. Row order doesn't matter downstream (grouping by
    # `cid` below is done with boolean masks, not positionally).
    _LABEL_READ_CHUNK = 5000
    rows_all = []
    last_id = ""
    while True:
        page = conn.execute(
            """
            SELECT id, title, summary, kmeans_cluster AS cid
            FROM papers
            WHERE ai_stage2_keep AND kmeans_cluster IS NOT NULL AND id > %s
            ORDER BY id
            LIMIT %s
            """,
            (last_id, _LABEL_READ_CHUNK),
        ).fetchall()
        if not page:
            break
        rows_all.extend(page)
        last_id = page[-1]["id"]
        if len(page) < _LABEL_READ_CHUNK:
            break
    df = pd.DataFrame([list(r) for r in rows_all], columns=["id", "title", "summary", "cid"])
    if df.empty: return {}
    ids = df["id"].tolist(); cids = df["cid"].to_numpy()

    phrases = sorted(set(TAXONOMY) | set(extra_phrases or []))

    V = load_vectors(conn, ids)
    embs = np.vstack([V[i] for i in ids])
    cents: dict[int, np.ndarray] = {}
    for cid in sorted(df["cid"].unique()):
        idx = np.where(cids == cid)[0]
        if idx.size:
            c = embs[idx].mean(axis=0); c /= (np.linalg.norm(c) + 1e-12)
            cents[int(cid)] = c

    eg = EmbeddingGenerator(batch_size=64)
    phrase_embs = eg.encode(phrases, [""] * len(phrases))
    phrase_embs = phrase_embs / (np.linalg.norm(phrase_embs, axis=1, keepdims=True) + 1e-12)

    semantic_labels: dict[int, dict[str, object]] = {}
    for cid, c in cents.items():
        sims = phrase_embs @ c
        if sims.size == 0:
            semantic_labels[cid] = {"terms": [], "confidence": 0.0}; continue
        top = sims.argsort()[::-1][:max(3, topk_terms)]
        terms = [phrases[i] for i in top]
        conf = float(sims[top[0]])
        semantic_labels[cid] = {"terms": terms, "confidence": conf}

    rep_title: dict[int, dict[str, object]] = {}
    for cid in sorted(df["cid"].unique()):
        idx = np.where(cids == cid)[0]
        if idx.size == 0: continue
        C = embs[idx].mean(axis=0); C /= (np.linalg.norm(C) + 1e-12)
        sims = embs[idx] @ C
        j = idx[sims.argmax()]
        import re as _re
        title = df.iloc[j]["title"] or ""; title = _re.sub(r":.*$", "", title).strip()
        rep_title[int(cid)] = {"title": title, "confidence": float(sims.max())}

    cluster_sizes = {int(cid): int(np.sum(cids == cid)) for cid in df["cid"].unique()}
    order = sorted(cluster_sizes.keys(), key=lambda k: -cluster_sizes[k]) if enforce_unique else sorted(cluster_sizes.keys())

    results: dict[int, dict[str, object]] = {}
    used_primary: set = set(); MIN_TERMS = 1
    for cid in order:
        sem = semantic_labels.get(int(cid), {"terms": [], "confidence": 0.0})
        chosen_label = None
        if len(sem["terms"]) >= MIN_TERMS:
            for t in sem["terms"]:
                if t in used_primary and enforce_unique: continue
                chosen_label = t; used_primary.add(t); break
        if not chosen_label or sem.get("confidence", 0.0) < cosine_floor:
            rt = rep_title.get(int(cid), {"title": "Cluster", "confidence": 0.0})
            label = rt["title"]; terms = [label]; conf = float(rt["confidence"])
        else:
            label = chosen_label; terms = sem["terms"]; conf = float(sem["confidence"])
        results[int(cid)] = {
            "label": label, "terms": terms, "confidence": conf,
            "size": cluster_sizes[int(cid)],
        }

    cur = conn.cursor(); cur.execute("BEGIN")
    for cid, meta in results.items():
        cur.execute(
            """
            INSERT INTO cluster_meta(method, cluster_id, label, confidence, terms, size)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(method, cluster_id) DO UPDATE SET label=excluded.label, confidence=excluded.confidence, terms=excluded.terms, size=excluded.size
            """,
            (method_name, int(cid), meta["label"], float(meta["confidence"]), json.dumps(meta["terms"]), meta["size"])
        )
    cur.execute("COMMIT")
    return results


def cmd_label(args):
    from .db import connect
    conn = connect(args.db)
    try:
        out = label_clusters_default(conn, method_name="default", topk_terms=args.topk, extra_phrases=args.extra and [s.strip() for s in args.extra.split(",") if s.strip()] or None)
        print(f"{GREEN}label:{GREEN} stored labels for {len(out)} clusters (method=default).")
        for cid in sorted(out):
            print(f"  • cluster {cid}: {out[cid]['label']}  (conf={out[cid]['confidence']:.3f})")
    finally:
        conn.close()