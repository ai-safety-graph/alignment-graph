from __future__ import annotations
import argparse, datetime as dt, json, os
from pathlib import Path
from typing import Optional
from .config import GREEN, YELLOW, BLUE, RESET, API_HOST, API_PORT
from . import oai, filters, embeddings, clustering, labeling, compute_layout, config


def iso_date(d: dt.date) -> str: return d.strftime("%Y-%m-%d")

def today_iso() -> str: return iso_date(dt.date.today())


# ---------------- CLI -----------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Staged arXiv AI-safety pipeline")
    sp = ap.add_subparsers(dest="cmd", required=True)

    idb = sp.add_parser("init-db", help="Create/upgrade the PostgreSQL schema (tables, extensions, indexes)")
    idb.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    idb.set_defaults(func=_cmd_init_db)

    a = sp.add_parser("harvest", help="OAI-PMH harvest into papers_raw")
    a.add_argument("--from", dest="from_date", help="YYYY-MM-DD")
    a.add_argument("--until", dest="until_date", help="YYYY-MM-DD")
    a.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    a.add_argument("--state-file", default=config.STATE_FILE)
    a.set_defaults(func=oai.cmd_harvest)

    b = sp.add_parser("stage1", help="Regex/keyword gate into papers")
    b.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    b.add_argument("--keep-all-and-filter", action="store_true",
                   help="Copy all raw papers into `papers` (mark ai_regex_hit accordingly)")
    b.set_defaults(func=filters.cmd_stage1)

    c = sp.add_parser("embed", help="Ensure Specter2 embeddings for candidates")
    c.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    c.add_argument("--device", default="auto",
                   help="auto|cpu|mps|cuda|cuda:N (e.g. cuda:0)")
    c.add_argument("--batch-size", type=int, default=32, dest="batch_size",
                   help="Encoding batch size (raise this on GPU, e.g. 256, for much better throughput)")
    c.set_defaults(func=embeddings.cmd_embed)

    d = sp.add_parser("filter", help="Stage-2 semantic filter")
    d.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    d.add_argument("--method", choices=["centroid", "logreg"], default="centroid")
    d.add_argument("--seeds", help="Path to seeds.txt (one arXiv id/url per line)")
    d.add_argument("--labels", help="labels.csv with columns: id,label (0/1)")
    d.add_argument("--tau", type=float, default=0.38, help="Threshold on sim/proba")
    d.set_defaults(func=filters.cmd_filter)

    e = sp.add_parser("cluster", help="Cluster only kept papers")
    e.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    e.add_argument("--kmeans", type=int, default=8)
    e.add_argument("--reduce-dim", type=int, default=None)
    e.add_argument("--device", default="auto")
    e.set_defaults(func=clustering.cmd_cluster)

    cl = sp.add_parser("compute-layout", help="Compute 2D layout coordinates and persist graph_x/y to Postgres")
    cl.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    cl.add_argument("--coords", choices=["umap", "pca", "none"], default="umap")
    cl.add_argument("--umap-n-neighbors", type=int, default=15)
    cl.add_argument("--umap-min-dist", type=float, default=0.10)
    cl.add_argument("--umap-rand", type=int, default=42)
    cl.add_argument("--pca-rand", type=int, default=42)
    cl.add_argument("--canvas-w", type=int, default=1000)
    cl.add_argument("--canvas-h", type=int, default=700)
    cl.add_argument("--canvas-pad", type=int, default=24)
    cl.set_defaults(func=compute_layout.cmd_compute_layout)

    g = sp.add_parser("label", help="Auto-label clusters against a fixed topic taxonomy (see taxonomy.py)")
    g.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    g.add_argument("--topk", type=int, default=4)
    g.add_argument("--extra", type=str, default=None, help="Comma-separated extra candidate topics, on top of taxonomy.TAXONOMY")
    g.set_defaults(func=labeling.cmd_label)

    srv = sp.add_parser("serve", help="Start the FastAPI server (requires DATABASE_URL)")
    srv.add_argument("--host", default=API_HOST)
    srv.add_argument("--port", type=int, default=API_PORT)
    srv.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    srv.set_defaults(func=_cmd_serve)

    return ap


def _cmd_init_db(args):
    from .db import init_db
    conn = init_db(args.db)
    conn.close()
    print(f"{GREEN}init-db:{RESET} schema ready.")


def _cmd_serve(args):
    import uvicorn
    uvicorn.run(
        "aisafety_pipeline.api.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


def cli_entry():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)