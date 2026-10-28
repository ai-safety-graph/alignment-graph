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


def test_range_rejects_malformed_dates(client):
    assert client.get("/api/graph/range", params={"from": "not-a-date"}).status_code == 422
    assert client.get("/api/graph/range", params={"to": "not-a-date"}).status_code == 422


def test_range_filters_by_tags_and_domain(client, make_paper):
    rlhf = make_paper("2401.00100", published="2099-03-01", tags=[("rlhf", 0.9)])
    hacking = make_paper("2401.00101", published="2099-03-01", tags=[("reward hacking", 0.9)])
    gov = make_paper("2401.00102", published="2099-03-01", domain_tag="gov", tags=[("rlhf", 0.9)])

    def aids(**params):
        res = client.get("/api/graph/range", params={"from": "2099-03-01", **params})
        assert res.status_code == 200
        return {node["aid"] for node in res.json()["nodes"]}

    assert aids(tags=["rlhf"]) == {rlhf, gov}
    assert aids(tags=["rlhf", "reward hacking"]) == {rlhf, hacking, gov}
    assert aids(domain=["gov"]) == {gov}
    assert aids(tags=["rlhf"], domain=["tech"]) == {rlhf}


def test_range_without_dates_filters_by_tag_only(client, make_paper):
    old = make_paper("2401.00103", published="1999-01-01", tags=[("zz-unique-tag", 0.9)])

    res = client.get("/api/graph/range", params={"tags": ["zz-unique-tag"]})
    assert res.status_code == 200
    assert [node["aid"] for node in res.json()["nodes"]] == [old]


def test_range_caps_nodes_and_reports_total(client, make_paper, monkeypatch):
    from aisafety_pipeline.api.routes import graph

    monkeypatch.setattr(graph, "_MAX_RANGE", 2)
    newest = make_paper("2401.00104", published="2099-04-03")
    middle = make_paper("2401.00105", published="2099-04-02")
    make_paper("2401.00106", published="2099-04-01")

    res = client.get("/api/graph/range", params={"from": "2099-04-01", "to": "2099-04-30"})
    assert res.status_code == 200
    body = res.json()
    assert [node["aid"] for node in body["nodes"]] == [newest, middle]
    assert body["meta"]["total"] == 3


def test_range_coords_are_stable_across_filters(client, make_paper):
    shared = make_paper(
        "2401.00107", published="2099-05-01", graph_x=3.0, graph_y=4.0,
        tags=[("rlhf", 0.9), ("reward hacking", 0.5)],
    )
    make_paper("2401.00108", published="2099-05-01", graph_x=-50.0, graph_y=60.0, tags=[("rlhf", 0.9)])
    make_paper("2401.00109", published="2099-05-01", graph_x=80.0, graph_y=-70.0, tags=[("reward hacking", 0.9)])

    def pos(tag):
        res = client.get("/api/graph/range", params={"from": "2099-05-01", "tags": [tag]})
        node = next(n for n in res.json()["nodes"] if n["aid"] == shared)
        return node["x"], node["y"]

    assert pos("rlhf") == pos("reward hacking")


def test_subset_coords_match_range(client, make_paper):
    shared = make_paper("2401.00110", published="2099-06-01", graph_x=5.0, graph_y=-6.0, tags=[("rlhf", 0.9)])
    other = make_paper("2401.00111", published="2099-06-01", graph_x=90.0, graph_y=40.0, tags=[("rlhf", 0.9)])

    def pos(nodes):
        node = next(n for n in nodes if n["aid"] == shared)
        return node["x"], node["y"]

    ranged = client.get("/api/graph/range", params={"from": "2099-06-01", "tags": ["rlhf"]}).json()
    subset = client.post("/api/graph/subset", json={"ids": [shared, other]}).json()
    assert pos(subset["nodes"]) == pos(ranged["nodes"])
