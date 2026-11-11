from __future__ import annotations

import pytest


@pytest.fixture
def corpus(make_paper):
    make_paper("2401.20001", authors="Neel Nanda, Wei Liang")
    make_paper("2401.20002", authors="Ada Lovelace, Neel Nanda")
    make_paper("2401.20003", authors="Nan Rosemary Ke")
    make_paper("2401.20004", authors="Neel Nanda", ai_stage2_keep=False)
    make_paper("2401.20005", authors="Oliver (Ollie) Smith")


def _get(client, **params):
    res = client.get("/api/authors", params=params)
    assert res.status_code == 200
    return res.json()


def test_authors_match_word_prefix_most_prolific_first(client, corpus):
    # Irrelevant papers don't count towards n.
    assert _get(client, q="nan") == [
        {"name": "Neel Nanda", "n": 2},
        {"name": "Nan Rosemary Ke", "n": 1},
    ]


def test_authors_match_inside_a_name_only_at_word_starts(client, corpus):
    assert _get(client, q="ose") == []
    assert _get(client, q="rose") == [{"name": "Nan Rosemary Ke", "n": 1}]


def test_authors_multiword_and_case_insensitive(client, corpus):
    assert _get(client, q="NEEL  na") == [{"name": "Neel Nanda", "n": 2}]


def test_authors_query_is_escaped(client, corpus):
    assert _get(client, q="(Ollie") == [{"name": "Oliver (Ollie) Smith", "n": 1}]
    assert _get(client, q=".*n") == []


def test_authors_limit(client, corpus):
    assert len(_get(client, q="nee", limit=1)) == 1


@pytest.mark.parametrize("params", [{}, {"q": "ne"}, {"q": "x" * 81}, {"q": "abc", "limit": 21}])
def test_authors_rejects_bad_params(client, params):
    assert client.get("/api/authors", params=params).status_code == 422


def test_authors_blank_after_trim_is_empty(client, corpus):
    assert _get(client, q="  ne  ") == []
