from __future__ import annotations
import re, sqlite3
from typing import Any, Optional
from .config import DB_PATH, DATABASE_URL

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

    def __init__(self, cur, conn_ref: "PgConnection"):
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
# Connection wrappers
# ---------------------------------------------------------------------------

class SqliteConnection:
    """Thin wrapper around sqlite3.Connection that exposes is_pg flag."""

    is_pg: bool = False

    def __init__(self, path: str):
        self._conn = sqlite3.connect(path)
        self._conn.execute("PRAGMA foreign_keys = ON")

    def execute(self, sql: str, params=None):
        if params is None:
            return self._conn.execute(sql)
        return self._conn.execute(sql, params)

    def cursor(self):
        return self._conn.cursor()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    @property
    def row_factory(self):
        return self._conn.row_factory

    @row_factory.setter
    def row_factory(self, value):
        self._conn.row_factory = value


class PgConnection:
    """Wraps a psycopg2 connection with a sqlite3-compatible interface.

    Uses DictCursor so rows support both row["col"] and row[0] access.
    """

    is_pg: bool = True

    def __init__(self, dsn: str):
        import psycopg2
        import psycopg2.extras
        self._conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.DictCursor)
        self._conn.autocommit = False
        try:
            from pgvector.psycopg2 import register_vector
            register_vector(self._conn)
        except ImportError:
            pass

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

_SQLITE_SCHEMA = {
    "papers_raw": """
        CREATE TABLE IF NOT EXISTS papers_raw (
            id TEXT PRIMARY KEY,
            title TEXT, authors TEXT, published TEXT, summary TEXT, link TEXT,
            categories TEXT, updated TEXT, pdf_url TEXT
        )
    """,
    "papers": """
        CREATE TABLE IF NOT EXISTS papers (
            id TEXT PRIMARY KEY REFERENCES papers_raw(id) ON DELETE CASCADE,
            title TEXT, authors TEXT, published TEXT, summary TEXT, link TEXT,
            kmeans_cluster INTEGER,
            ai_regex_hit INTEGER, ai_sem_sim REAL, ai_stage2_keep INTEGER,
            ai_stage2_reason TEXT, domain_tag TEXT,
            graph_x REAL, graph_y REAL
        )
    """,
    "embeddings": """
        CREATE TABLE IF NOT EXISTS embeddings (
            paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
            model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """,
    "cluster_meta": """
        CREATE TABLE IF NOT EXISTS cluster_meta (
            method TEXT NOT NULL, cluster_id INTEGER NOT NULL,
            label TEXT, confidence REAL, terms TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (method, cluster_id)
        )
    """,
}

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
        kmeans_cluster INTEGER,
        ai_regex_hit INTEGER, ai_sem_sim REAL, ai_stage2_keep BOOLEAN,
        ai_stage2_reason TEXT, domain_tag TEXT,
        graph_x REAL, graph_y REAL,
        embedding vector(768)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS cluster_meta (
        method TEXT NOT NULL, cluster_id INTEGER NOT NULL,
        label TEXT, confidence REAL, terms TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (method, cluster_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_papers_keep ON papers (ai_stage2_keep)",
    "CREATE INDEX IF NOT EXISTS idx_papers_cluster ON papers (kmeans_cluster)",
    "CREATE INDEX IF NOT EXISTS idx_papers_domain ON papers (domain_tag)",
]

_PG_VECTOR_INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_papers_embedding ON papers "
    "USING hnsw (embedding vector_cosine_ops)"
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def connect(db_arg: Optional[str] = None) -> SqliteConnection | PgConnection:
    """Return a connection to the configured backend.

    Uses DATABASE_URL env var for PostgreSQL; falls back to SQLite otherwise.
    db_arg overrides DATABASE_URL only when it looks like a DSN itself.
    """
    dsn = db_arg if (db_arg and db_arg.startswith(("postgresql://", "postgres://"))) \
        else DATABASE_URL
    if dsn:
        return PgConnection(dsn)
    return SqliteConnection(db_arg or DB_PATH)


def init_db(db_arg: Optional[str] = None) -> SqliteConnection | PgConnection:
    conn = connect(db_arg)
    if conn.is_pg:
        cur = conn.cursor()
        for stmt in _PG_SCHEMA:
            cur.execute(stmt)
        try:
            cur.execute(_PG_VECTOR_INDEX)
        except Exception:
            pass  # index may fail if embedding col is empty; ok
        conn.commit()
        _pg_ensure_columns(conn)
    else:
        cur = conn._conn.cursor()
        for ddl in _SQLITE_SCHEMA.values():
            cur.execute(ddl)
        conn._conn.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)")
        conn._conn.execute("CREATE INDEX IF NOT EXISTS idx_papers_domain_tag ON papers(domain_tag)")
        conn.commit()
        # Migrate existing DBs that lack the new columns
        _sqlite_ensure_columns(conn)
    return conn


def _pg_ensure_columns(conn: PgConnection) -> None:
    _ENSURE = [
        ("papers", "graph_x", "REAL"),
        ("papers", "graph_y", "REAL"),
    ]
    for table, col, dtype in _ENSURE:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {dtype}")
        except Exception:
            pass
    conn.commit()


def _sqlite_ensure_columns(conn: SqliteConnection) -> None:
    for coldef in ("graph_x REAL", "graph_y REAL"):
        try:
            conn._conn.execute(f"ALTER TABLE papers ADD COLUMN {coldef}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
