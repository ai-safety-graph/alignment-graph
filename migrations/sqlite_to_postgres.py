#!/usr/bin/env python3
"""
Migrate existing SQLite database to PostgreSQL + pgvector.

Usage:
    DATABASE_URL=postgresql://... python migrations/sqlite_to_postgres.py [--db path/to/arxiv_papers.db]

The script:
  1. Creates the PostgreSQL schema (idempotent)
  2. Migrates papers_raw, papers, embeddings → papers.embedding, cluster_meta
  3. Prints progress and final counts for verification
"""
from __future__ import annotations
import argparse, sqlite3, sys
from pathlib import Path

# Load .env before importing the package (so DATABASE_URL is set)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=False)
except ImportError:
    pass

# Add src to path so we can import the package
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import numpy as np
from aisafety_pipeline.db import PgConnection, init_db, SqliteConnection
from aisafety_pipeline.config import DB_PATH, DATABASE_URL

BATCH = 500


def _vec_from_bytes(blob: bytes, dim: int) -> list[float]:
    return np.frombuffer(blob, dtype=np.float32, count=dim).tolist()


def migrate(sqlite_path: str, pg_dsn: str, dry_run: bool = False, skip_raw: bool = False):
    print(f"Source: {sqlite_path}")
    print(f"Target: {pg_dsn[:40]}...")

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row

    pg_conn = PgConnection(pg_dsn)
    # Ensure schema exists
    print("Initialising PostgreSQL schema…")
    from aisafety_pipeline.db import _PG_SCHEMA, _PG_VECTOR_INDEX
    cur = pg_conn.cursor()
    for stmt in _PG_SCHEMA:
        cur.execute(stmt)
    try:
        cur.execute(_PG_VECTOR_INDEX)
    except Exception as e:
        print(f"  (vector index: {e})")
    pg_conn.commit()

    # ── papers_raw ──────────────────────────────────────────────────
    if skip_raw:
        print("\nSkipping papers_raw (--skip-raw).")
    else:
        print("\nMigrating papers_raw…")
    if not skip_raw:
        rows = sqlite_conn.execute(
            "SELECT id, title, authors, published, summary, link, categories, updated, pdf_url FROM papers_raw"
        ).fetchall()
        print(f"  {len(rows)} rows")
        if not dry_run:
            for i in range(0, len(rows), BATCH):
                batch = rows[i:i + BATCH]
                cur = pg_conn.cursor()
                for r in batch:
                    cur.execute(
                        """
                        INSERT INTO papers_raw (id, title, authors, published, summary, link, categories, updated, pdf_url)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          title=EXCLUDED.title, authors=EXCLUDED.authors, published=EXCLUDED.published,
                          summary=EXCLUDED.summary, link=EXCLUDED.link,
                          categories=EXCLUDED.categories, updated=EXCLUDED.updated, pdf_url=EXCLUDED.pdf_url
                        """,
                        (r["id"], r["title"], r["authors"], r["published"], r["summary"],
                         r["link"], r["categories"], r["updated"], r["pdf_url"]),
                    )
                pg_conn.commit()
                print(f"  … {min(i + BATCH, len(rows))} / {len(rows)}", end="\r")
            print()

    # ── papers ──────────────────────────────────────────────────────
    print("Migrating papers…")
    # Add graph_x/graph_y to SQLite if they don't exist yet
    for col in ("graph_x REAL", "graph_y REAL"):
        try:
            sqlite_conn.execute(f"ALTER TABLE papers ADD COLUMN {col}")
            sqlite_conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
    rows = sqlite_conn.execute("""
        SELECT id, title, authors, published, summary, link,
               kmeans_cluster, agg_cluster, hdbscan_cluster,
               ai_regex_hit, ai_sem_sim, ai_stage2_keep, ai_stage2_reason,
               domain_tag, graph_x, graph_y
        FROM papers
    """).fetchall()
    print(f"  {len(rows)} rows")
    if not dry_run:
        for i in range(0, len(rows), BATCH):
            batch = rows[i:i + BATCH]
            cur = pg_conn.cursor()
            for r in batch:
                cur.execute(
                    """
                    INSERT INTO papers (id, title, authors, published, summary, link,
                        kmeans_cluster, agg_cluster, hdbscan_cluster,
                        ai_regex_hit, ai_sem_sim, ai_stage2_keep, ai_stage2_reason,
                        domain_tag, graph_x, graph_y)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                        title=EXCLUDED.title, authors=EXCLUDED.authors,
                        published=EXCLUDED.published, summary=EXCLUDED.summary,
                        link=EXCLUDED.link,
                        kmeans_cluster=EXCLUDED.kmeans_cluster,
                        agg_cluster=EXCLUDED.agg_cluster,
                        hdbscan_cluster=EXCLUDED.hdbscan_cluster,
                        ai_regex_hit=EXCLUDED.ai_regex_hit,
                        ai_sem_sim=EXCLUDED.ai_sem_sim,
                        ai_stage2_keep=EXCLUDED.ai_stage2_keep,
                        ai_stage2_reason=EXCLUDED.ai_stage2_reason,
                        domain_tag=EXCLUDED.domain_tag,
                        graph_x=EXCLUDED.graph_x,
                        graph_y=EXCLUDED.graph_y
                    """,
                    (r["id"], r["title"], r["authors"], r["published"], r["summary"],
                     r["link"], r["kmeans_cluster"], r["agg_cluster"], r["hdbscan_cluster"],
                     r["ai_regex_hit"], r["ai_sem_sim"],
                     bool(r["ai_stage2_keep"]) if r["ai_stage2_keep"] is not None else None,
                     r["ai_stage2_reason"], r["domain_tag"],
                     r["graph_x"] if "graph_x" in r.keys() else None,
                     r["graph_y"] if "graph_y" in r.keys() else None),
                )
            pg_conn.commit()
            print(f"  … {min(i + BATCH, len(rows))} / {len(rows)}", end="\r")
        print()

    # ── embeddings → papers.embedding ────────────────────────────────
    print("Migrating embeddings → papers.embedding…")
    emb_rows = sqlite_conn.execute(
        "SELECT paper_id, dim, vector FROM embeddings WHERE model='specter2'"
    ).fetchall()
    print(f"  {len(emb_rows)} embeddings")
    if not dry_run:
        for i in range(0, len(emb_rows), BATCH):
            batch = emb_rows[i:i + BATCH]
            cur = pg_conn.cursor()
            for r in batch:
                vec = _vec_from_bytes(r["vector"], r["dim"])
                cur.execute(
                    "UPDATE papers SET embedding = %s WHERE id = %s",
                    (vec, r["paper_id"]),
                )
            pg_conn.commit()
            print(f"  … {min(i + BATCH, len(emb_rows))} / {len(emb_rows)}", end="\r")
        print()

    # ── cluster_meta ─────────────────────────────────────────────────
    print("Migrating cluster_meta…")
    cm_rows = sqlite_conn.execute(
        "SELECT method, cluster_id, label, confidence, terms FROM cluster_meta"
    ).fetchall()
    print(f"  {len(cm_rows)} rows")
    if not dry_run:
        cur = pg_conn.cursor()
        for r in cm_rows:
            cur.execute(
                """
                INSERT INTO cluster_meta (method, cluster_id, label, confidence, terms)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (method, cluster_id) DO UPDATE SET
                    label=EXCLUDED.label, confidence=EXCLUDED.confidence, terms=EXCLUDED.terms
                """,
                (r["method"], r["cluster_id"], r["label"], r["confidence"], r["terms"]),
            )
        pg_conn.commit()

    # ── Verification ─────────────────────────────────────────────────
    print("\n── Verification ──────────────────────────────────────────")
    for table in ("papers_raw", "papers", "cluster_meta"):
        sq = sqlite_conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        pg = pg_conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        status = "✓" if sq == pg else "✗ MISMATCH"
        print(f"  {table}: SQLite={sq}  PostgreSQL={pg}  {status}")

    sq_emb = sqlite_conn.execute("SELECT COUNT(*) FROM embeddings WHERE model='specter2'").fetchone()[0]
    pg_emb = pg_conn.execute("SELECT COUNT(*) FROM papers WHERE embedding IS NOT NULL").fetchone()[0]
    status = "✓" if sq_emb == pg_emb else "✗ MISMATCH"
    print(f"  embeddings: SQLite={sq_emb}  PostgreSQL={pg_emb}  {status}")

    sqlite_conn.close()
    pg_conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Migrate SQLite → PostgreSQL")
    ap.add_argument("--db", default=DB_PATH, help="Path to SQLite database")
    ap.add_argument("--dsn", default=DATABASE_URL, help="PostgreSQL DSN (overrides DATABASE_URL)")
    ap.add_argument("--dry-run", action="store_true", help="Count rows without writing")
    ap.add_argument("--skip-raw", action="store_true", help="Skip papers_raw (already migrated)")
    args = ap.parse_args()

    if not args.dsn:
        sys.exit("ERROR: Set DATABASE_URL env var or pass --dsn postgresql://...")

    migrate(args.db, args.dsn, dry_run=args.dry_run, skip_raw=args.skip_raw)
