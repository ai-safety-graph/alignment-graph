from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from .config import DATABASE_URL

if TYPE_CHECKING:
    import numpy as np

# ---------------------------------------------------------------------------
# SQL translation helpers
# ---------------------------------------------------------------------------

def _to_pg_sql(sql: str, params: Any) -> tuple[str, Any]:
    """Translate sqlite3-style SQL to psycopg2 paramstyle."""
    if isinstance(params, dict):
        sql = re.sub(r":(\w+)", r"%(\1)s", sql)
    elif params:
        sql = sql.replace("?", "%s")
    return sql, params


def vector_to_array(vec: Any) -> np.ndarray:
    """Normalize a `papers.embedding` value read via psycopg2 into a float32 array.

    pgvector's psycopg2 caster returns a plain list/ndarray on some versions
    and a `Vector` wrapper (with `.to_numpy()`) on others (>=0.5), depending
    on which pgvector-python release is installed.
    """
    import numpy as np

    if hasattr(vec, "to_numpy"):
        return vec.to_numpy().astype(np.float32)
    return np.array(vec, dtype=np.float32)


# ---------------------------------------------------------------------------
# Cursor wrappers
# ---------------------------------------------------------------------------

class _FakeCursor:
    def fetchone(self): return None
    def fetchall(self): return []
    def __iter__(self): return iter([])
    @property
    def description(self): return None
    @property
    def rowcount(self): return 0


class _PgCursor:
    """Wraps a psycopg2 DictCursor to handle BEGIN/COMMIT and ? params."""

    def __init__(self, cur, conn_ref: PgConnection):
        self._cur = cur
        self._conn = conn_ref

    def execute(self, sql: str, params=None):
        norm = sql.strip().upper()
        if norm in ("BEGIN", "BEGIN TRANSACTION"):
            return self
        if norm == "COMMIT":
            self._conn.commit()
            return self
        if norm == "ROLLBACK":
            self._conn.rollback()
            return self
        sql, params = _to_pg_sql(sql, params)
        self._cur.execute(sql, params)
        return self

    def executemany(self, sql: str, seq):
        sql, _ = _to_pg_sql(sql, ())
        for p in seq:
            self._cur.execute(sql, p)

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur)

    @property
    def description(self):
        return self._cur.description

    @property
    def rowcount(self):
        return self._cur.rowcount


# ---------------------------------------------------------------------------
# Connection wrapper
# ---------------------------------------------------------------------------

class PgConnection:
    """Wraps a psycopg2 connection with a sqlite3-compatible interface.

    Uses DictCursor so rows support both row["col"] and row[0] access.
    """

    def __init__(self, dsn: str):
        import psycopg2
        import psycopg2.extras
        self._dsn = dsn
        self._conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.DictCursor)
        self._conn.autocommit = False
        self.try_register_vector()

    def reconnect(self) -> None:
        """Replace a dead underlying connection with a fresh one to the same
        DSN. Any uncommitted work on the old connection is lost. Only for
        connections opened via `connect()`/`PgConnection(dsn)`, not pooled
        ones wrapped with `from_raw` (the pool owns those)."""
        import psycopg2
        import psycopg2.extras
        if getattr(self, "_dsn", None) is None:
            raise RuntimeError("cannot reconnect a connection wrapped via from_raw")
        try:
            self._conn.close()
        except Exception:
            pass
        self._conn = psycopg2.connect(self._dsn, cursor_factory=psycopg2.extras.DictCursor)
        self._conn.autocommit = False
        self.try_register_vector()

    @classmethod
    def from_raw(cls, conn) -> PgConnection:
        """Wrap an already-open, already-configured psycopg2 connection.

        Used by the API's connection pool: the pool owns connect() and
        register_vector() calls (done once per physical connection), so
        borrowing one for a request should skip both instead of redoing
        them on every request.
        """
        self = cls.__new__(cls)
        self._conn = conn
        return self

    def try_register_vector(self) -> bool:
        """Register pgvector's type adapter on this connection, if available.

        No-ops if pgvector isn't installed, or if the `vector` extension
        hasn't been created in the database yet (e.g. before init_db() has
        run its schema on a fresh database) -- callers that bootstrap a new
        database should call this again after CREATE EXTENSION succeeds.
        """
        try:
            from pgvector.psycopg2 import register_vector
            register_vector(self._conn)
            return True
        except ImportError:
            return False
        except Exception:
            self._conn.rollback()
            return False

    def execute(self, sql: str, params=None):
        norm = sql.strip().upper()
        if norm in ("BEGIN", "BEGIN TRANSACTION"):
            return _FakeCursor()
        if norm == "COMMIT":
            self._conn.commit()
            return _FakeCursor()
        if norm == "ROLLBACK":
            self._conn.rollback()
            return _FakeCursor()
        sql, params = _to_pg_sql(sql, params)
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur

    def cursor(self):
        import psycopg2.extras
        raw = self._conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        return _PgCursor(raw, self)

    def raw_cursor(self):
        """Return the underlying psycopg2 cursor, unwrapped.

        Needed for psycopg2.extras.execute_values(), which requires a real
        cursor (it calls .mogrify() internally) rather than the ?/:name-
        translating _PgCursor wrapper.
        """
        import psycopg2.extras
        return self._conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    # no-op — PgConnection always uses DictCursor
    @property
    def row_factory(self):
        return None

    @row_factory.setter
    def row_factory(self, value):
        pass


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

