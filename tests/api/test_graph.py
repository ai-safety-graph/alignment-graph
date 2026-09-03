from __future__ import annotations


def test_subset_rejects_empty_ids(client):
    res = client.post("/api/graph/subset", json={"ids": []})
    assert res.status_code == 422


def test_subset_rejects_too_many_ids(client):
    res = client.post("/api/graph/subset", json={"ids": [f"id-{i}" for i in range(501)]})
    assert res.status_code == 422


def test_subset_returns_normalized_coords_and_cluster_sizes(client, make_paper):
    a = make_paper("2401.00080", kmeans_cluster=1)
    b = make_paper("2401.00081", kmeans_cluster=1)
    make_paper("2401.00082", kmeans_cluster=2)

    res = client.post("/api/graph/subset", json={"ids": [a, b]})
    assert res.status_code == 200
    body = res.json()

    assert len(body["nodes"]) == 2
    assert body["clusters"]["1"]["size"] == 2
    for node in body["nodes"]:
        assert 0 <= node["x"] <= 1000
        assert 0 <= node["y"] <= 700


def test_subset_excludes_papers_without_cluster(client, make_paper):
    aid = make_paper("2401.00090", kmeans_cluster=None)

    res = client.post("/api/graph/subset", json={"ids": [aid]})
    assert res.status_code == 200
    assert res.json()["nodes"] == []


def test_subset_unknown_ids_returns_empty_graph(client):
    res = client.post("/api/graph/subset", json={"ids": ["https://arxiv.org/abs/0000.00000"]})
    assert res.status_code == 200
    body = res.json()
    assert body["nodes"] == []
    assert body["links"] == []
