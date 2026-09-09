from __future__ import annotations

import numpy as np

from aisafety_pipeline.tagging import select_tags

PHRASES = ["reward hacking", "deceptive alignment", "scalable oversight", "fairness and bias"]


def test_select_tags_keeps_only_above_floor():
    sims = np.array([0.9, 0.2, 0.5, 0.1])
    tags = select_tags(sims, PHRASES, cosine_floor=0.4, top_n=4)
    assert {t for t, _ in tags} == {"reward hacking", "scalable oversight"}


def test_select_tags_sorted_descending_by_score():
    sims = np.array([0.5, 0.9, 0.6, 0.0])
    tags = select_tags(sims, PHRASES, cosine_floor=0.4, top_n=4)
    assert [t for t, _ in tags] == ["deceptive alignment", "scalable oversight", "reward hacking"]
    scores = [s for _, s in tags]
    assert scores == sorted(scores, reverse=True)


def test_select_tags_caps_at_top_n():
    sims = np.array([0.9, 0.8, 0.7, 0.6])
    tags = select_tags(sims, PHRASES, cosine_floor=0.0, top_n=2)
    assert [t for t, _ in tags] == ["reward hacking", "deceptive alignment"]


def test_select_tags_falls_back_to_best_match_when_nothing_clears_floor():
    sims = np.array([0.1, 0.2, 0.1, 0.0])
    tags = select_tags(sims, PHRASES, cosine_floor=0.4, top_n=4)
    assert tags == [("deceptive alignment", 0.2)]


def test_select_tags_scores_match_input():
    sims = np.array([0.9, 0.1, 0.5, 0.1])
    tags = select_tags(sims, PHRASES, cosine_floor=0.4, top_n=4)
    assert dict(tags) == {"reward hacking": 0.9, "scalable oversight": 0.5}
