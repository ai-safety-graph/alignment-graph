from __future__ import annotations

from aisafety_pipeline.api.routes.graph import _MAX_SUBSET


def test_subset_rejects_empty_ids(client):
    res = client.post("/api/graph/subset", json={"ids": []})
    assert res.status_code == 422


def test_subset_rejects_too_many_ids(client):
    res = client.post("/api/graph/subset", json={"ids": [f"id-{i}" for i in range(_MAX_SUBSET + 1)]})
    assert res.status_code == 422


def test_subset_returns_normalized_coords(client, make_paper):
    a = make_paper("2401.00080")
    b = make_paper("2401.00081")

    res = client.post("/api/graph/subset", json={"ids": [a, b]})
    assert res.status_code == 200
    body = res.json()

    assert len(body["nodes"]) == 2
    for node in body["nodes"]:
        assert 0 <= node["x"] <= 1000
        assert 0 <= node["y"] <= 700


def test_subset_includes_tags_per_node_and_legend(client, make_paper):
    a = make_paper("2401.00083", tags=[("reward hacking", 0.9), ("rlhf", 0.4)])
    b = make_paper("2401.00084", tags=[("rlhf", 0.8)])

    res = client.post("/api/graph/subset", json={"ids": [a, b]})
    assert res.status_code == 200
    body = res.json()

    by_aid = {node["aid"]: node for node in body["nodes"]}
    assert by_aid[a]["tags"] == ["reward hacking", "rlhf"]
    assert by_aid[b]["tags"] == ["rlhf"]
    assert body["tags"]["rlhf"]["size"] == 2
    assert body["tags"]["reward hacking"]["size"] == 1


def test_subset_unknown_ids_returns_empty_graph(client):
    res = client.post("/api/graph/subset", json={"ids": ["https://arxiv.org/abs/0000.00000"]})
    assert res.status_code == 200
    body = res.json()
    assert body["nodes"] == []
    assert body["links"] == []


def test_range_returns_only_papers_in_range(client, make_paper):
    before = make_paper("2401.00090", published="2023-12-31")
    first = make_paper("2401.00091", published="2024-01-01", tags=[("rlhf", 0.9)])
    last = make_paper("2401.00092", published="2024-01-31")
    after = make_paper("2401.00093", published="2024-02-01")

    res = client.get("/api/graph/range", params={"from": "2024-01-01", "to": "2024-01-31"})
    assert res.status_code == 200
    body = res.json()

    aids = [node["aid"] for node in body["nodes"]]
    assert first in aids and last in aids
    assert before not in aids and after not in aids
    # Newest first, matching /api/papers ordering.
    assert aids.index(last) < aids.index(first)
    for node in body["nodes"]:
        assert 0 <= node["x"] <= 1000
        assert 0 <= node["y"] <= 700
    assert body["tags"]["rlhf"]["size"] >= 1


def test_range_without_to_is_open_ended(client, make_paper):
    later = make_paper("2401.00094", published="2099-01-01")

    res = client.get("/api/graph/range", params={"from": "2098-12-31"})
    assert res.status_code == 200
    assert [node["aid"] for node in res.json()["nodes"]] == [later]


def test_range_excludes_irrelevant_papers(client, make_paper):
    make_paper("2401.00095", published="2099-02-01", llm_relevant=False)

    res = client.get("/api/graph/range", params={"from": "2099-02-01", "to": "2099-02-01"})
    assert res.status_code == 200
    assert res.json()["nodes"] == []


def test_range_requires_valid_from(client):
    assert client.get("/api/graph/range").status_code == 422
    assert client.get("/api/graph/range", params={"from": "not-a-date"}).status_code == 422
