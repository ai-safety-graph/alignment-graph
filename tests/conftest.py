from __future__ import annotations

import os

import numpy as np
import pytest


def _resolve_test_dsn() -> str | None:
    return os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL") or None


@pytest.fixture(scope="session")
def test_dsn() -> str:
    dsn = _resolve_test_dsn()
    if not dsn:
        pytest.skip(
            "TEST_DATABASE_URL/DATABASE_URL not set — start Postgres with "
            "`docker compose up -d` and set DATABASE_URL to run DB-backed tests."
        )
    try:
        import psycopg2

        psycopg2.connect(dsn).close()
    except Exception as exc:
        pytest.skip(f"Cannot reach test database at {dsn!r}: {exc}")
    return dsn


@pytest.fixture(scope="session", autouse=True)
def _schema(request: pytest.FixtureRequest):
    dsn = _resolve_test_dsn()
    if not dsn:
        return  # pipeline-only test runs shouldn't require a DB
    from aisafety_pipeline.db import init_db

    conn = init_db(dsn)
    conn.close()


@pytest.fixture
def conn(test_dsn: str):
    from aisafety_pipeline.db import connect

    connection = connect(test_dsn)
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


@pytest.fixture
def client(conn, monkeypatch: pytest.MonkeyPatch):
    from fastapi.testclient import TestClient

    from aisafety_pipeline.api import main as api_main
    from aisafety_pipeline.api.deps import get_conn
    from aisafety_pipeline.api.routes import search as search_routes

    # Tests must be deterministic regardless of a developer's local .env —
    # force semantic search off so the lifespan doesn't try to load a
    # transformer model (the `test` extra doesn't install torch). Tests
    # that specifically exercise semantic search can monkeypatch these back.
    monkeypatch.setattr(api_main, "ENABLE_SEMANTIC_SEARCH", False)
    monkeypatch.setattr(search_routes, "ENABLE_SEMANTIC_SEARCH", False)

    def _override_get_conn():
        yield conn

    api_main.app.dependency_overrides[get_conn] = _override_get_conn
    try:
        with TestClient(api_main.app) as test_client:
            yield test_client
    finally:
        api_main.app.dependency_overrides.pop(get_conn, None)


@pytest.fixture
def make_paper(conn):
    """Returns a callable `make_paper(arxiv_id, **overrides)` bound to `conn`
    that inserts a fixture paper row and returns its canonical `aid`."""

    def _make(arxiv_id: str, **overrides):
        return insert_paper(conn, arxiv_id, **overrides)

    return _make


def insert_paper(
    conn,
    arxiv_id: str,
    *,
    title: str = "Example Paper",
    authors: str = "A. Author",
    published: str = "2024-01-01",
    summary: str = "An example abstract.",
    domain_tag: str = "tech",
    kmeans_cluster: int | None = 0,
    ai_stage2_keep: bool = True,
    embedding: np.ndarray | None = None,
    graph_x: float | None = 0.0,
    graph_y: float | None = 0.0,
) -> str:
    """Insert a minimal fixture row into `papers` (and its `papers_raw` parent
    row, required by the FK) and return the canonical `aid` (paper id)."""
    from aisafety_pipeline.arxiv_ids import normalize_arxiv_id_or_url

    aid = normalize_arxiv_id_or_url(arxiv_id)
    link = aid

    conn.execute(
        """
        INSERT INTO papers_raw (id, title, authors, published, summary, link)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (aid, title, authors, published, summary, link),
    )

    vec = embedding if embedding is not None else np.zeros(768, dtype=np.float32)

    conn.execute(
        """
        INSERT INTO papers (
            id, title, authors, published, summary, link,
            domain_tag, kmeans_cluster, ai_stage2_keep, embedding,
            graph_x, graph_y
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            title=EXCLUDED.title, authors=EXCLUDED.authors,
            published=EXCLUDED.published, summary=EXCLUDED.summary,
            link=EXCLUDED.link, domain_tag=EXCLUDED.domain_tag,
            kmeans_cluster=EXCLUDED.kmeans_cluster,
            ai_stage2_keep=EXCLUDED.ai_stage2_keep,
            embedding=EXCLUDED.embedding,
            graph_x=EXCLUDED.graph_x, graph_y=EXCLUDED.graph_y
        """,
        (
            aid, title, authors, published, summary, link,
            domain_tag, kmeans_cluster, ai_stage2_keep, vec,
            graph_x, graph_y,
        ),
    )
    return aid
