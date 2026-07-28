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

# OAI-PMH
OAI_BASE = "https://export.arxiv.org/oai2"
OAI_SETS = ["cs", "stat", "econ"]
OAI_PREFIX = "arXiv"
OAI_THROTTLE_SEC = 3

# API
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
API_CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "https://alignment-graph.netlify.app,http://localhost:5173,http://localhost:4173",
).split(",")

# Semantic search loads a transformer embedding model into memory; only
# self-hosted deployments (which run alongside the pipeline) enable it.
ENABLE_SEMANTIC_SEARCH = os.getenv("ENABLE_SEMANTIC_SEARCH", "false").strip().lower() in (
    "1",
    "true",
    "yes",
)

# UI colors (TTY)
GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; CYAN = "\033[96m"; RESET = "\033[0m"