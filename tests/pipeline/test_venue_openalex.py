"""OpenAlex mapping tests. Works are trimmed copies of real OpenAlex
records for arXiv papers whose arXiv fields gave no peer-review signal."""
from __future__ import annotations

import pytest

from aisafety_pipeline import venue
from aisafety_pipeline.venue import classify_openalex_work


def _loc(name, stype, version="publishedVersion", url=None):
    return {
        "landing_page_url": url,
        "source": {"display_name": name, "type": stype} if name else None,
        "version": version,
    }


_ARXIV_LOC = _loc("arXiv (Cornell University)", "repository", "submittedVersion", "https://arxiv.org/abs/2003.01886")


def _work(*locs, year=2020, doi="https://doi.org/10.1109/itsc45102.2020.9294590"):
    return {"doi": doi, "publication_year": year, "primary_location": locs[0], "locations": list(locs)}


@pytest.mark.parametrize(
    ("work", "venue_name", "venue_type"),
    [
        # "8 pages and submitted to IEEE ITSC 2020" -- later accepted
        (_work(_loc("IEEE International Conference on Intelligent Transportation Systems (ITSC)", "conference"),
               _ARXIV_LOC), "ITSC 2020", "conference"),
        # "12 pages, 10 figures, under-review conference" -- later a journal article
        (_work(_loc("Safety Science", "journal"), _ARXIV_LOC, year=2026), "Safety Science", "journal"),
        (_work(_loc("Findings of the Association for Computational Linguistics: EMNLP (Findings of EMNLP)",
                    "conference"), _ARXIV_LOC, year=2025), "EMNLP 2025 Findings", "conference"),
        (_work(_loc("neural information processing systems", "conference"), _ARXIV_LOC, year=2024),
         "NeurIPS 2024", "conference"),
        (_work(_loc("ACM SIGKDD Conference on Knowledge Discovery and Data Mining (KDD)", "conference"),
               _ARXIV_LOC, year=2024), "KDD 2024", "conference"),
        (_work(_loc("Natural Legal Language Processing Workshop (NLLP)", "conference"), _ARXIV_LOC, year=2026),
         "NLLP 2026 Workshop", "workshop"),
        (_work(_loc("Lecture notes in computer science", "book series"), _ARXIV_LOC, year=2022),
         "Lecture notes in computer science", "conference"),
        # The published location needn't be the primary one
        (_work(_ARXIV_LOC, _loc("AI & Society", "journal")), "AI & Society", "journal"),
    ],
)
def test_published_location_means_reviewed(work, venue_name, venue_type):
    res = classify_openalex_work(work)
    assert (res.peer_reviewed, res.venue, res.venue_type, res.source) == (True, venue_name, venue_type, "openalex")


@pytest.mark.parametrize(
    "work",
    [
        _work(_ARXIV_LOC),  # arXiv only
        _work(_loc("SSRN Electronic Journal", "journal"), _ARXIV_LOC),  # preprint host typed as a journal
        _work(_loc("Qeios", "journal"), _ARXIV_LOC),
        _work(_loc("AI and Ethics", "journal", version="submittedVersion"), _ARXIV_LOC),  # not the reviewed version
        _work(_loc(None, None), _ARXIV_LOC),  # location without a source
    ],
)
def test_no_published_location_is_unknown(work):
    assert classify_openalex_work(work).peer_reviewed is None


def test_arxiv_ids_in_work_reads_dois_and_location_urls():
    work = {
        "doi": "https://doi.org/10.48550/arxiv.2401.00001",
        "locations": [
            {"landing_page_url": "https://arxiv.org/abs/2401.00002v3", "pdf_url": "https://arxiv.org/pdf/2401.00003v1.pdf"},
            {"landing_page_url": "http://arxiv.org/abs/cs/0601001", "pdf_url": None},
            {"landing_page_url": "https://doi.org/10.1145/1", "pdf_url": None},
        ],
    }
    assert venue._arxiv_ids_in_work(work) == {"2401.00001", "2401.00002", "2401.00003", "cs/0601001"}


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_fetch_matches_merged_works_back_through_arxiv_urls(monkeypatch):
    """A preprint merged with its published version comes back under the
    publisher DOI; it must still map to the requested paper."""
    captured = {}

    class _Session:
        def get(self, url, params, timeout, headers):
            captured.update(url=url, params=params)
            return _Resp({"results": [
                {"doi": "https://doi.org/10.1109/itsc45102.2020.9294590",
                 "locations": [{"landing_page_url": "https://arxiv.org/abs/2003.01886", "pdf_url": None}]},
                {"doi": "https://doi.org/10.48550/arxiv.2401.00001", "locations": []},
                {"doi": "https://doi.org/10.48550/arxiv.9999.99999", "locations": []},  # not requested
            ]})

    monkeypatch.setattr("aisafety_pipeline.venue._get_openalex_session", lambda: _Session())
    monkeypatch.setattr("aisafety_pipeline.config.OPENALEX_MAILTO", "ops@example.com")
    found = venue.fetch_openalex_works(
        ["https://arxiv.org/abs/2003.01886", "https://arxiv.org/abs/2401.00001", "https://arxiv.org/abs/2401.00002"]
    )
    assert set(found) == {"https://arxiv.org/abs/2003.01886", "https://arxiv.org/abs/2401.00001"}
    assert captured["params"]["filter"] == (
        "doi:10.48550/arxiv.2003.01886|10.48550/arxiv.2401.00001|10.48550/arxiv.2401.00002"
    )
    assert captured["params"]["mailto"] == "ops@example.com"
    assert "api_key" not in captured["params"]


