from __future__ import annotations

import numpy as np
from psycopg2.extras import execute_values

from .config import GREEN, RESET
from .embeddings import TopicEmbeddingGenerator
from .filters import load_vectors
from .taxonomy import TAXONOMY

# Multi-label, zero-shot tagging: each paper's embedding is matched directly
# against the fixed taxonomy (taxonomy.TAXONOMY) by cosine similarity, and
# every phrase above `cosine_floor` (capped at `top_n`) is kept as a tag.
# This replaces the old per-cluster labeling (labeling.py) -- clustering
# forced every paper into exactly one bucket, which doesn't fit papers that
# span several topics at once, and needed uniqueness/collision handling that
# multi-label tagging doesn't.

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
    """Pick the tags for one paper from its per-phrase similarity row.

    Keeps every phrase at or above `cosine_floor`, then caps at the
    `top_n` highest-scoring ones, sorted descending -- callers rely on
    this order to treat index 0 as the paper's primary tag. If nothing
    clears the floor, falls back to the single best-matching phrase so no
    kept paper is left with zero tags.
    """
    keep = np.where(sims_row >= cosine_floor)[0]
    if keep.size == 0:
        best = int(np.argmax(sims_row))
        return [(phrases[best], float(sims_row[best]))]
    order = keep[np.argsort(sims_row[keep])[::-1]][:top_n]
    return [(phrases[j], float(sims_row[j])) for j in order]


def tag_papers_default(
    conn,
    cosine_floor: float = 0.35,
    top_n: int = 4,
    extra_phrases: list[str] | None = None,
) -> dict[str, list[tuple[str, float]]]:
    # Paginated by id (keyset), not a single-shot SELECT -- same reasoning as
    # labeling.py's read loop: title/summary are large TOASTed text columns
    # that can exceed a hosted DB's statement_timeout if fetched in one go.
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
        return {}
    ids = [r["id"] for r in rows_all]

    phrases = sorted(set(TAXONOMY) | set(extra_phrases or []))

    V = load_vectors(conn, ids, model="topic")
    ids = [pid for pid in ids if pid in V]
    if not ids:
        return {}
    embs = np.vstack([V[pid] for pid in ids])

    eg = TopicEmbeddingGenerator(batch_size=64)
    phrase_embs = eg.encode_passages(phrases)
    phrase_embs = phrase_embs / (np.linalg.norm(phrase_embs, axis=1, keepdims=True) + 1e-12)

    sims = embs @ phrase_embs.T  # (n_papers, n_phrases)

    results: dict[str, list[tuple[str, float]]] = {}
    write_rows: list[tuple[str, str, float]] = []
    for i, pid in enumerate(ids):
        tags = select_tags(sims[i], phrases, cosine_floor, top_n)
        if not tags:
            continue
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
            cosine_floor=args.floor,
            top_n=args.top_n,
            extra_phrases=args.extra and [s.strip() for s in args.extra.split(",") if s.strip()] or None,
        )
        n_tags = sum(len(v) for v in out.values())
        print(f"{GREEN}tag:{RESET} tagged {len(out)} papers with {n_tags} tag assignments.")
    finally:
        conn.close()
