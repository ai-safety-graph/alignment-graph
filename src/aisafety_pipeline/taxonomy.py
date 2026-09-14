"""Fixed taxonomy of AI-safety topics used to tag papers.

Each paper can be tagged with any number of entries here whose (per-phrase
z-score normalized) cosine similarity to the paper's topic embedding clears
the configured floor -- see `select_tags`, `phrase_stats`, and `zscore` in
tagging.py -- this is zero-shot multi-label classification against a
curated topic list, not text mined from the papers themselves. Edit this
list directly to add, rename, split, or remove topics; no other code needs
to change.
"""

TAXONOMY: list[str] = [
    "alignment and value specification",
    "interpretability and explainability",
    "oversight and safety evaluation",
    "adversarial robustness and security",
    "robustness and generalization",
    "large language model safety",
    "agentic and multi-agent safety",
    "AI governance and policy",
    "existential and long-term risk",
    "fairness and societal impact",
    "privacy and data protection",
]

# A few short TAXONOMY labels embed too close to a broader or unrelated
# sense of the same words -- e.g. a bare "alignment" reads as papers about
# representational/model alignment that have nothing to do with human
# values, and "reinforcement learning" style phrasing matches any paper
# doing plain reward-driven RL. Mapping such a label to a longer, more
# specific phrase here changes only what gets embedded for matching
# (tagging.py); the label itself -- what's stored in `paper_tags` and
# shown in the UI -- is untouched.
#
# This is a different problem from the systematic per-category baseline
# shift that tagging.py's z-score normalization (phrase_stats/zscore)
# fixes -- that corrects for some phrases scoring higher than others
# *across the whole corpus* regardless of relevance. TAXONOMY_EMBEDDING_TEXT
# instead targets a single label whose short phrasing reads as the wrong
# *concept* to the embedding model; z-scoring a mismatched-concept phrase
# doesn't help, since the problem isn't its baseline, it's what it means.
#
# A first attempt at this (longer, descriptive sentences for 4 of the old
# pre-consolidation labels) was tried and reverted: scripts/eval_tagging.py
# against a 60-paper hand-labeled sample showed it raised similarity scores
# nearly uniformly across true AND false matches (best-floor F1 dropped
# from 0.52 to 0.48) rather than sharpening the boundary -- the longer text
# just read as more generically "safety-ish" to the embedding model. That
# run predates the z-score normalization change, so a fresh attempt should
# be re-validated against the current (z-score-based) `eval_tagging.py
# --sweep`, not just F1 by eye, and not assumed to fail the same way.
TAXONOMY_EMBEDDING_TEXT: dict[str, str] = {}


def embedding_texts(phrases: list[str]) -> list[str]:
    """Map each taxonomy label to the (possibly longer) text used for its
    embedding -- see TAXONOMY_EMBEDDING_TEXT. Labels with no override, and
    any ad-hoc `--extra` phrase, just embed as themselves.
    """
    return [TAXONOMY_EMBEDDING_TEXT.get(p, p) for p in phrases]
