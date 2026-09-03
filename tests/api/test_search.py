from __future__ import annotations


def test_search_disabled_by_default(client):
    res = client.post("/api/search", json={"query": "reward hacking"})
    assert res.status_code == 503


def test_search_rejects_empty_query(client):
    res = client.post("/api/search", json={"query": ""})
    assert res.status_code == 422
