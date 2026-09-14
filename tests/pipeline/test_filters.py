from __future__ import annotations

import numpy as np

from aisafety_pipeline.filters import (
    _col_zscore,
    _looks_like_ai_safety,
    _policyish,
    domain_from_arxiv_categories,
    load_seed_groups,
)


def test_domain_tech_only():
    assert domain_from_arxiv_categories("cs.LG stat.ML") == "tech"


def test_domain_gov_only():
    assert domain_from_arxiv_categories("econ.GN") == "gov"


def test_domain_both():
    assert domain_from_arxiv_categories("cs.AI econ.GN") == "both"


def test_domain_unknown_for_unrelated_categories():
    assert domain_from_arxiv_categories("math.CO physics.soc-ph") == "unknown"


def test_domain_empty_categories():
    assert domain_from_arxiv_categories("") == "unknown"


def test_looks_like_ai_safety_positive():
    assert _looks_like_ai_safety(
        "Mitigating Reward Hacking in RLHF",
        "We study reward hacking in reinforcement learning from human feedback.",
    )


def test_looks_like_ai_safety_negative():
    assert not _looks_like_ai_safety(
        "A Faster Sorting Algorithm",
        "We present an improved comparison sort with better cache locality.",
    )


def test_looks_like_ai_safety_matches_jailbreaking():
    assert _looks_like_ai_safety(
        "Jailbreaking Large Language Models via Prompt Injection", ""
    )


def test_policyish_econ_category():
    assert _policyish("econ.GN cs.LG")


def test_policyish_cs_cy_category():
    assert _policyish("cs.CY")


def test_policyish_false_for_unrelated_categories():
    assert not _policyish("cs.LG stat.ML")


def test_load_seed_groups_groups_by_subtopic(tmp_path):
    tsv = tmp_path / "seeds_subtopics.tsv"
    tsv.write_text(
        "arxiv_id\tsubtopic\ttitle\tpublished\n"
        "1606.06565\talignment\tConcrete Problems in AI Safety\t2016-06-21\n"
        "2212.08073\talignment\tConstitutional AI\t2022-12-15\n"
        "2402.01234\tinterpretability\tSome Interp Paper\t2024-02-01\n"
    )
    groups = load_seed_groups(tsv)
    assert set(groups) == {"alignment", "interpretability"}
    assert len(groups["alignment"]) == 2
    assert len(groups["interpretability"]) == 1


def test_load_seed_groups_normalizes_ids(tmp_path):
    tsv = tmp_path / "seeds_subtopics.tsv"
    tsv.write_text(
        "arxiv_id\tsubtopic\n"
        "https://arxiv.org/abs/1606.06565\talignment\n"
    )
    groups = load_seed_groups(tsv)
    assert groups["alignment"] == ["https://arxiv.org/abs/1606.06565"]


def test_col_zscore_centers_each_column_independently():
    # Column 0 runs uniformly high, column 1 uniformly low -- z-scoring
    # should put both on the same footing rather than letting column 0's
    # higher raw baseline dominate every row's argmax.
    sims = np.array([
        [0.9, 0.1],
        [0.8, 0.2],
        [0.7, 0.3],
    ])
    z = _col_zscore(sims)
    assert np.allclose(z.mean(axis=0), 0.0, atol=1e-9)
    # Row 0 is the max within *both* columns (0.9 is col-0 max, 0.1 is
    # col-1 min) -- after z-scoring it should be the top z-score in col 0
    # and the bottom in col 1, i.e. the two columns' rankings still agree
    # with their own raw order.
    assert z[0, 0] == z[:, 0].max()
    assert z[0, 1] == z[:, 1].min()


def test_col_zscore_lets_a_low_baseline_column_win_its_best_row():
    # Column 0's *worst* row (0.5) still beats column 1's *best* row (0.3)
    # in raw cosine -- but column 1 is much more discriminating for its
    # best row once each column is judged against its own spread, which is
    # exactly the case multi-centroid scoring needs to get right: a paper
    # that's a strong match for a low-baseline sub-centroid should be able
    # to outscore one that's a mediocre match for a high-baseline one.
    sims = np.array([
        [0.5, 0.1],
        [0.5, 0.1],
        [0.5, 0.3],
    ])
    z = _col_zscore(sims)
    assert z[2, 1] > z[2, 0]
