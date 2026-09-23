"""Fixed taxonomy of AI-safety topics used to tag papers.

Each paper is tagged with a subset of the entries here by the LLM
classification stage (llm_classify.py), which is told about each label via
TAXONOMY_DESCRIPTIONS below. Edit this list directly to add, rename, split,
or remove topics; no other code needs to change.
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

# Per-phrase descriptions fed to the LLM classification stage (llm_classify.py).
# An LLM reading a paper's abstract can be told directly how to tell two
# overlapping categories apart. These are a first draft: if eval_llm_classify.py
# shows a category pair being systematically confused, revise the relevant
# description(s) and re-run the eval set (no DB writes, cheap to iterate).
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
