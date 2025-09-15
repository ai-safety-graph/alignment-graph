from __future__ import annotations
import re, json, sqlite3, numpy as np, pandas as pd
from typing import Dict, List, Optional
from sklearn.feature_extraction.text import TfidfVectorizer
from .embeddings import EmbeddingGenerator
from .config import GREEN
from .filters import load_vectors

# (Same logic as your labeler, with docstrings and modularized persistence)

def label_clusters_default(conn, method_name: str = "default", topk_terms: int = 4, ngram_range=(2,3), min_df: int = 6, max_df: float = 0.35, extra_phrases: Optional[List[str]] = None, cosine_floor: float = 0.60, enforce_unique: bool = True):
    GENERIC_LABEL_STOPLIST = {"artificial","intelligence","language","agent","agents","model","models","system","systems","approach","method","task","dataset","framework","paper","study"}
    _LABEL_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
    def _is_generic_phrase(phrase: str) -> bool:
        toks = _LABEL_TOKEN_RE.findall((phrase or "").lower());
        if not toks: return True
        norm = [t[:-1] if t.endswith("s") and len(t) > 3 else t for t in toks]
        if len(norm) == 1 and norm[0] in GENERIC_LABEL_STOPLIST: return True
        if all(t in GENERIC_LABEL_STOPLIST for t in norm): return True
        return False

    conn.execute("""
        CREATE TABLE IF NOT EXISTS cluster_meta (
            method TEXT NOT NULL,
            cluster_id INTEGER NOT NULL,
            label TEXT,
            confidence REAL,
            terms TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (method, cluster_id)
        )
    """)
    conn.commit()

    df = pd.read_sql_query("""
        SELECT p.id, p.title, p.summary, p.kmeans_cluster AS cid
        FROM papers AS p
        WHERE p.ai_stage2_keep=1 AND p.kmeans_cluster IS NOT NULL
        ORDER BY p.kmeans_cluster ASC
    """, conn)
    if df.empty: return {}
    ids = df["id"].tolist(); cids = df["cid"].to_numpy()
    texts = (df["title"].fillna("") + ". " + df["summary"].fillna("")).tolist()

    vec = TfidfVectorizer(stop_words="english", ngram_range=ngram_range, min_df=min_df, max_df=max_df, strip_accents="unicode")
    X = vec.fit_transform(texts); vocab = np.array(vec.get_feature_names_out())

    tfidf_terms_by_cluster: Dict[int, List[str]] = {}
    for cid in sorted(df["cid"].unique()):
        idx = np.where(cids == cid)[0]
        if idx.size == 0: tfidf_terms_by_cluster[int(cid)] = []; continue
        mean_vec = np.asarray(X[idx].mean(axis=0)).ravel()
        if not np.any(mean_vec): tfidf_terms_by_cluster[int(cid)] = []; continue
        top_idx_all = mean_vec.argsort()[::-1]
        chosen: List[str] = []
        for j in top_idx_all:
            t = vocab[j]
            if _is_generic_phrase(t): continue
            if any(t in u or u in t for u in chosen): continue
            chosen.append(t)
            if len(chosen) >= topk_terms: break
        tfidf_terms_by_cluster[int(cid)] = chosen

    cand = set(); [cand.update(terms) for terms in tfidf_terms_by_cluster.values()]
    if extra_phrases: cand.update(extra_phrases)
    if not cand: cand.update({"reinforcement learning","governance","robustness","evaluation"})
    phrases = sorted(p for p in cand if not _is_generic_phrase(p))

    V = load_vectors(conn, ids)
    embs = np.vstack([V[i] for i in ids])
    cents: Dict[int, np.ndarray] = {}
    for cid in sorted(df["cid"].unique()):
        idx = np.where(cids == cid)[0]
        if idx.size:
            c = embs[idx].mean(axis=0); c /= (np.linalg.norm(c) + 1e-12)
            cents[int(cid)] = c

    eg = EmbeddingGenerator(batch_size=64)
    phrase_embs = eg.encode(phrases, [""] * len(phrases))
    phrase_embs = phrase_embs / (np.linalg.norm(phrase_embs, axis=1, keepdims=True) + 1e-12)

    semantic_labels: Dict[int, Dict[str, object]] = {}
    for cid, c in cents.items():
        sims = phrase_embs @ c
        if sims.size == 0:
            semantic_labels[cid] = {"terms": [], "confidence": 0.0}; continue
        top = sims.argsort()[::-1][:max(3, topk_terms)]
        terms = [phrases[i] for i in top]
        conf = float(sims[top[0]])
        semantic_labels[cid] = {"terms": terms, "confidence": conf}

    rep_title: Dict[int, Dict[str, object]] = {}
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

    results: Dict[int, Dict[str, object]] = {}
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
        results[int(cid)] = {"label": label, "terms": terms, "confidence": conf}

    cur = conn.cursor(); cur.execute("BEGIN")
    for cid, meta in results.items():
        cur.execute(
            """
            INSERT INTO cluster_meta(method, cluster_id, label, confidence, terms)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(method, cluster_id) DO UPDATE SET label=excluded.label, confidence=excluded.confidence, terms=excluded.terms
            """,
            (method_name, int(cid), meta["label"], float(meta["confidence"]), json.dumps(meta["terms"]))
        )
    cur.execute("COMMIT")
    return results


def cmd_label(args):
    conn = sqlite3.connect(args.db); conn.row_factory = sqlite3.Row
    try:
        out = label_clusters_default(conn, method_name="default", topk_terms=args.topk, ngram_range=(1,3), min_df=args.min_df, max_df=args.max_df, extra_phrases=args.extra and [s.strip() for s in args.extra.split(",") if s.strip()] or None)
        print(f"{GREEN}label:{GREEN} stored labels for {len(out)} clusters (method=default).")
        for cid in sorted(out):
            print(f"  • cluster {cid}: {out[cid]['label']}  (conf={out[cid]['confidence']:.3f})")
    finally:
        conn.close()