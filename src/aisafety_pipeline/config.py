from __future__ import annotations
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("AIS_DATA_DIR", Path.cwd() / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = os.getenv("AIS_DB_PATH", str(DATA_DIR / "arxiv_papers.db"))
STATE_FILE = os.getenv("AIS_STATE_FILE", str(DATA_DIR / "last_run.txt"))

EMB_DIMS = 768
EMB_MODEL = "specter2"


# OAI-PMH
OAI_BASE = "https://export.arxiv.org/oai2"
OAI_SETS = ["cs", "stat", "econ"]
OAI_PREFIX = "arXiv"
OAI_THROTTLE_SEC = 3


# UI colors (TTY)
GREEN = "\033[92m"; YELLOW = "\033[93m"; BLUE = "\033[94m"; CYAN = "\033[96m"; RESET = "\033[0m"