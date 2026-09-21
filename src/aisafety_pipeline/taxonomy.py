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


# Per-phrase descriptions fed to the LLM classification stage (llm_classify.py)
# only -- unrelated to TAXONOMY_EMBEDDING_TEXT above, which targets a
# different mechanism (BGE embedding similarity) with a different failure
# mode. An LLM reading a paper's abstract can be told directly how to tell
# two overlapping categories apart; a short phrase fed to an embedding model
# cannot. These are a first draft: if eval_llm_classify.py shows a category
# pair being systematically confused, revise the relevant description(s) and
# re-run the eval set (no DB writes, cheap to iterate).
TAXONOMY_DESCRIPTIONS: dict[str, str] = {
    "alignment and value specification": (
        "Designing or training a model to pursue the intended objective in the "
        "first place -- reward/objective design, RLHF and other preference "
        "learning, corrigibility, value learning. Not about checking a model's "
        "behavior after the fact (see oversight and safety evaluation)."
    ),
    "interpretability and explainability": (
        "Understanding what is happening inside a model or why it produced a "
        "given output -- mechanistic interpretability, feature/circuit analysis, "
        "sparse autoencoders, representation engineering, activation steering, "
        "explainability methods."
    ),
    "oversight and safety evaluation": (
        "Measuring, monitoring, or red-teaming a model's behavior after it "
        "exists -- capability evaluations, safety benchmarks, scalable "
        "oversight, red-teaming, auditing. Contrast with alignment and value "
        "specification, which is about designing what the model optimizes for, "
        "not measuring what it does."
    ),
    "adversarial robustness and security": (
        "Deliberate attacks against a model or system -- jailbreaks, prompt "
        "injection, data/model poisoning, evasion attacks, extraction attacks. "
        "Contrast with robustness and generalization, which covers failures "
        "that arise without an adversary."
    ),
    "robustness and generalization": (
        "Non-adversarial failure modes -- performance under distribution shift, "
        "spurious correlations, out-of-distribution generalization, calibration "
        "under natural (not attacker-crafted) inputs. Contrast with adversarial "
        "robustness and security, which requires an adversary."
    ),
    "large language model safety": (
        "LLM-specific safety issues that don't cleanly fit a more specific "
        "category above -- hallucination, toxicity, misuse, harmful content "
        "generation, safety fine-tuning of chat/instruction-following models. "
        "Prefer a more specific category (e.g. interpretability, adversarial "
        "robustness) when a paper's core contribution is squarely about one."
    ),
    "agentic and multi-agent safety": (
        "Safety issues specific to AI agents that take actions, use tools, or "
        "interact with other agents -- autonomous agent safety, multi-agent "
        "coordination/collusion risks, tool-use safety, agentic goal pursuit."
    ),
    "AI governance and policy": (
        "Regulation, standards, institutions, and policy responses to AI risk "
        "-- laws (e.g. EU AI Act), standards bodies, government policy, "
        "compliance frameworks, institutional design. Contrast with existential "
        "and long-term risk, which is about the underlying risk arguments "
        "themselves, not the policy response to them."
    ),
    "existential and long-term risk": (
        "Catastrophic or civilizational-scale risk from advanced AI -- "
        "existential risk arguments, long-term/x-risk forecasting, power-"
        "seeking behavior, instrumental convergence, loss-of-control "
        "scenarios. Contrast with AI governance and policy, which covers "
        "regulatory/institutional responses rather than the risk case itself."
    ),
    "fairness and societal impact": (
        "Bias, fairness, discrimination, and broader societal effects of AI "
        "systems on people and communities -- algorithmic fairness, "
        "disparate impact, social/economic effects of AI deployment."
    ),
    "privacy and data protection": (
        "Privacy risks from AI systems and their training/inference data -- "
        "membership inference, data extraction/memorization, differential "
        "privacy, data protection compliance."
    ),
}
