"""DB-backed tests for the `venue` stage (venue.derive_venues). It commits
per batch, so fixture rows are committed up front and deleted afterwards."""
from __future__ import annotations

import pytest

from aisafety_pipeline.venue import derive_venues


@pytest.fixture
def committed_papers(conn, make_paper):
    created: list[str] = []

    def _make(arxiv_id: str, comments: str | None = None, journal_ref: str | None = None, **overrides) -> str:
        aid = make_paper(arxiv_id, **overrides)
        conn.execute(
            "UPDATE papers_raw SET comments = %s, journal_ref = %s WHERE id = %s",
            (comments, journal_ref, aid),
        )
        conn.commit()
        created.append(aid)
        return aid

    yield _make
    conn.execute("DELETE FROM papers_raw WHERE id = ANY(%s)", (created,))
    conn.execute("DELETE FROM pipeline_state WHERE key = 'venue_watermark'")
    conn.commit()


def _venue(conn, aid):
    return conn.execute(
        "SELECT peer_reviewed, venue, venue_type, venue_source, venue_derived_at FROM papers WHERE id = %s",
        (aid,),
    ).fetchone()


def test_derives_relevant_papers_and_skips_irrelevant(conn, committed_papers):
    accepted = committed_papers("2401.30001", comments="Accepted at ICLR 2026", llm_relevant=True)
    nothing = committed_papers("2401.30002", comments="15 pages", llm_relevant=True)
    irrelevant = committed_papers("2401.30003", comments="Accepted at ICLR 2026", llm_relevant=False)

    derive_venues(conn)

    row = _venue(conn, accepted)
    assert (row["peer_reviewed"], row["venue"], row["venue_type"], row["venue_source"]) == (
        True, "ICLR 2026", "conference", "comments",
    )
    row = _venue(conn, nothing)
    assert row["peer_reviewed"] is None and row["venue_derived_at"] is not None
    assert _venue(conn, irrelevant)["venue_derived_at"] is None


def test_rederives_only_papers_reharvested_since_last_run(conn, committed_papers):
    updated = committed_papers("2401.30011", comments="Submitted to ICML 2026", llm_relevant=True)
    untouched = committed_papers("2401.30012", comments="Submitted to ICML 2026", llm_relevant=True)
    derive_venues(conn)
    assert _venue(conn, updated)["peer_reviewed"] is None
    before = _venue(conn, untouched)["venue_derived_at"]

    # The author adds a journal-ref; the harvest upsert re-stamps harvested_at.
    conn.execute(
        "UPDATE papers_raw SET journal_ref = 'ICML 2026', harvested_at = now() WHERE id = %s", (updated,)
    )
    conn.commit()
    derive_venues(conn)

    row = _venue(conn, updated)
    assert (row["peer_reviewed"], row["venue"], row["venue_source"]) == (True, "ICML 2026", "journal_ref")
    assert _venue(conn, untouched)["venue_derived_at"] == before


def test_full_rederives_everything(conn, committed_papers):
    aid = committed_papers("2401.30021", comments="ICLR 2026", llm_relevant=True)
    derive_venues(conn)
    conn.execute("UPDATE papers SET peer_reviewed = NULL, venue = NULL WHERE id = %s", (aid,))
    conn.commit()

    derive_venues(conn)  # incremental: nothing new to do
    assert _venue(conn, aid)["peer_reviewed"] is None

    derive_venues(conn, full=True)
    assert _venue(conn, aid)["venue"] == "ICLR 2026"


def test_does_not_erase_a_semantic_scholar_result(conn, committed_papers):
    aid = committed_papers("2401.30031", comments="15 pages", llm_relevant=True)
    conn.execute(
        "UPDATE papers SET peer_reviewed = TRUE, venue = 'AIES 2025', venue_type = 'conference', "
        "venue_source = 's2' WHERE id = %s",
        (aid,),
    )
    conn.commit()

    counts = derive_venues(conn)

    row = _venue(conn, aid)
    assert (row["peer_reviewed"], row["venue"], row["venue_source"]) == (True, "AIES 2025", "s2")
    assert row["venue_derived_at"] is not None
    assert counts["kept_s2"] >= 1
