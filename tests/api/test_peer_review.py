"""`pr` / `vn` compact fields and the `peer_reviewed` filter across every
node-shaped endpoint."""
from __future__ import annotations

import numpy as np

# Pre-arXiv dates, so real papers in a local DB can't crowd the fixtures out
# of newest-first pages.
_DATE = "1991-03-01"


def _papers(make_paper, **extra):
    reviewed = make_paper("2401.00500", published=_DATE, peer_reviewed=True, venue="ICLR 2026", **extra)
    unknown = make_paper("2401.00501", published=_DATE, **extra)
    return reviewed, unknown


def test_list_papers_serves_fields_and_filters(client, make_paper):
    reviewed, unknown = _papers(make_paper)
    params = {"from": _DATE, "to": _DATE}

    items = {i["aid"]: i for i in client.get("/api/papers", params=params).json()["items"]}
    assert (items[reviewed]["pr"], items[reviewed]["vn"]) == (True, "ICLR 2026")
    assert (items[unknown]["pr"], items[unknown]["vn"]) == (False, None)

    body = client.get("/api/papers", params={**params, "peer_reviewed": "true"}).json()
    assert [i["aid"] for i in body["items"]] == [reviewed]
    assert body["total"] == 1


def test_peer_reviewed_false_does_not_filter(client, make_paper):
    _papers(make_paper)
    body = client.get("/api/papers", params={"from": _DATE, "to": _DATE, "peer_reviewed": "false"}).json()
    assert body["total"] == 2


def test_known_not_reviewed_counts_as_not_reviewed(client, make_paper):
    aid = make_paper("2401.00502", published=_DATE, peer_reviewed=False)
    item = client.get(f"/api/papers/{aid}").json()
    assert item["pr"] is False
    body = client.get("/api/papers", params={"from": _DATE, "to": _DATE, "peer_reviewed": "true"}).json()
    assert body["total"] == 0


def test_single_paper_serves_fields(client, make_paper):
    reviewed, unknown = _papers(make_paper)
    assert {k: client.get(f"/api/papers/{reviewed}").json()[k] for k in ("pr", "vn")} == {
        "pr": True, "vn": "ICLR 2026",
    }
    assert client.get(f"/api/papers/{unknown}").json()["pr"] is False


def test_range_graph_serves_fields_filters_and_counts(client, make_paper):
    reviewed, unknown = _papers(make_paper)
    params = {"from": _DATE, "to": _DATE}

    nodes = {n["aid"]: n for n in client.get("/api/graph/range", params=params).json()["nodes"]}
    assert (nodes[reviewed]["pr"], nodes[reviewed]["vn"]) == (True, "ICLR 2026")
    assert (nodes[unknown]["pr"], nodes[unknown]["vn"]) == (False, None)

    body = client.get("/api/graph/range", params={**params, "peer_reviewed": "true"}).json()
    assert [n["aid"] for n in body["nodes"]] == [reviewed]
    assert body["meta"]["total"] == 1


def test_subset_graph_serves_fields(client, make_paper):
    reviewed, unknown = _papers(make_paper)
    body = client.post("/api/graph/subset", json={"ids": [reviewed, unknown]}).json()
    nodes = {n["aid"]: n for n in body["nodes"]}
    assert nodes[reviewed]["pr"] is True and nodes[reviewed]["vn"] == "ICLR 2026"
    assert nodes[unknown]["pr"] is False


def test_related_serves_fields_on_both_paths(client, conn, make_paper):
    emb = np.zeros(768, dtype=np.float32)
    emb[0] = 1.0
    source = make_paper("2401.00510", embedding=emb)
    reviewed, _ = _papers(make_paper, embedding=emb)

    # Live HNSW path (no precomputed row yet)
    live = {i["aid"]: i for i in client.get("/api/papers/related", params={"id": source}).json()}
    assert (live[reviewed]["pr"], live[reviewed]["vn"]) == (True, "ICLR 2026")

    # Precomputed path
    conn.execute(
        "INSERT INTO paper_related (paper_id, neighbor_ids, sims) VALUES (%s, %s, %s)",
        (source, [reviewed], [0.9]),
    )
    pre = client.get("/api/papers/related", params={"id": source}).json()
    assert [(i["aid"], i["pr"], i["vn"]) for i in pre] == [(reviewed, True, "ICLR 2026")]


def test_semantic_search_serves_fields_and_filters(client, make_paper, monkeypatch):
    from aisafety_pipeline.api.routes import search as search_routes

    monkeypatch.setattr(search_routes, "ENABLE_SEMANTIC_SEARCH", True)
    vec = np.zeros(768, dtype=np.float32)
    vec[0] = 1.0

    class _FakeGenerator:
        def encode_queries(self, queries):
            return np.array([vec])

    monkeypatch.setattr(search_routes, "_get_generator", lambda: _FakeGenerator())
    reviewed, unknown = _papers(make_paper, embedding_topic=vec, tags=[("rlhf", 0.9)])

    res = client.post("/api/search", json={"query": "q", "tag": "rlhf", "limit": 100}).json()
    by_aid = {r["aid"]: r for r in res["results"]}
    assert (by_aid[reviewed]["pr"], by_aid[reviewed]["vn"]) == (True, "ICLR 2026")
    assert by_aid[unknown]["pr"] is False

    res = client.post("/api/search", json={"query": "q", "tag": "rlhf", "peer_reviewed": True, "limit": 100}).json()
    aids = [r["aid"] for r in res["results"]]
    assert reviewed in aids and unknown not in aids
