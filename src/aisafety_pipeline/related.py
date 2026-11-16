from __future__ import annotations

import hashlib

import numpy as np
from psycopg2.extras import execute_values

from .config import GREEN, RESET, YELLOW

# Neighbours stored per paper. Matches the `limit` cap (le=20) on
# GET /api/papers/related -- raise both together. The UI asks for 10; the
# rest is spare for neighbours skipped as no longer relevant.
RELATED_K = 20

_RELATED_WRITE_BATCH = 500
# Rows of the similarity matrix computed at once: 512 x ~34k float32 is
# ~70 MB, independent of corpus growth in the other dimension.
_SIM_CHUNK = 512
# Sims are rounded before storing so float noise between runs (BLAS blocking
# changes as the corpus grows) doesn't rewrite every row.
_SIM_DECIMALS = 4

# Skips rows whose neighbours didn't change, so a daily run with a handful
# of new papers only rewrites the rows those papers displaced.
_UPSERT_RELATED = """
    INSERT INTO paper_related (paper_id, neighbor_ids, sims) VALUES %s
    ON CONFLICT (paper_id) DO UPDATE
        SET neighbor_ids = EXCLUDED.neighbor_ids, sims = EXCLUDED.sims, computed_at = now()
        WHERE (paper_related.neighbor_ids, paper_related.sims)
              IS DISTINCT FROM (EXCLUDED.neighbor_ids, EXCLUDED.sims)
"""

# Rows for papers not in this run's set (no longer relevant, lost their
# embedding, or deleted). Matching on the ids already in hand only reads
# paper_related; joining papers instead looked up every row's paper by
# primary key (~35k scattered heap reads, ~10s on prod).
_DELETE_STALE = """
    DELETE FROM paper_related WHERE paper_id <> ALL(%s::text[])
"""


# pipeline_state key holding a fingerprint of the last completed run's input.
# Embeddings are only ever filled where NULL (embed never overwrites one), so
# the set of relevant embedded ids fully determines the result; when it
# hasn't changed, a recompute would read every SPECTER2 vector (~400 MB on
# prod, the bulk of a quiet day's Disk IO) to write nothing.
RELATED_STATE_KEY = "related_fingerprint"


def related_fingerprint(ids: list[str], k: int) -> str:
    """Hash of the sorted input ids and k. Any paper gaining or losing
    relevance or an embedding changes it."""
    h = hashlib.sha256(f"k={k}\n".encode())
    for pid in ids:
        h.update(pid.encode())
        h.update(b"\n")
    return h.hexdigest()


def top_k_neighbours(X: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Exact cosine top-k for every row of L2-normalised `X`, excluding the
    row itself. Returns (indices, sims), each (n, k), most similar first."""
    n = X.shape[0]
    k = min(k, n - 1)
    idx_out = np.empty((n, k), dtype=np.int64)
    sim_out = np.empty((n, k), dtype=np.float32)
    for start in range(0, n, _SIM_CHUNK):
        stop = min(start + _SIM_CHUNK, n)
        S = X[start:stop] @ X.T
        S[np.arange(stop - start), np.arange(start, stop)] = -np.inf
        part = np.argpartition(-S, k - 1, axis=1)[:, :k]
        part_sims = np.take_along_axis(S, part, axis=1)
        order = np.argsort(-part_sims, axis=1, kind="stable")
        idx_out[start:stop] = np.take_along_axis(part, order, axis=1)
        sim_out[start:stop] = np.take_along_axis(part_sims, order, axis=1)
    return idx_out, sim_out


def compute_related(db_path: str | None = None, k: int = RELATED_K, force: bool = False) -> int:
    """Recompute the SPECTER2 nearest neighbours of every llm_relevant paper
    into `paper_related`. A full recompute (new papers change the neighbours
    of old ones), skipped when the input set matches the last completed run
    unless `force` (e.g. after re-embedding papers in place by hand).
    Returns the number of rows inserted or changed."""
    from .db import connect, get_state, set_state
    from .filters import load_vectors

    conn = connect(db_path)
    try:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM papers WHERE llm_relevant AND embedding IS NOT NULL ORDER BY id"
        ).fetchall()]
        if len(ids) < 2:
            print(f"{YELLOW}compute-related:{RESET} fewer than 2 relevant embedded papers, nothing to do")
            return 0

        fingerprint = related_fingerprint(ids, k)
        if not force and get_state(conn, RELATED_STATE_KEY) == fingerprint:
            print(
                f"{GREEN}compute-related:{RESET} {len(ids)} papers unchanged since the last run, "
                "skipping (--force to recompute)"
            )
            return 0

        vec_by_id = load_vectors(conn, ids, model="specter2")
        X = np.vstack([vec_by_id[pid] for pid in ids]).astype(np.float32)
        nbr_idx, nbr_sims = top_k_neighbours(X, k)

        rows = [
            (pid, [ids[j] for j in nbr_idx[i]], np.round(nbr_sims[i], _SIM_DECIMALS).tolist())
            for i, pid in enumerate(ids)
        ]
        changed = 0
        write_cur = conn.raw_cursor()
        for i in range(0, len(rows), _RELATED_WRITE_BATCH):
            batch = rows[i:i + _RELATED_WRITE_BATCH]
            # One statement per batch, so rowcount covers the whole batch.
            execute_values(
                write_cur, _UPSERT_RELATED, batch,
                template="(%s, %s::text[], %s::real[])", page_size=len(batch),
            )
            changed += write_cur.rowcount
            conn.commit()

        write_cur.execute(_DELETE_STALE, (ids,))
        removed = write_cur.rowcount
        conn.commit()
        # Only after every write committed, so a crashed run recomputes.
        set_state(conn, RELATED_STATE_KEY, fingerprint)

        print(
            f"{GREEN}compute-related:{RESET} {len(ids)} papers (k={nbr_idx.shape[1]}), "
            f"{changed} rows changed, {removed} removed"
        )
        return changed
    finally:
        conn.close()


def cmd_compute_related(args):
    # `force_related`, not `force`: run-all shares one namespace across stages
    # and sets `force` for llm-classify.
    return compute_related(db_path=args.db, force=getattr(args, "force_related", False))
