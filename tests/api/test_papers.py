from __future__ import annotations

import numpy as np


def test_list_papers_pagination(client, make_paper):
    for i in range(3):
        make_paper(f"2401.0000{i}", title=f"Paper {i}", published=f"2024-01-0{i + 1}")

    res = client.get("/api/papers", params={"page": 1, "limit": 2})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["limit"] == 2
    assert len(body["items"]) == 2


def test_list_papers_excludes_unkept(client, make_paper):
    make_paper("2401.00010", ai_stage2_keep=True)
    make_paper("2401.00011", ai_stage2_keep=False)

    res = client.get("/api/papers")
    aids = {item["aid"] for item in res.json()["items"]}
    assert "https://arxiv.org/abs/2401.00010" in aids
    assert "https://arxiv.org/abs/2401.00011" not in aids


def test_list_papers_filters_by_domain(client, make_paper):
    make_paper("2401.00020", domain_tag="gov")
    make_paper("2401.00021", domain_tag="tech")

    res = client.get("/api/papers", params={"domain": "gov"})
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["dm"] == "gov"


def test_list_papers_filters_by_cluster(client, make_paper):
    make_paper("2401.00030", kmeans_cluster=1)
    make_paper("2401.00031", kmeans_cluster=2)

    res = client.get("/api/papers", params={"cluster": 2})
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["cid"] == 2


def test_list_papers_search_query(client, make_paper):
    make_paper("2401.00040", title="Reward Hacking Survey")
    make_paper("2401.00041", title="Unrelated Topic")

    res = client.get("/api/papers", params={"q": "reward hacking"})
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["t"] == "Reward Hacking Survey"


def test_get_paper_by_bare_id(client, make_paper):
    make_paper("2401.00050", title="Bare Id Lookup")

    res = client.get("/api/papers/2401.00050")
    assert res.status_code == 200
    body = res.json()
    assert body["aid"] == "https://arxiv.org/abs/2401.00050"
    assert body["t"] == "Bare Id Lookup"


def test_get_paper_by_full_url(client, make_paper):
    aid = make_paper("2401.00051", title="Full Url Lookup")

    res = client.get(f"/api/papers/{aid.split('/abs/')[1]}")
    assert res.status_code == 200
    assert res.json()["aid"] == aid


def test_get_paper_not_found(client):
    res = client.get("/api/papers/9999.99999")
    assert res.status_code == 404


def test_related_papers_404_for_unseen_id(client):
    res = client.get("/api/papers/related", params={"id": "2401.00061"})
    assert res.status_code == 404


def test_related_papers_orders_by_similarity(client, make_paper):
    base = np.zeros(768, dtype=np.float32)
    base[0] = 1.0
    close = np.zeros(768, dtype=np.float32)
    close[0] = 0.9
    close[1] = 0.1
    far = np.zeros(768, dtype=np.float32)
    far[1] = 1.0

    target = make_paper("2401.00070", embedding=base)
    close_id = make_paper("2401.00071", embedding=close)
    far_id = make_paper("2401.00072", embedding=far)

    res = client.get("/api/papers/related", params={"id": target, "limit": 10})
    assert res.status_code == 200
    body = res.json()
    ids_in_order = [item["aid"] for item in body]
    assert ids_in_order.index(close_id) < ids_in_order.index(far_id)
