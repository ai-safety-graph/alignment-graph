"""Fixed taxonomy of AI-safety topics used to tag papers.

Each paper can be tagged with any number of entries here whose cosine
similarity to the paper's topic embedding clears the configured floor
(see `select_tags` in tagging.py) -- this is zero-shot multi-label
classification against a curated topic list, not text mined from the
papers themselves. Edit this list directly to add, rename, split, or
remove topics; no other code needs to change.
"""

TAXONOMY: list[str] = [
    "reward hacking",
    "deceptive alignment",
    "scalable oversight",
    "mechanistic interpretability",
    "adversarial robustness",
    "jailbreaking and prompt injection",
    "AI governance and policy",
    "value alignment",
    "red teaming and safety evaluation",
    "goal misgeneralization",
    "reinforcement learning from human feedback",
    "large language model safety",
    "agentic AI safety",
    "AI risk assessment",
    "explainability and transparency",
    "safe exploration",
    "out-of-distribution robustness",
    "human-AI oversight and interaction",
    "benchmark and dataset construction",
    "fairness and bias",
    "privacy and data protection",
    "multi-agent safety and cooperation",
    "existential and long-term risk",
    "watermarking and provenance",
    "hallucination and truthfulness",
]

# A few short TAXONOMY labels embed too close to a broader or unrelated
# sense of the same words -- e.g. "value alignment" matches papers about
# representational/model alignment that have nothing to do with human
# values, and "reinforcement learning from human feedback" matches any
# paper doing plain reward-driven RL. Mapping such a label to a longer,
# more specific phrase here changes only what gets embedded for matching
# (tagging.py); the label itself -- what's stored in `paper_tags` and
# shown in the UI -- is untouched.
#
# A first attempt at this (longer, descriptive sentences for those 4
# labels) was tried and reverted: scripts/eval_tagging.py against a
# 60-paper hand-labeled sample showed it raised similarity scores nearly
# uniformly across true AND false matches (best-floor F1 dropped from
# 0.52 to 0.48) rather than sharpening the boundary -- the longer text
# just read as more generically "safety-ish" to the embedding model. Any
# replacement entry needs to be re-validated the same way before being
# kept, not just judged by eye.
TAXONOMY_EMBEDDING_TEXT: dict[str, str] = {}


def embedding_texts(phrases: list[str]) -> list[str]:
    """Map each taxonomy label to the (possibly longer) text used for its
    embedding -- see TAXONOMY_EMBEDDING_TEXT. Labels with no override, and
    any ad-hoc `--extra` phrase, just embed as themselves.
    """
    return [TAXONOMY_EMBEDDING_TEXT.get(p, p) for p in phrases]
