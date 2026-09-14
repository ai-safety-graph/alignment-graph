from __future__ import annotations

import numpy as np
from psycopg2.extras import execute_values

from .config import GREEN, RESET
from .embeddings import TopicEmbeddingGenerator
from .filters import load_vectors
from .taxonomy import TAXONOMY, embedding_texts

# Multi-label, zero-shot tagging: each paper's embedding is matched directly
# against the fixed taxonomy (taxonomy.TAXONOMY) by cosine similarity, then
# standardized per phrase (see `phrase_stats`/`zscore`) since raw cosine has
# a different typical baseline per phrase; every phrase whose z-score clears
# `zscore_floor` (capped at `top_n`) is kept as a tag. This replaces the old
# per-cluster labeling (labeling.py) -- clustering forced every paper into
# exactly one bucket, which doesn't fit papers that span several topics at
# once, and needed uniqueness/collision handling that multi-label tagging
# doesn't.

_TAG_READ_CHUNK = 5000
_TAG_WRITE_BATCH = 500

_UPSERT_PAPER_TAGS = """
    INSERT INTO paper_tags (paper_id, tag, score) VALUES %s
"""


def select_tags(
    sims_row: np.ndarray,
    phrases: list[str],
    cosine_floor: float,
    top_n: int,
) -> list[tuple[str, float]]:
    """Pick the tags for one paper from its per-phrase score row.

    Keeps every phrase at or above `cosine_floor`, then caps at the
    `top_n` highest-scoring ones, sorted descending -- callers rely on
    this order to treat index 0 as the paper's primary tag. If nothing
    clears the floor, returns an empty list -- the paper stays untagged
    rather than being forced onto its best (but still weak) match.

    Generic over what `sims_row` holds: raw cosine similarity, or the
    corpus-normalized z-scores from `zscore()` -- see `tag_papers_default`,
    which uses the latter so `cosine_floor` is compared on equal footing
    across phrases rather than against a single shared cosine value.
    """
    keep = np.where(sims_row >= cosine_floor)[0]
    if keep.size == 0:
        return []
    order = keep[np.argsort(sims_row[keep])[::-1]][:top_n]
    return [(phrases[j], float(sims_row[j])) for j in order]


def corpus_phrase_similarities(
    conn,
    phrase_embs: np.ndarray,
) -> tuple[list[str], np.ndarray]:
    """Cosine similarity of every kept, embedded paper against each phrase.

    The full corpus (not a sample), paginated by id (keyset), not a
    single-shot SELECT -- same reasoning as labeling.py's read loop:
    title/summary are large TOASTed text columns that can exceed a hosted
    DB's statement_timeout if fetched in one go. Feeds `phrase_stats()` for
    z-score normalization -- the population being tagged is exactly the
    population the per-phrase mean/std should describe.
    """
    rows_all = []
    last_id = ""
    while True:
        page = conn.execute(
            """
            SELECT id FROM papers
            WHERE ai_stage2_keep AND embedding_topic IS NOT NULL AND id > %s
            ORDER BY id
            LIMIT %s
            """,
            (last_id, _TAG_READ_CHUNK),
        ).fetchall()
        if not page:
            break
        rows_all.extend(page)
        last_id = page[-1]["id"]
        if len(page) < _TAG_READ_CHUNK:
            break
    if not rows_all:
        return [], np.zeros((0, phrase_embs.shape[0]))
    ids = [r["id"] for r in rows_all]

    V = load_vectors(conn, ids, model="topic")
    ids = [pid for pid in ids if pid in V]
    if not ids:
        return [], np.zeros((0, phrase_embs.shape[0]))
    embs = np.vstack([V[pid] for pid in ids])
    return ids, embs @ phrase_embs.T


def phrase_stats(sims: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-phrase mean/std of cosine similarity across a corpus of papers.

    Some taxonomy phrases sit in a denser region of embedding space than
    others -- e.g. "robustness and generalization" scores high against
    most AI-safety papers regardless of actual topic, while "privacy and
    data protection" runs lower even for papers squarely about it. A
    single global cosine floor then systematically favors the
    high-baseline phrases. `zscore()` standardizes each phrase's column
    using these stats so every phrase is judged against its own typical
    range instead.
    """
    return sims.mean(axis=0), sims.std(axis=0)


def zscore(sims: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return (sims - mean) / (std + 1e-9)


def encode_phrases(phrases: list[str]) -> np.ndarray:
    # Taxonomy phrases are short, underspecified search terms compared to
    # the paper text they're matched against (which is embedded as passages
    # in embed-topic) -- BGE's asymmetric convention calls for the query
    # prefix on this side to get meaningful passage-vs-query similarity.
    eg = TopicEmbeddingGenerator(batch_size=64)
    phrase_embs = eg.encode_queries(embedding_texts(phrases))
    return phrase_embs / (np.linalg.norm(phrase_embs, axis=1, keepdims=True) + 1e-12)


def tag_papers_default(
    conn,
    zscore_floor: float = 0.8,
    top_n: int = 2,
    extra_phrases: list[str] | None = None,
) -> dict[str, list[tuple[str, float]]]:
    phrases = sorted(set(TAXONOMY) | set(extra_phrases or []))
    phrase_embs = encode_phrases(phrases)

    ids, sims = corpus_phrase_similarities(conn, phrase_embs)  # (n_papers, n_phrases), raw cosine
    if not ids:
        return {}
    mean, std = phrase_stats(sims)
    z = zscore(sims, mean, std)
    phrase_idx = {p: j for j, p in enumerate(phrases)}

    results: dict[str, list[tuple[str, float]]] = {}
    write_rows: list[tuple[str, str, float]] = []
    for i, pid in enumerate(ids):
        picked = select_tags(z[i], phrases, zscore_floor, top_n)
        if not picked:
            continue
        # Selection and ranking happen on z-scores, but the score stored
        # and shown downstream is the original cosine similarity -- more
        # interpretable than a z-score, and what the UI/API already expect.
        tags = [(phrase, float(sims[i, phrase_idx[phrase]])) for phrase, _ in picked]
        results[pid] = tags
        write_rows.extend((pid, tag, score) for tag, score in tags)

    write_cur = conn.raw_cursor()
    try:
        # Clear stale tags for every paper considered in this run (not just
        # the ones that still have tags above the floor) -- a paper's tag
        # set can shrink between runs as the taxonomy or threshold changes.
        for i in range(0, len(ids), _TAG_WRITE_BATCH):
            chunk = ids[i:i + _TAG_WRITE_BATCH]
            write_cur.execute("DELETE FROM paper_tags WHERE paper_id = ANY(%s)", (chunk,))
        for i in range(0, len(write_rows), _TAG_WRITE_BATCH):
            batch = write_rows[i:i + _TAG_WRITE_BATCH]
            execute_values(write_cur, _UPSERT_PAPER_TAGS, batch, template="(%s, %s, %s::real)")
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return results


def cmd_tag(args):
    from .db import connect
    conn = connect(args.db)
    try:
        out = tag_papers_default(
            conn,
            zscore_floor=args.floor,
            top_n=args.top_n,
            extra_phrases=args.extra and [s.strip() for s in args.extra.split(",") if s.strip()] or None,
        )
        n_tags = sum(len(v) for v in out.values())
        print(f"{GREEN}tag:{RESET} tagged {len(out)} papers with {n_tags} tag assignments.")
    finally:
        conn.close()
