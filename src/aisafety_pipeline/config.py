from __future__ import annotations

import os
from pathlib import Path

# Load .env from the project root (two levels up from this file: src/aisafety_pipeline/ → root)
try:
    from dotenv import load_dotenv
    _env = Path(__file__).parent.parent.parent / ".env"
    if _env.exists():
        load_dotenv(_env, override=False)  # override=False: shell env vars take precedence
except ImportError:
    pass

DATA_DIR = Path(os.getenv("AIS_DATA_DIR", Path.cwd() / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", "")  # PostgreSQL DSN when set
STATE_FILE = os.getenv("AIS_STATE_FILE", str(DATA_DIR / "last_run.txt"))

EMB_DIMS = 768
EMB_MODEL = "specter2"

# Topic embedding: used for semantic search and the graph layout --
# SPECTER2 (above) is trained on citation proximity, a poor fit for matching
# against generic topic phrases or short queries. Kept separate from
# EMB_MODEL/EMB_DIMS, which stay describing SPECTER2 for /api/papers/related.
TOPIC_EMB_DIMS = 768
TOPIC_EMB_MODEL = "BAAI/bge-base-en-v1.5"

# OAI-PMH
OAI_BASE = "https://export.arxiv.org/oai2"
OAI_SETS = ["cs", "stat", "econ", "eess:eess:SY"]
OAI_PREFIX = "arXiv"
OAI_THROTTLE_SEC = 3

# API
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
API_CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "https://alignment-graph.netlify.app,http://localhost:5173,http://localhost:4173",
).split(",")

API_DB_POOL_MIN = int(os.getenv("API_DB_POOL_MIN", "1"))
API_DB_POOL_MAX = int(os.getenv("API_DB_POOL_MAX", "10"))

# Semantic search loads a transformer embedding model into memory; only
# self-hosted deployments (which run alongside the pipeline) enable it.
ENABLE_SEMANTIC_SEARCH = os.getenv("ENABLE_SEMANTIC_SEARCH", "false").strip().lower() in (
    "1",
    "true",
    "yes",
)

# LLM classification (post stage-2 combined relevance + taxonomy tagging,
# see llm_classify.py). Model name is kept as a plain, easily-swappable
# string -- not validated against a known-model list.
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-5.6-luna")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "5"))
LLM_REQUEST_TIMEOUT_SEC = int(os.getenv("LLM_REQUEST_TIMEOUT_SEC", "60"))

# OpenAI enforces an org-wide "enqueued tokens" cap per model across all
# currently-processing Batch API jobs (separate from the 50k-request and
# 200MB-file per-batch limits) -- confirmed in production: submitting three
# ~20k-request batches back to back failed all three with
# `token_limit_exceeded` at this org's actual limit of 5,000,000. Kept well
# under that here (not counting on the ceiling being exactly this number,
# and leaving room for anything else sharing the org's quota); override via
# env if this org's real limit is confirmed to be different.
LLM_BATCH_MAX_ENQUEUED_TOKENS = int(os.getenv("LLM_BATCH_MAX_ENQUEUED_TOKENS", "3000000"))

# UI colors (TTY)
GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; CYAN = "\033[96m"; RESET = "\033[0m"