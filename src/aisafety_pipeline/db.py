from __future__ import annotations
import sqlite3
from .config import DB_PATH

SCHEMA = {
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
            agg_cluster INTEGER,
            hdbscan_cluster INTEGER,
            ai_regex_hit INTEGER,
            ai_sem_sim REAL,
            ai_stage2_keep INTEGER,
            ai_stage2_reason TEXT,
            domain_tag TEXT
        )
    """,
    "embeddings": """
        CREATE TABLE IF NOT EXISTS embeddings (
            paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            dim INTEGER NOT NULL,
            vector BLOB NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """,
    "cluster_meta": """
        CREATE TABLE IF NOT EXISTS cluster_meta (
            method TEXT NOT NULL,
            cluster_id INTEGER NOT NULL,
            label TEXT,
            confidence REAL,
            terms TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (method, cluster_id)
        )
    """,
}


def connect(db_path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path or DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: str | None = None) -> sqlite3.Connection:
    conn = connect(db_path)
    cur = conn.cursor()
    for ddl in SCHEMA.values():
        cur.execute(ddl)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_papers_domain_tag ON papers(domain_tag)")
    conn.commit()
    return conn