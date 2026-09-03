from __future__ import annotations

from aisafety_pipeline.filters import (
    _looks_like_ai_safety,
    _policyish,
    domain_from_arxiv_categories,
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
