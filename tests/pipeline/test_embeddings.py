from __future__ import annotations

from aisafety_pipeline.embeddings import _apply_query_prefix

_PREFIX = "Represent this sentence for searching relevant passages: "


def test_apply_query_prefix_prepends_to_each_text():
    assert _apply_query_prefix(["reward hacking", "mechanistic interpretability"]) == [
        _PREFIX + "reward hacking",
        _PREFIX + "mechanistic interpretability",
    ]


def test_apply_query_prefix_handles_none_and_empty():
    assert _apply_query_prefix([None, ""]) == [_PREFIX, _PREFIX]


def test_apply_query_prefix_empty_list():
    assert _apply_query_prefix([]) == []
