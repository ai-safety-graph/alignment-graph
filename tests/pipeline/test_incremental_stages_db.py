"""DB-backed tests for the incremental (non --full) modes of `filter` and
`compute-layout`. Both commands open their own connection and commit, so
fixture rows are committed up front and deleted explicitly afterwards."""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from aisafety_pipeline.compute_layout import compute_graph_layout
from aisafety_pipeline.filters import cmd_filter
from tests.conftest import insert_paper


def _unit(*weights: float) -> np.ndarray:
    v = np.zeros(768, dtype=np.float32)
    v[: len(weights)] = weights
    return v / np.linalg.norm(v)


@pytest.fixture
def committed_papers(conn):
    created: list[str] = []

    def _make(arxiv_id: str, **overrides) -> str:
        aid = insert_paper(conn, arxiv_id, **overrides)
        conn.commit()
        created.append(aid)
        return aid

    yield _make
    conn.execute("DELETE FROM papers_raw WHERE id = ANY(%s)", (created,))
    conn.commit()


def _row(conn, aid):
    return conn.execute(
        "SELECT ai_sem_sim, ai_stage2_keep, graph_x, graph_y FROM papers WHERE id = %s", (aid,)
    ).fetchone()


def _filter_args(dsn, seeds_path, full=False):
    return SimpleNamespace(db=dsn, method="centroid", seeds=str(seeds_path), tau=0.5, full=full)


def test_filter_only_scores_unscored_papers_by_default(conn, test_dsn, committed_papers, tmp_path):
    seed = committed_papers("2401.20001", embedding=_unit(1))
    scored = committed_papers("2401.20002", embedding=_unit(1))
    new = committed_papers("2401.20003", embedding=_unit(1))
    conn.execute("UPDATE papers SET ai_sem_sim = 0.0, ai_stage2_keep = FALSE WHERE id = %s", (scored,))
    conn.commit()
    seeds = tmp_path / "seeds.txt"
    seeds.write_text("2401.20001\n")

    cmd_filter(_filter_args(test_dsn, seeds))

    assert _row(conn, scored)["ai_sem_sim"] == pytest.approx(0.0)
    assert _row(conn, new)["ai_sem_sim"] == pytest.approx(1.0, abs=1e-4)
    assert _row(conn, new)["ai_stage2_keep"] is True
    assert _row(conn, seed)["ai_sem_sim"] == pytest.approx(1.0, abs=1e-4)


def test_filter_full_rescores_already_scored_papers(conn, test_dsn, committed_papers, tmp_path):
    committed_papers("2401.20001", embedding=_unit(1))
    scored = committed_papers("2401.20002", embedding=_unit(1))
    conn.execute("UPDATE papers SET ai_sem_sim = 0.0, ai_stage2_keep = FALSE WHERE id = %s", (scored,))
    conn.commit()
    seeds = tmp_path / "seeds.txt"
    seeds.write_text("2401.20001\n")

    cmd_filter(_filter_args(test_dsn, seeds, full=True))

    assert _row(conn, scored)["ai_sem_sim"] == pytest.approx(1.0, abs=1e-4)
    assert _row(conn, scored)["ai_stage2_keep"] is True


def test_layout_places_new_paper_at_mean_of_nearest_neighbours(conn, test_dsn, committed_papers):
    near = committed_papers("2401.30001", llm_relevant=True, embedding_topic=_unit(1), graph_x=100.0, graph_y=100.0)
    mid = committed_papers("2401.30002", llm_relevant=True, embedding_topic=_unit(0, 1), graph_x=300.0, graph_y=300.0)
    far = committed_papers("2401.30003", llm_relevant=True, embedding_topic=_unit(0, 0, 1), graph_x=900.0, graph_y=600.0)
    new = committed_papers("2401.30004", llm_relevant=True, embedding_topic=_unit(1, 0.1), graph_x=None, graph_y=None)

    placed = compute_graph_layout(db_path=test_dsn, knn_k=2)

    assert placed == 1
    assert (_row(conn, new)["graph_x"], _row(conn, new)["graph_y"]) == (200.0, 200.0)
    # Existing points never move in incremental mode.
    assert (_row(conn, near)["graph_x"], _row(conn, mid)["graph_x"], _row(conn, far)["graph_x"]) == (100.0, 300.0, 900.0)


def test_layout_is_a_no_op_when_every_paper_is_placed(test_dsn, committed_papers):
    committed_papers("2401.30001", llm_relevant=True, embedding_topic=_unit(1), graph_x=100.0, graph_y=100.0)

    assert compute_graph_layout(db_path=test_dsn) == 0
