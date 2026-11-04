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


def test_does_not_erase_an_openalex_result(conn, committed_papers):
    aid = committed_papers("2401.30031", comments="15 pages", llm_relevant=True)
    conn.execute(
        "UPDATE papers SET peer_reviewed = TRUE, venue = 'AIES 2025', venue_type = 'conference', "
        "venue_source = 'openalex' WHERE id = %s",
        (aid,),
    )
    conn.commit()

    counts = derive_venues(conn)

    row = _venue(conn, aid)
    assert (row["peer_reviewed"], row["venue"], row["venue_source"]) == (True, "AIES 2025", "openalex")
    assert row["venue_derived_at"] is not None
    assert counts["kept_openalex"] >= 1


_PUBLISHED_WORK = {
    "publication_year": 2026,
    "primary_location": {
        "source": {"display_name": "Conference on Empirical Methods in Natural Language Processing (EMNLP)",
                   "type": "conference"},
        "version": "publishedVersion",
    },
    "locations": [],
}


def _checked(conn, aid):
    return conn.execute(
        "SELECT peer_reviewed, venue, venue_source, openalex_checked_at FROM papers WHERE id = %s", (aid,)
    ).fetchone()


def test_enrich_marks_published_papers_and_stamps_every_lookup(conn, committed_papers):
    from aisafety_pipeline.venue import enrich_from_openalex

    published = committed_papers("2401.30041", comments="15 pages", llm_relevant=True)
    missing = committed_papers("2401.30042", comments="15 pages", llm_relevant=True)
    derive_venues(conn)
    calls = []

    def fake_fetch(ids):
        calls.append(list(ids))
        return {published: _PUBLISHED_WORK}

    counts = enrich_from_openalex(conn, limit=100_000, fetch=fake_fetch, sleep=lambda s: None)

    row = _checked(conn, published)
    assert (row["peer_reviewed"], row["venue"], row["venue_source"]) == (True, "EMNLP 2026", "openalex")
    row = _checked(conn, missing)
    assert row["peer_reviewed"] is None and row["openalex_checked_at"] is not None
    assert counts["reviewed"] >= 1
    assert all(len(c) <= 50 for c in calls)

    # A second run doesn't look up papers that were just checked.
    calls.clear()
    enrich_from_openalex(conn, limit=100_000, fetch=fake_fetch, sleep=lambda s: None)
    assert not any(published in c or missing in c for c in calls)

    # A later re-derivation with no arXiv signal keeps the OpenAlex result.
    derive_venues(conn, full=True)
    assert _checked(conn, published)["venue_source"] == "openalex"


def test_enrich_rechecks_recent_unknowns_after_30_days_but_not_old_ones(conn, committed_papers):
    import datetime as dt

    from aisafety_pipeline.venue import enrich_from_openalex

    recent = committed_papers("2401.30051", llm_relevant=True, published=dt.date.today().isoformat())
    old = committed_papers("2401.30052", llm_relevant=True, published="2019-01-01")
    conn.execute(
        "UPDATE papers SET openalex_checked_at = now() - interval '31 days' WHERE id = ANY(%s)", ([recent, old],)
    )
    conn.commit()
    seen = []
    enrich_from_openalex(conn, limit=100_000, fetch=lambda ids: seen.extend(ids) or {}, sleep=lambda s: None)
    assert recent in seen
    assert old not in seen


def test_enrich_never_touches_papers_the_rules_marked_reviewed(conn, committed_papers):
    from aisafety_pipeline.venue import enrich_from_openalex

    aid = committed_papers("2401.30061", journal_ref="ICLR 2023", llm_relevant=True)
    derive_venues(conn)
    seen = []
    enrich_from_openalex(conn, limit=100_000, fetch=lambda ids: seen.extend(ids) or {}, sleep=lambda s: None)
    assert aid not in seen
    assert _checked(conn, aid)["venue_source"] == "journal_ref"


def test_an_openalex_failure_stops_enrichment_softly(conn, committed_papers, monkeypatch):
    """An outage or exhausted budget ends the stage without raising (run-all
    goes on to the graph stages); finished batches stay committed and the
    failed batch isn't stamped, so the next run resumes there."""
    import requests

    from aisafety_pipeline import venue

    ids = [committed_papers(f"2401.3010{i}", comments="15 pages", llm_relevant=True) for i in range(3)]
    derive_venues(conn)
    calls = []

    def flaky_fetch(chunk):
        calls.append(list(chunk))
        if len(calls) > 1:
            raise requests.HTTPError("429 Client Error for url: https://api.openalex.org/works?api_key=SECRET")
        return {}

    monkeypatch.setattr(venue, "_OPENALEX_BATCH", 1)
    counts = venue.enrich_from_openalex(conn, limit=100_000, fetch=flaky_fetch, sleep=lambda s: None)

    assert counts["error"] and "SECRET" not in counts["error"]
    first, failed = calls[0][0], calls[1][0]
    assert _checked(conn, first)["openalex_checked_at"] is not None
    assert _checked(conn, failed)["openalex_checked_at"] is None
    assert all(i in {first, failed} or _checked(conn, i)["openalex_checked_at"] is None for i in ids)


def test_refresh_names_rewrites_only_openalex_venues(conn, committed_papers):
    from aisafety_pipeline.venue import refresh_openalex_names

    lncs = committed_papers("2401.30071", comments="15 pages", llm_relevant=True)
    rules = committed_papers("2401.30072", journal_ref="ICLR 2023", llm_relevant=True)
    derive_venues(conn)
    conn.execute(
        "UPDATE papers SET peer_reviewed = TRUE, venue = 'Lecture notes in computer science', "
        "venue_type = 'conference', venue_source = 'openalex' WHERE id = %s",
        (lncs,),
    )
    conn.commit()
    work = {
        "publication_year": 2024,
        "primary_location": {"source": {"display_name": "Lecture notes in computer science", "type": "book series"},
                             "version": "publishedVersion"},
        "locations": [],
    }
    seen = []

    def fake_fetch(ids):
        seen.extend(ids)
        return {pid: work for pid in ids}

    counts = refresh_openalex_names(conn, fetch=fake_fetch, sleep=lambda s: None)

    assert lncs in seen and rules not in seen
    assert counts["renamed"] >= 1
    row = _checked(conn, lncs)
    assert (row["peer_reviewed"], row["venue"], row["venue_source"]) == (True, "Springer LNCS", "openalex")
    assert _checked(conn, rules)["venue"] == "ICLR 2023"
