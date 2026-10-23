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


def test_list_papers_total_on_last_and_past_last_page(client, make_paper):
    for i in range(3):
        make_paper(f"2401.0002{i}", published=f"2024-01-0{i + 1}")

    last = client.get("/api/papers", params={"page": 2, "limit": 2}).json()
    assert last["total"] == 3
    assert len(last["items"]) == 1

    past = client.get("/api/papers", params={"page": 5, "limit": 2}).json()
    assert past["total"] == 3
    assert past["items"] == []


def test_list_papers_total_zero_when_nothing_matches(client, make_paper):
    make_paper("2401.00030", title="Alignment")

    body = client.get("/api/papers", params={"q": "no-such-title"}).json()
    assert body["total"] == 0
    assert body["items"] == []


def test_list_papers_pages_are_stable_across_same_date_papers(client, make_paper):
    # Inserted in reverse id order so heap order disagrees with the id
    # tie-breaker; without it, pages over same-date papers can overlap.
    for i in reversed(range(6)):
        make_paper(f"2401.0010{i}", published="2024-01-01")

    aids = []
    for page in (1, 2, 3):
        res = client.get("/api/papers", params={"page": page, "limit": 2})
        aids += [item["aid"] for item in res.json()["items"]]

    assert aids == [f"https://arxiv.org/abs/2401.0010{i}" for i in range(6)]


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


def test_list_papers_filters_by_tags(client, make_paper):
    make_paper("2401.00035", tags=[("reward hacking", 0.9), ("rlhf", 0.4)])
    make_paper("2401.00036", tags=[("scalable oversight", 0.8)])
    make_paper("2401.00037")

    res = client.get("/api/papers", params={"tags": "reward hacking"})
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["tags"] == ["reward hacking", "rlhf"]


def test_list_papers_tags_empty_list_when_untagged(client, make_paper):
    make_paper("2401.00038")

    res = client.get("/api/papers")
    items = res.json()["items"]
    assert items[0]["tags"] == []


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


def test_get_paper_includes_tags(client, make_paper):
    make_paper("2401.00052", title="Tagged Paper", tags=[("reward hacking", 0.9), ("rlhf", 0.3)])

    res = client.get("/api/papers/2401.00052")
    assert res.status_code == 200
    assert res.json()["tags"] == ["reward hacking", "rlhf"]


def test_get_paper_includes_llm_reason(client, conn, make_paper):
    aid = make_paper("2401.00053", title="Reasoned Paper")
    conn.execute("UPDATE papers SET llm_reason = %s WHERE id = %s", ("Studies reward hacking.", aid))

    res = client.get("/api/papers/2401.00053")
    assert res.status_code == 200
    assert res.json()["lr"] == "Studies reward hacking."


def test_get_paper_without_llm_reason(client, make_paper):
    make_paper("2401.00054", title="Unreasoned Paper")

    res = client.get("/api/papers/2401.00054")
    assert res.json()["lr"] == ""


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
    close_id = make_paper("2401.00071", embedding=close, tags=[("reward hacking", 0.9)])
    far_id = make_paper("2401.00072", embedding=far)

    res = client.get("/api/papers/related", params={"id": target, "limit": 10})
    assert res.status_code == 200
    body = res.json()
    ids_in_order = [item["aid"] for item in body]
    assert ids_in_order.index(close_id) < ids_in_order.index(far_id)

    by_aid = {item["aid"]: item for item in body}
    assert by_aid[close_id]["tags"] == ["reward hacking"]
    assert by_aid[far_id]["tags"] == []


def test_get_paper_404_when_not_llm_relevant(client, conn, make_paper):
    make_paper("2401.00130", llm_relevant=False)
    unclassified = make_paper("2401.00131")
    conn.execute("UPDATE papers SET llm_relevant = NULL WHERE id = %s", [unclassified])

    assert client.get("/api/papers/2401.00130").status_code == 404
    assert client.get("/api/papers/2401.00131").status_code == 404


def test_related_papers_404_when_source_not_llm_relevant(client, make_paper):
    emb = np.zeros(768, dtype=np.float32)
    emb[0] = 1.0
    source = make_paper("2401.00140", embedding=emb, llm_relevant=False)
    make_paper("2401.00141", embedding=emb)

    res = client.get("/api/papers/related", params={"id": source})
    assert res.status_code == 404


def test_related_papers_excludes_non_llm_relevant_neighbours(client, make_paper):
    base = np.zeros(768, dtype=np.float32)
    base[0] = 1.0
    far = np.zeros(768, dtype=np.float32)
    far[1] = 1.0

    source = make_paper("2401.00150", embedding=base)
    rejected = make_paper("2401.00151", embedding=base, llm_relevant=False)
    relevant = make_paper("2401.00152", embedding=far)

    res = client.get("/api/papers/related", params={"id": source, "limit": 10})
    assert res.status_code == 200
    aids = [item["aid"] for item in res.json()]
    assert relevant in aids
    assert rejected not in aids


