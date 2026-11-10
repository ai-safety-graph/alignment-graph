from __future__ import annotations

import pytest
from fastapi import HTTPException

from aisafety_pipeline.api.recipe import (
    MAX_TERM_LENGTH,
    MAX_TERMS,
    MIN_KEYWORD_LENGTH,
    author_pattern,
    clean_terms,
    keyword_pattern,
)

# --- Pure helpers (no database) ---------------------------------------------


def test_keyword_pattern_anchors_at_word_start_and_escapes():
    assert keyword_pattern("RL") == r"\mRL"
    assert keyword_pattern("sparse  autoencoder") == r"\msparse\s+autoencoder"
    assert keyword_pattern("C++") == r"\mC\+\+"
    # No \m before a non-word first character: it could never match.
    assert keyword_pattern("(foo") == r"\(foo"
    # Director prefixes and embedded options are neutralised.
    assert keyword_pattern("***:x") == r"\*\*\*:x"


def test_author_pattern_matches_whole_entries():
    assert author_pattern("Neel Nanda") == r"(^|,\s*)Neel\s+Nanda\s*(,|$)"
    assert author_pattern("J. Smith") == r"(^|,\s*)J\.\s+Smith\s*(,|$)"


def test_clean_terms_trims_dedupes_and_drops_blanks():
    assert clean_terms(["  RLHF ", "rlhf", "", "  ", "red  teaming"], "kw") == [
        "RLHF",
        "red teaming",
    ]


def test_clean_terms_enforces_caps():
    with pytest.raises(HTTPException) as e:
        clean_terms([f"k{i}" for i in range(MAX_TERMS + 1)], "kw")
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        clean_terms(["x" * (MAX_TERM_LENGTH + 1)], "author")
    with pytest.raises(HTTPException):
        clean_terms(["RL"], "kw", MIN_KEYWORD_LENGTH)
    # Authors have no minimum: "Li Wei"-style names are short but whole.
    assert clean_terms(["Yu"], "author") == ["Yu"]


# --- Through the API (database) ---------------------------------------------


def _aids(items):
    return {i["aid"].rsplit("/", 1)[-1] for i in items}


@pytest.fixture
def corpus(make_paper):
    make_paper("2401.10001", title="Jailbreaks in large language models",
               authors="Neel Nanda, Wei Liang", tags=[("interpretability", 0.9)])
    make_paper("2401.10002", title="A world model for agents",
               summary="We study safe\nRL in gridworlds.", authors="Oliver Li")
    make_paper("2401.10003", title="Sparse autoencoders at scale",
               summary="Features in sparse\n  autoencoder dictionaries.",
               authors="Ada Lovelace, Neel Nanda", tags=[("interpretability", 0.8)])
    make_paper("2401.10004", title="C++ for verified systems",
               authors="Li Wei")


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"kw": "jailbreak"}, {"2401.10001"}),  # title, prefix of "Jailbreaks"
        ({"kw": "safe RL"}, {"2401.10002"}),  # abstract, across a line break
        ({"kw": "orld"}, set()),  # only matches at a word start, not in "world"
        ({"kw": "sparse autoencoder"}, {"2401.10003"}),  # spans a line break
        ({"kw": "C++"}, {"2401.10004"}),  # metacharacters taken literally
        ({"kw": "(oops"}, set()),  # unbalanced paren doesn't error
        ({"kw": ["jailbreak", "C++"]}, {"2401.10001", "2401.10004"}),  # any of
        ({"author": "Neel Nanda"}, {"2401.10001", "2401.10003"}),
        ({"author": "neel nanda"}, {"2401.10001", "2401.10003"}),
        ({"author": "Li"}, set()),  # not "Liang", "Oliver Li" or "Li Wei"
        ({"author": "Oliver Li"}, {"2401.10002"}),
        ({"author": ["Oliver Li", "Li Wei"]}, {"2401.10002", "2401.10004"}),
        # Facets AND together.
        ({"author": "Neel Nanda", "kw": "sparse"}, {"2401.10003"}),
        ({"author": "Neel Nanda", "tags": "interpretability", "kw": "C++"}, set()),
    ],
)
def test_recipe_facets_match_the_same_on_both_endpoints(client, corpus, params, expected):
    papers = client.get("/api/papers", params=params).json()
    graph = client.get("/api/graph/range", params=params).json()
    assert _aids(papers["items"]) == expected
    assert _aids(graph["nodes"]) == expected
    assert papers["total"] == graph["meta"]["total"] == len(expected)


@pytest.mark.parametrize("path", ["/api/papers", "/api/graph/range"])
@pytest.mark.parametrize(
    "params",
    [
        {"kw": [f"kw{i}" for i in range(MAX_TERMS + 1)]},
        {"kw": "RL"},
        {"author": "x" * (MAX_TERM_LENGTH + 1)},
    ],
)
def test_recipe_facets_reject_bad_terms(client, path, params):
    assert client.get(path, params=params).status_code == 422


def test_search_log_ignores_blank_recipe_terms(client, monkeypatch):
    from aisafety_pipeline.api.routes import papers

    calls = []
    monkeypatch.setattr(papers, "log_search", lambda *a: calls.append(a))
    client.get("/api/papers", params={"q": "foo", "kw": " "})
    client.get("/api/papers", params={"q": "foo", "kw": "jailbreak"})
    assert [c[3] for c in calls] == [False, True]
