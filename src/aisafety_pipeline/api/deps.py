from __future__ import annotations
from contextlib import contextmanager
from ..db import PgConnection
from ..config import DATABASE_URL


def get_conn():
    """FastAPI dependency: yields a PgConnection and closes it after the request."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set. The API requires PostgreSQL.")
    conn = PgConnection(DATABASE_URL)
    try:
        yield conn
    finally:
        conn.close()
