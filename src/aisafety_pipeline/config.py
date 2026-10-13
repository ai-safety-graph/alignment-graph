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

# Stage-2 centroid filter threshold (raw cosine similarity to the seed
# centroid). Deliberately loose: the LLM classification stage makes the real
# relevance call, so stage 2 only needs to cut obvious non-matches. The
# backfill classified everything >= 0.90, and the LLM still found 32-43% of
# the 0.90-0.92 band relevant -- a 0.92 cut silently drops those papers.
STAGE2_CENTROID_TAU = 0.90

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
    "https://alignmentgraph.com,https://alignment-graph.netlify.app,http://localhost:5173,http://localhost:4173",
).split(",")

API_DB_POOL_MAX = int(os.getenv("API_DB_POOL_MAX", "10"))
# Defaults to MAX on purpose: psycopg2's pool *closes* any returned connection
# beyond MIN, and opens new ones while holding its lock, so MIN=1 made every
# concurrent request open a fresh TLS connection to Supabase, one at a time
# (p50 5.2s at 5-way concurrency in production vs 0.7s with MIN=MAX).
API_DB_POOL_MIN = int(os.getenv("API_DB_POOL_MIN", str(API_DB_POOL_MAX)))
# Seconds a request waits for a free pooled connection before getting a 503.
API_DB_POOL_TIMEOUT = float(os.getenv("API_DB_POOL_TIMEOUT", "5"))

# Per-client-IP rate limits (slowapi / `limits` syntax, e.g. "120/minute").
# Counters live in process memory, which is accurate only while the API runs
# as a single process -- see api/ARCHITECTURE.md.
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower() in ("1", "true", "yes")
RATE_LIMIT_DEFAULT = os.getenv("RATE_LIMIT_DEFAULT", "120/minute")  # cheap reads
RATE_LIMIT_EXPENSIVE = os.getenv("RATE_LIMIT_EXPENSIVE", "30/minute")  # pgvector / large graph queries

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
GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; CYAN = "\033[96m"; RED = "\033[91m"; RESET = "\033[0m"