from __future__ import annotations


def test_list_tags_sizes_and_primary_sizes(client, make_paper):
    # p1: reward hacking is primary (higher score); p2: reward hacking only
    # tag; p3: reward hacking present but not primary.
    make_paper("2401.00080", tags=[("reward hacking", 0.9), ("rlhf", 0.5)])
    make_paper("2401.00081", tags=[("reward hacking", 0.8)])
    make_paper("2401.00082", tags=[("rlhf", 0.95), ("reward hacking", 0.4)])

    res = client.get("/api/tags")
    assert res.status_code == 200
    body = res.json()

    assert body["reward hacking"]["size"] == 3
    assert body["reward hacking"]["primary_size"] == 2
    assert body["rlhf"]["size"] == 2
    assert body["rlhf"]["primary_size"] == 1


def test_list_tags_empty_when_no_tags(client, make_paper):
    make_paper("2401.00083")

    res = client.get("/api/tags")
    assert res.status_code == 200
    assert res.json() == {}


def test_list_tags_includes_taxonomy_description(client, make_paper):
    from aisafety_pipeline.taxonomy import TAXONOMY_DESCRIPTIONS

    make_paper("2401.00084", tags=[("AI governance and policy", 0.9)])
    make_paper("2401.00085", tags=[("not a taxonomy tag", 0.9)])

    body = client.get("/api/tags").json()
    assert (
        body["AI governance and policy"]["description"]
        == TAXONOMY_DESCRIPTIONS["AI governance and policy"]
    )
    assert body["not a taxonomy tag"]["description"] is None


def test_list_tags_is_cached_until_cleared(client, make_paper):
    from aisafety_pipeline.api.routes import tags as tags_routes

    make_paper("2401.00086", tags=[("rlhf", 0.9)])
    assert client.get("/api/tags").json()["rlhf"]["size"] == 1

    make_paper("2401.00087", tags=[("rlhf", 0.9)])
    assert client.get("/api/tags").json()["rlhf"]["size"] == 1

    tags_routes.clear_cache()
    assert client.get("/api/tags").json()["rlhf"]["size"] == 2


def test_list_tags_cache_hit_skips_the_pool(monkeypatch):
    from fastapi.testclient import TestClient

    from aisafety_pipeline.api import main as api_main
    from aisafety_pipeline.api.deps import PoolTimeout
    from aisafety_pipeline.api.ratelimit import limiter
    from aisafety_pipeline.api.routes import tags as tags_routes

    monkeypatch.setattr(limiter, "enabled", False)
    monkeypatch.setattr(tags_routes, "_cache", (tags_routes.time.monotonic(), {"rlhf": {"size": 7}}))

    def _busy():
        raise PoolTimeout("no database connection free within 5s")
        yield  # pragma: no cover

    # tags_conn calls get_conn directly on a miss, past dependency_overrides.
    monkeypatch.setattr(tags_routes, "get_conn", _busy)
    hit = TestClient(api_main.app).get("/api/tags")
    tags_routes.clear_cache()
    miss = TestClient(api_main.app).get("/api/tags")

    assert hit.status_code == 200 and hit.json() == {"rlhf": {"size": 7}}
    assert miss.status_code == 503
