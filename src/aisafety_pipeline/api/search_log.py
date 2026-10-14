"""Anonymous search analytics: one `search_log` row per search.

Stores the normalized query text, search mode and result count -- no IPs or
user identifiers. Routes schedule `log_search` as a background task so it runs
after the response is sent, on its own pooled connection (the request's
connection is rolled back on release, so it can't carry the write).
Failures are logged and swallowed: analytics must never break a search.
"""
from __future__ import annotations

import logging

from .. import config
from . import deps

logger = logging.getLogger(__name__)

MAX_QUERY_LEN = 200


def log_search(query: str, mode: str, total: int, has_filters: bool) -> None:
    if not config.SEARCH_LOG_ENABLED:
        return
    normalized = " ".join(query.split()).lower()[:MAX_QUERY_LEN]
    if not normalized:
        return
    try:
        with deps.borrow_conn() as conn:
            conn.execute(
                "INSERT INTO search_log (query, mode, total, has_filters) VALUES (%s, %s, %s, %s)",
                [normalized, mode, total, has_filters],
            )
            conn.commit()
    except Exception as exc:
        logger.warning("search_log write failed: %s", exc)
