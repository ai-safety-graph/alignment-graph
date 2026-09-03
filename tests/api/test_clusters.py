from __future__ import annotations

import json


def _insert_cluster_meta(conn, cluster_id: int, label: str, size: int, terms: list[str]):
    conn.execute(
        """
        INSERT INTO cluster_meta (method, cluster_id, label, confidence, terms, size)
        VALUES ('default', %s, %s, 0.9, %s, %s)
        ON CONFLICT (method, cluster_id) DO UPDATE SET
            label=EXCLUDED.label, confidence=EXCLUDED.confidence,
            terms=EXCLUDED.terms, size=EXCLUDED.size
        """,
        (cluster_id, label, json.dumps(terms), size),
    )


def test_list_clusters_ordered_with_parsed_terms(client, conn):
    _insert_cluster_meta(conn, 2, "Interpretability", 5, ["saes", "probing"])
    _insert_cluster_meta(conn, 1, "Alignment", 3, ["rlhf", "reward"])

    res = client.get("/api/clusters")
    assert res.status_code == 200
    body = res.json()

    cids = [c["cid"] for c in body]
    assert cids == sorted(cids)

    by_cid = {c["cid"]: c for c in body}
    assert by_cid[1]["label"] == "Alignment"
    assert by_cid[1]["size"] == 3
    assert by_cid[1]["terms"] == ["rlhf", "reward"]
    assert by_cid[2]["confidence"] == 0.9
