from __future__ import annotations
import re

_ID_RE = re.compile(r"/(\d{4}\.\d{4,5}(v\d+)?)")


def normalize_arxiv_id_or_url(s: str) -> str:
    """
    Accepts a bare id like '2401.01234' (with optional vN) or any arXiv URL.
    Returns the canonical abs URL used as `papers.id` in the DB.
    """
    s = (s or "").strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://")):
        m = _ID_RE.search(s)
        return f"https://arxiv.org/abs/{m.group(1)}" if m else s
    return f"https://arxiv.org/abs/{s}"
