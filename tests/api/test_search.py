from __future__ import annotations

import numpy as np


def test_search_disabled_by_default(client):
    res = client.post("/api/search", json={"query": "reward hacking"})
    assert res.status_code == 503


def test_search_rejects_empty_query(client):
    res = client.post("/api/search", json={"query": ""})
    assert res.status_code == 422


def test_search_filters_by_tag(client, make_paper, monkeypatch):
    from aisafety_pipeline.api.routes import search as search_routes

    monkeypatch.setattr(search_routes, "ENABLE_SEMANTIC_SEARCH", True)

    vec = np.zeros(768, dtype=np.float32)
    vec[0] = 1.0

    class _FakeGenerator:
        def encode_queries(self, queries):
            return np.array([vec])

    monkeypatch.setattr(search_routes, "_get_generator", lambda: _FakeGenerator())

    tagged = make_paper("2401.00090", embedding_topic=vec, tags=[("reward hacking", 0.9)])
    make_paper("2401.00091", embedding_topic=vec, tags=[("rlhf", 0.8)])

    res = client.post("/api/search", json={"query": "reward hacking", "tag": "reward hacking"})
    assert res.status_code == 200
    body = res.json()
    aids = [r["aid"] for r in body["results"]]
    assert aids == [tagged]
    assert body["results"][0]["tags"] == ["reward hacking"]


def test_semantic_search_is_logged(client, make_paper, monkeypatch, test_dsn):
    from aisafety_pipeline.api.routes import search as search_routes
    from aisafety_pipeline.db import connect

    from aisafety_pipeline import config

    monkeypatch.setattr(config, "SEARCH_LOG_ENABLED", True)
    monkeypatch.setattr(search_routes, "ENABLE_SEMANTIC_SEARCH", True)
    vec = np.zeros(768, dtype=np.float32)
    vec[0] = 1.0

    class _FakeGenerator:
        def encode_queries(self, queries):
            return np.array([vec])

    monkeypatch.setattr(search_routes, "_get_generator", lambda: _FakeGenerator())
    make_paper("2401.00210", embedding_topic=vec)

    res = client.post("/api/search", json={"query": "Zzsemlog", "tag": "rlhf"})
    assert res.status_code == 200

    c = connect(test_dsn)
    try:
        rows = c.execute(
            "SELECT mode, has_filters FROM search_log WHERE query = 'zzsemlog'"
        ).fetchall()
        c.execute("DELETE FROM search_log WHERE query = 'zzsemlog'")
        c.commit()
    finally:
        c.close()
    assert [tuple(r) for r in rows] == [("semantic", True)]
