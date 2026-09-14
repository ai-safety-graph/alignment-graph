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