# NOTE: the legacy `paper_tags` table (zero-shot tagging, superseded by
# llm_relevant/llm_tags on `papers`) is no longer created here. Existing
# databases that already have it are left untouched -- dropping it against
# the live database is a separate, deliberately later step.

_PG_SCHEMA = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    """
    CREATE TABLE IF NOT EXISTS papers_raw (
        id TEXT PRIMARY KEY,
        title TEXT, authors TEXT, published TEXT, summary TEXT, link TEXT,
        categories TEXT, updated TEXT, pdf_url TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY REFERENCES papers_raw(id) ON DELETE CASCADE,
        title TEXT, authors TEXT, published TEXT, summary TEXT, link TEXT,
        ai_regex_hit INTEGER, ai_sem_sim REAL, ai_stage2_keep BOOLEAN,
        ai_stage2_reason TEXT, domain_tag TEXT,
        graph_x REAL, graph_y REAL,
        embedding vector(768)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_papers_keep ON papers (ai_stage2_keep)",
    "CREATE INDEX IF NOT EXISTS idx_papers_domain ON papers (domain_tag)",
]

_PG_VECTOR_INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_papers_embedding_llm ON papers "
    "USING hnsw (embedding vector_cosine_ops) "
    "WHERE llm_relevant = TRUE AND embedding IS NOT NULL"
)

_PG_VECTOR_INDEX_TOPIC = (
    "CREATE INDEX IF NOT EXISTS idx_papers_embedding_topic_llm ON papers "
    "USING hnsw (embedding_topic vector_cosine_ops) "
    "WHERE llm_relevant = TRUE AND embedding_topic IS NOT NULL"
)

# The API gates on llm_relevant / llm_tags (see api/ARCHITECTURE.md). Partial
# HNSW indexes are only used when the query's WHERE implies the index
# predicate, so the old ai_stage2_keep-based ones (idx_papers_embedding,
# idx_papers_embedding_topic) are dead weight once the *_llm ones exist.
_PG_LLM_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_papers_llm_relevant ON papers (llm_relevant)",
    "CREATE INDEX IF NOT EXISTS idx_papers_llm_tags ON papers USING gin (llm_tags)",
]
_PG_DROP_LEGACY_VECTOR_INDEXES = [
    "DROP INDEX IF EXISTS idx_papers_embedding",
    "DROP INDEX IF EXISTS idx_papers_embedding_topic",
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def connect(db_arg: str | None = None) -> PgConnection:
    """Return a connection to the configured PostgreSQL database.

    Uses DATABASE_URL env var by default; db_arg overrides it when passed
    a Postgres DSN directly.
    """
    dsn = db_arg if (db_arg and db_arg.startswith(("postgresql://", "postgres://"))) \
        else DATABASE_URL
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL is not set. This tool requires PostgreSQL — see .env.example."
        )
    return PgConnection(dsn)


def init_db(db_arg: str | None = None) -> PgConnection:
    conn = connect(db_arg)
    cur = conn.cursor()
    for stmt in _PG_SCHEMA:
        cur.execute(stmt)
    conn.commit()
    conn.try_register_vector()  # extension now exists; register if __init__ couldn't
    _ensure_columns(conn)  # adds llm_* columns the indexes below depend on
    vector_ok = True
    for stmt in (_PG_VECTOR_INDEX, _PG_VECTOR_INDEX_TOPIC):
        try:
            cur.execute(stmt)
        except Exception:
            vector_ok = False  # index may fail if the embedding col is empty; ok
            conn.rollback()
        conn.commit()
    for stmt in _PG_LLM_INDEXES:
        cur.execute(stmt)
    conn.commit()
    if vector_ok:
        for stmt in _PG_DROP_LEGACY_VECTOR_INDEXES:
            cur.execute(stmt)
        conn.commit()
    try:
        # Partial index (only in-flight rows) backing llm_classify.py's
        # release-on-failure query (`WHERE llm_batch_id = %s`). Without it,
        # that UPDATE was a full sequential scan of `papers` and hit this
        # DB's 2-minute statement_timeout in practice on a ~23k-row match.
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_papers_llm_batch_id ON papers (llm_batch_id) "
            "WHERE llm_batch_id IS NOT NULL"
        )
    except Exception:
        pass
    conn.commit()
    return conn


def _ensure_columns(conn: PgConnection) -> None:
    _ENSURE = [
        ("papers", "graph_x", "REAL"),
        ("papers", "graph_y", "REAL"),
        ("papers", "embedding_topic", "vector(768)"),
        # LLM classification stage (llm_classify.py) -- combined relevance +
        # taxonomy-tag judgment. This is what the API gates on (llm_relevant)
        # and serves as tags (llm_tags) -- see api/ARCHITECTURE.md.
        ("papers", "llm_relevant", "BOOLEAN"),
        ("papers", "llm_confidence", "REAL"),
        ("papers", "llm_tags", "TEXT[]"),
        ("papers", "llm_reason", "TEXT"),
        ("papers", "llm_model", "TEXT"),
        ("papers", "llm_classified_at", "TIMESTAMPTZ"),
        # Set while a paper is in flight in a submitted-but-uncollected
        # OpenAI Batch API job (llm_classify.py's submit_batch/collect_batch)
        # so it isn't also picked up by the synchronous path meanwhile.
        ("papers", "llm_batch_id", "TEXT"),
    ]
    for table, col, dtype in _ENSURE:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {dtype}")
        except Exception:
            pass
    conn.commit()
