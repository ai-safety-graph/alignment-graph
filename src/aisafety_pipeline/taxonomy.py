"""Fixed taxonomy of AI-safety topics used to label kmeans clusters.

Each cluster's label is whichever entry here has the highest cosine
similarity to that cluster's centroid embedding (see
`label_clusters_default` in labeling.py) -- this is zero-shot
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
