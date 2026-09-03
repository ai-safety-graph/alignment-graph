from __future__ import annotations

from aisafety_pipeline.arxiv_ids import normalize_arxiv_id_or_url


def test_bare_id():
    assert normalize_arxiv_id_or_url("2401.01234") == "https://arxiv.org/abs/2401.01234"


def test_bare_id_with_version():
    assert normalize_arxiv_id_or_url("2401.01234v2") == "https://arxiv.org/abs/2401.01234v2"


def test_full_abs_url_passthrough():
    url = "https://arxiv.org/abs/2401.01234"
    assert normalize_arxiv_id_or_url(url) == url


def test_pdf_url_normalizes_to_abs_url():
    assert normalize_arxiv_id_or_url("https://arxiv.org/pdf/2401.01234v1") == (
        "https://arxiv.org/abs/2401.01234v1"
    )


def test_url_without_extractable_id_returned_as_is():
    url = "https://arxiv.org/list/cs.AI/2401"
    assert normalize_arxiv_id_or_url(url) == url


def test_empty_string():
    assert normalize_arxiv_id_or_url("") == ""


def test_whitespace_only():
    assert normalize_arxiv_id_or_url("   ") == ""


def test_strips_whitespace():
    assert normalize_arxiv_id_or_url("  2401.01234  ") == "https://arxiv.org/abs/2401.01234"