def test_a_published_duplicate_wins_over_an_arxiv_only_work(monkeypatch):
    """Two works can carry one arXiv id; whichever order OpenAlex returns
    them in, the one showing a publication is kept."""
    pid = "https://arxiv.org/abs/2003.01886"
    published = _work(_loc("Safety Science", "journal"), _ARXIV_LOC)
    arxiv_only = _work(_ARXIV_LOC, doi="https://doi.org/10.48550/arxiv.2003.01886")
    for results in ([published, arxiv_only], [arxiv_only, published]):
        class _Session:
            def get(self, url, params, timeout, headers, _r=results):
                return _Resp({"results": _r})

        monkeypatch.setattr("aisafety_pipeline.venue._get_openalex_session", lambda s=_Session: s())
        assert venue.fetch_openalex_works([pid])[pid] is published


def test_secrets_are_redacted_from_urls_and_retry_logs():
    import logging

    msg = "429 Client Error for url: https://api.openalex.org/works?filter=x&mailto=a%40b.com&api_key=SECRET"
    assert venue._redact(msg) == (
        "429 Client Error for url: https://api.openalex.org/works?filter=x&mailto=***&api_key=***"
    )
    record = logging.LogRecord("urllib3.connectionpool", logging.WARNING, __file__, 1,
                               "Retrying after connection broken: %s", ("/works?api_key=SECRET",), None)
    venue._RedactSecrets().filter(record)
    assert "SECRET" not in record.getMessage()


def test_limit_zero_is_respected(monkeypatch):
    import argparse

    class _Conn:
        def close(self):
            pass

    seen = {}

    def fake_enrich(conn, limit):
        seen["limit"] = limit
        return {"checked": 0, "reviewed": 0, "not_found": 0, "error": None, "transient": False}

    monkeypatch.setattr("aisafety_pipeline.db.connect", lambda db: _Conn())
    monkeypatch.setattr(venue, "enrich_from_openalex", fake_enrich)
    venue.cmd_venue_enrich(argparse.Namespace(db=None, limit=0))
    assert seen["limit"] == 0


def test_openalex_session_caps_retry_after():
    adapter = venue._get_openalex_session().get_adapter("https://api.openalex.org/works")

    class _R:
        headers = {"Retry-After": "3600"}

    assert adapter.max_retries.get_retry_after(_R()) == venue._MAX_RETRY_AFTER_SEC
    # Retry.new() (called on every retry) keeps the capped subclass
    assert adapter.max_retries.new().get_retry_after(_R()) == venue._MAX_RETRY_AFTER_SEC


def test_redaction_covers_both_urllib3_loggers():
    import logging

    venue._install_log_redaction()
    for name in ("urllib3.connectionpool", "urllib3.util.retry"):
        assert any(isinstance(f, venue._RedactSecrets) for f in logging.getLogger(name).filters)


def _http_error(status):
    import requests

    resp = requests.Response()
    resp.status_code = status
    return requests.HTTPError(f"{status} for url: https://api.openalex.org/works?api_key=SECRET", response=resp)


def test_transient_errors():
    import requests

    assert venue._is_transient(_http_error(429))
    assert venue._is_transient(_http_error(503))
    assert venue._is_transient(requests.ConnectionError("refused"))
    assert venue._is_transient(requests.exceptions.RetryError("too many 503s"))
    assert venue._is_transient(requests.exceptions.ChunkedEncodingError("connection dropped mid-body"))
    assert venue._is_transient(requests.exceptions.JSONDecodeError("Expecting value", "<html>", 0))
    assert not venue._is_transient(_http_error(401))
    assert not venue._is_transient(_http_error(400))


@pytest.mark.parametrize(("run_all", "status", "raises", "deferred"), [
    (False, 503, True, False),   # manual run: any failure exits non-zero
    (False, 401, True, False),
    (True, 503, False, False),   # run-all, transient: a warning only
    (True, 401, False, True),    # run-all, permanent: run-all fails at the end
])
def test_enrich_errors_by_context(monkeypatch, run_all, status, raises, deferred):
    import argparse

    class _Conn:
        def close(self):
            pass

    def fake_enrich(conn, limit):
        return {"checked": 0, "reviewed": 0, "not_found": 0,
                "error": venue._redact(str(_http_error(status))), "transient": venue._is_transient(_http_error(status))}

    monkeypatch.setattr("aisafety_pipeline.db.connect", lambda db: _Conn())
    monkeypatch.setattr(venue, "enrich_from_openalex", fake_enrich)
    args = argparse.Namespace(db=None, limit=None, run_all=run_all, deferred_failures=[])
    if raises:
        with pytest.raises(SystemExit) as exc:
            venue.cmd_venue_enrich(args)
        assert "SECRET" not in str(exc.value.code)
    else:
        venue.cmd_venue_enrich(args)
        assert bool(args.deferred_failures) is deferred
