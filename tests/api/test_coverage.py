from __future__ import annotations

# Kept out of test_meta.py: that module's autouse cleanup fixture commits,
# which would persist these papers past the per-test rollback and leak
# them into other tests' counts.


def test_coverage_counts_relevant_papers_and_date_span(client, make_paper):
    make_paper("2401.00090", published="2023-03-01")
    make_paper("2401.00091", published="2025-06-15")
    make_paper("2401.00092", published="2020-01-01", llm_relevant=False)

    res = client.get("/api/batch/coverage")
    assert res.status_code == 200
    assert res.json() == {
        "total": 2,
        "earliest": "2023-03-01",
        "latest": "2025-06-15",
    }
