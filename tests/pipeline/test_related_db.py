"""DB-backed tests for the compute-related stage. compute_related opens its
own connection and commits, so fixture rows are committed up front and
deleted explicitly afterwards (cascading to paper_related)."""
from __future__ import annotations

import numpy as np
import pytest

from aisafety_pipeline.related import compute_related


def _unit(*weights: float) -> np.ndarray:
    v = np.zeros(768, dtype=np.float32)
    v[: len(weights)] = weights
    return v / np.linalg.norm(v)


@pytest.fixture
def committed_papers(conn, make_paper):
    created: list[str] = []

    def _make(arxiv_id: str, **overrides) -> str:
        overrides.setdefault("llm_relevant", True)
        aid = make_paper(arxiv_id, **overrides)
        conn.commit()
        created.append(aid)
        return aid

    yield _make
    conn.execute("DELETE FROM papers_raw WHERE id = ANY(%s)", (created,))
    conn.commit()


def _related(conn, aid):
    return conn.execute(
        "SELECT neighbor_ids, sims FROM paper_related WHERE paper_id = %s", (aid,)
    ).fetchone()


def test_compute_related_orders_by_similarity_and_excludes_self_and_irrelevant(
    conn, test_dsn, committed_papers
):
    source = committed_papers("2401.40001", embedding=_unit(1))
    close = committed_papers("2401.40002", embedding=_unit(0.9, 0.1))
    far = committed_papers("2401.40003", embedding=_unit(0, 1))
    rejected = committed_papers("2401.40004", embedding=_unit(1), llm_relevant=False)

    compute_related(test_dsn)

    neighbor_ids, sims = _related(conn, source)
    assert source not in neighbor_ids
    assert rejected not in neighbor_ids
    assert neighbor_ids.index(close) < neighbor_ids.index(far)
    assert sims == sorted(sims, reverse=True)
    assert sims[neighbor_ids.index(close)] == pytest.approx(float(_unit(1) @ _unit(0.9, 0.1)), abs=1e-4)
    assert _related(conn, rejected) is None


def test_compute_related_rerun_without_changes_rewrites_nothing(conn, test_dsn, committed_papers):
    committed_papers("2401.40011", embedding=_unit(1))
    committed_papers("2401.40012", embedding=_unit(0, 1))

    assert compute_related(test_dsn) > 0
    assert compute_related(test_dsn) == 0


def test_compute_related_removes_rows_for_papers_no_longer_relevant(conn, test_dsn, committed_papers):
    a = committed_papers("2401.40021", embedding=_unit(1))
    committed_papers("2401.40022", embedding=_unit(0, 1))
    committed_papers("2401.40023", embedding=_unit(0, 0, 1))
    compute_related(test_dsn)
    assert _related(conn, a) is not None

    conn.execute("UPDATE papers SET llm_relevant = FALSE WHERE id = %s", (a,))
    conn.commit()
    compute_related(test_dsn)

    assert _related(conn, a) is None