def _set_related(conn, source, neighbor_ids, sims):
    conn.execute(
        "INSERT INTO paper_related (paper_id, neighbor_ids, sims) VALUES (%s, %s, %s)",
        (source, neighbor_ids, sims),
    )


def test_related_papers_serves_precomputed_neighbours_in_stored_order(client, conn, make_paper):
    emb = np.zeros(768, dtype=np.float32)
    emb[0] = 1.0
    source = make_paper("2401.00160", embedding=emb)
    a = make_paper("2401.00161", embedding=emb, tags=[("reward hacking", 0.9)])
    b = make_paper("2401.00162", embedding=emb)
    # Order and sims deliberately differ from what HNSW would return
    # (both are identical to the source), so this only passes via the table.
    _set_related(conn, source, [b, a], [0.5, 0.25])

    res = client.get("/api/papers/related", params={"id": source, "limit": 10})
    assert res.status_code == 200
    body = res.json()
    assert [item["aid"] for item in body] == [b, a]
    assert [item["sim"] for item in body] == [0.5, 0.25]
    assert body[1]["tags"] == ["reward hacking"]


def test_related_papers_precomputed_skips_neighbours_no_longer_relevant(client, conn, make_paper):
    emb = np.zeros(768, dtype=np.float32)
    emb[0] = 1.0
    source = make_paper("2401.00170", embedding=emb)
    stale = make_paper("2401.00171", embedding=emb, llm_relevant=False)
    kept = make_paper("2401.00172", embedding=emb)
    _set_related(conn, source, [stale, kept], [0.9, 0.8])

    res = client.get("/api/papers/related", params={"id": source, "limit": 1})
    assert res.status_code == 200
    assert [item["aid"] for item in res.json()] == [kept]


def test_related_papers_limit_capped_at_stored_neighbour_count(client):
    res = client.get("/api/papers/related", params={"id": "2401.00190", "limit": 21})
    assert res.status_code == 422


def test_related_papers_404_when_source_no_longer_relevant_despite_stale_row(client, conn, make_paper):
    emb = np.zeros(768, dtype=np.float32)
    emb[0] = 1.0
    source = make_paper("2401.00180", embedding=emb, llm_relevant=False)
    other = make_paper("2401.00181", embedding=emb)
    _set_related(conn, source, [other], [0.9])

    res = client.get("/api/papers/related", params={"id": source})
    assert res.status_code == 404


def test_list_papers_gates_on_llm_relevant_not_stage2(client, make_paper):
    yes = make_paper("2401.00120", ai_stage2_keep=False, llm_relevant=True)
    no = make_paper("2401.00121", ai_stage2_keep=True, llm_relevant=False)

    aids = {i["aid"] for i in client.get("/api/papers?limit=200").json()["items"]}
    assert yes in aids
    assert no not in aids


def _search_log_rows(test_dsn, query):
    # log_search commits on its own pooled connection, so read (and clean up)
    # through a separate connection rather than the rolled-back test one.
    from aisafety_pipeline.db import connect

    c = connect(test_dsn)
    try:
        rows = c.execute(
            "SELECT mode, total, has_filters FROM search_log WHERE query = %s", [query]
        ).fetchall()
        c.execute("DELETE FROM search_log WHERE query = %s", [query])
        c.commit()
        return [tuple(r) for r in rows]
    finally:
        c.close()


def test_list_papers_logs_keyword_search_once(client, make_paper, test_dsn, monkeypatch):
    from aisafety_pipeline import config

    monkeypatch.setattr(config, "SEARCH_LOG_ENABLED", True)
    make_paper("2401.00200", title="Zzlogtest interpretability")
    res = client.get("/api/papers", params={"q": "ZzLogTest", "limit": 1})
    assert res.status_code == 200
    client.get("/api/papers", params={"q": "zzlogtest", "page": 2, "limit": 1})
    assert _search_log_rows(test_dsn, "zzlogtest") == [("keyword", 1, False)]


def test_list_papers_without_query_logs_nothing(client, test_dsn, monkeypatch):
    from aisafety_pipeline import config
    from aisafety_pipeline.db import connect

    monkeypatch.setattr(config, "SEARCH_LOG_ENABLED", True)

    c = connect(test_dsn)
    try:
        before = c.execute("SELECT count(*) FROM search_log").fetchone()[0]
        client.get("/api/papers", params={"tags": ["rlhf"]})
        after = c.execute("SELECT count(*) FROM search_log").fetchone()[0]
    finally:
        c.close()
    assert after == before


def test_search_log_failure_does_not_break_request(client, monkeypatch):
    from aisafety_pipeline import config
    from aisafety_pipeline.api import deps

    monkeypatch.setattr(config, "SEARCH_LOG_ENABLED", True)

    def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(deps, "borrow_conn", _boom)
    res = client.get("/api/papers", params={"q": "anything"})
    assert res.status_code == 200
