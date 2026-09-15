from __future__ import annotations


def test_subset_rejects_empty_ids(client):
    res = client.post("/api/graph/subset", json={"ids": []})
    assert res.status_code == 422


def test_subset_rejects_too_many_ids(client):
    res = client.post("/api/graph/subset", json={"ids": [f"id-{i}" for i in range(501)]})
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
