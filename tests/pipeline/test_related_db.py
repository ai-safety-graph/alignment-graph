"""DB-backed tests for the compute-related stage. compute_related opens its
own connection and commits, so fixture rows are committed up front and
deleted explicitly afterwards (cascading to paper_related)."""
from __future__ import annotations

import numpy as np
import pytest

from aisafety_pipeline import filters
from aisafety_pipeline.related import RELATED_STATE_KEY, compute_related


def _unit(*weights: float) -> np.ndarray:
    v = np.zeros(768, dtype=np.float32)
    v[: len(weights)] = weights
    return v / np.linalg.norm(v)


def _clear_related_state(conn):
    conn.execute("DELETE FROM pipeline_state WHERE key = %s", (RELATED_STATE_KEY,))
    conn.commit()


@pytest.fixture
def committed_papers(conn, make_paper):
    # compute_related commits its fingerprint; start and end each test without one.
    _clear_related_state(conn)
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
    _clear_related_state(conn)


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
    # force past the unchanged-input skip, to exercise the upsert's own skip.
    assert compute_related(test_dsn, force=True) == 0


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


def test_compute_related_removes_rows_for_papers_that_lost_their_embedding(conn, test_dsn, committed_papers):
    a = committed_papers("2401.40031", embedding=_unit(1))
    b = committed_papers("2401.40032", embedding=_unit(0, 1))
    committed_papers("2401.40033", embedding=_unit(0, 0, 1))
    compute_related(test_dsn)
    assert _related(conn, a) is not None

    conn.execute("UPDATE papers SET embedding = NULL WHERE id = %s", (a,))
    conn.commit()
    compute_related(test_dsn)

    assert _related(conn, a) is None
    assert _related(conn, b) is not None


def test_compute_related_skips_unchanged_input_without_loading_vectors(
    conn, test_dsn, committed_papers, monkeypatch
):
    committed_papers("2401.40041", embedding=_unit(1))
    committed_papers("2401.40042", embedding=_unit(0, 1))
    assert compute_related(test_dsn) > 0

    def _fail(*args, **kwargs):
        raise AssertionError("load_vectors called for an unchanged input set")

    monkeypatch.setattr(filters, "load_vectors", _fail)
    assert compute_related(test_dsn) == 0


def test_compute_related_recomputes_when_a_paper_joins_the_set(conn, test_dsn, committed_papers):
    a = committed_papers("2401.40051", embedding=_unit(1))
    committed_papers("2401.40052", embedding=_unit(0, 1))
    compute_related(test_dsn)

    c = committed_papers("2401.40053", embedding=_unit(1, 0.1))
    compute_related(test_dsn)

    assert _related(conn, c) is not None
    assert _related(conn, a)[0][0] == c


def test_compute_related_recomputes_when_rows_go_missing(conn, test_dsn, committed_papers):
    a = committed_papers("2401.40061", embedding=_unit(1))
    committed_papers("2401.40062", embedding=_unit(0, 1))
    compute_related(test_dsn)
    conn.execute("DELETE FROM paper_related WHERE paper_id = %s", (a,))
    conn.commit()

    assert compute_related(test_dsn) == 1
    assert _related(conn, a) is not None


def test_compute_related_force_recomputes_unchanged_input(
    conn, test_dsn, committed_papers, monkeypatch
):
    committed_papers("2401.40071", embedding=_unit(1))
    committed_papers("2401.40072", embedding=_unit(0, 1))
    compute_related(test_dsn)

    loaded = []
    real_load = filters.load_vectors
    monkeypatch.setattr(
        filters, "load_vectors", lambda *a, **kw: loaded.append(1) or real_load(*a, **kw)
    )
    compute_related(test_dsn, force=True)
    assert loaded


def test_compute_related_fingerprint_covers_algorithm_settings(monkeypatch):
    from aisafety_pipeline import related

    ids = ["https://arxiv.org/abs/2401.00001", "https://arxiv.org/abs/2401.00002"]
    base = related.related_fingerprint(ids, 20)
    assert related.related_fingerprint(ids, 10) != base
    monkeypatch.setattr(related, "_SIM_DECIMALS", 3)
    assert related.related_fingerprint(ids, 20) != base
    monkeypatch.setattr(related, "_SIM_DECIMALS", 4)
    monkeypatch.setattr(related, "_RELATED_ALGO_VERSION", 2)
    assert related.related_fingerprint(ids, 20) != base
