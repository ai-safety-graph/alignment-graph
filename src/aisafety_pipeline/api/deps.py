from __future__ import annotations

import threading

from ..config import API_DB_POOL_MAX, API_DB_POOL_MIN, API_DB_POOL_TIMEOUT, DATABASE_URL
from ..db import PgConnection

_pool = None


class PoolTimeout(Exception):
    """No pooled connection became free within API_DB_POOL_TIMEOUT (mapped to 503 in main.py)."""


class _VectorAwarePool:
    """ThreadedConnectionPool that registers pgvector's type adapter once
    per physical connection, instead of once per request."""

    def __init__(self, minconn: int, maxconn: int, dsn: str):
        import psycopg2.extras
        from psycopg2.pool import ThreadedConnectionPool

        class _Inner(ThreadedConnectionPool):
            def _connect(self, key=None):
                conn = super()._connect(key)
                try:
                    from pgvector.psycopg2 import register_vector
                    register_vector(conn)
                except Exception:
                    conn.rollback()
                return conn

        self._pool = _Inner(
            minconn, maxconn, dsn, cursor_factory=psycopg2.extras.DictCursor
        )

    def getconn(self):
        return self._pool.getconn()

    def putconn(self, conn):
        self._pool.putconn(conn)

    def closeall(self):
        self._pool.closeall()


class _BoundedPool:
    """Makes callers wait for a free connection instead of failing.

    psycopg2's ThreadedConnectionPool raises PoolError the moment all
    `maxconn` connections are borrowed, so the 11th concurrent request was a
    500. A semaphore sized to the pool queues borrowers for up to `timeout`
    seconds and raises PoolTimeout only if nothing frees up.
    """

    def __init__(self, inner, maxconn: int, timeout: float):
        self._inner = inner
        self._slots = threading.BoundedSemaphore(maxconn)
        self._timeout = timeout

    def getconn(self):
        if not self._slots.acquire(timeout=self._timeout):
            raise PoolTimeout(f"no database connection free within {self._timeout}s")
        try:
            return self._inner.getconn()
        except BaseException:
            self._slots.release()
            raise

    def putconn(self, conn):
        try:
            self._inner.putconn(conn)
        finally:
            self._slots.release()

    def closeall(self):
        self._inner.closeall()


def init_pool() -> None:
    """Create the API's connection pool. Call once, at app startup."""
    global _pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set. The API requires PostgreSQL.")
    _pool = _BoundedPool(
        _VectorAwarePool(API_DB_POOL_MIN, API_DB_POOL_MAX, DATABASE_URL),
        API_DB_POOL_MAX,
        API_DB_POOL_TIMEOUT,
    )


def close_pool() -> None:
    """Close all pooled connections. Call once, at app shutdown."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


def get_conn():
    """FastAPI dependency: yields a PgConnection borrowed from the pool.

    Returns the underlying connection to the pool (rather than closing it)
    once the request finishes, rolling back first so a request that raised
    mid-transaction doesn't leak an open transaction to the next borrower.
    """
    if _pool is None:
        raise RuntimeError("Connection pool not initialized — call init_pool() at startup.")
    raw = _pool.getconn()
    try:
        conn = PgConnection.from_raw(raw)
        try:
            yield conn
        finally:
            try:
                conn.rollback()
            except Exception:
                pass
    finally:
        _pool.putconn(raw)
