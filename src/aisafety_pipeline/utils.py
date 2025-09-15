from __future__ import annotations
import argparse, datetime as dt, re, json, os
from pathlib import Path
from typing import Optional
from .config import GREEN, YELLOW, BLUE, RESET
from . import oai, filters, embeddings, clustering, labeling, export_graph, export_summaries

# Labeling helpers (shared)
GENERIC_LABEL_STOPLIST = {
    "artificial", "intelligence", "language",
    "agent", "agents",
    "model", "models",
    "system", "systems",
    "approach", "method", "task", "dataset",
    "framework", "paper", "study"
}
_LABEL_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def is_generic_phrase(phrase: str) -> bool:
    toks = _LABEL_TOKEN_RE.findall((phrase or "").lower())
    if not toks:
        return True
    norm = [t[:-1] if t.endswith("s") and len(t) > 3 else t for t in toks]
    if len(norm) == 1 and norm[0] in GENERIC_LABEL_STOPLIST:
        return True
    if all(t in GENERIC_LABEL_STOPLIST for t in norm):
        return True
    return False


def iso_date(d: dt.date) -> str: return d.strftime("%Y-%m-%d")

def today_iso() -> str: return iso_date(dt.date.today())


# ---------------- CLI -----------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Staged arXiv AI-safety pipeline")
    sp = ap.add_subparsers(dest="cmd", required=True)

    a = sp.add_parser("harvest", help="OAI-PMH harvest into papers_raw")
    a.add_argument("--from", dest="from_date", help="YYYY-MM-DD")
    a.add_argument("--until", dest="until_date", help="YYYY-MM-DD")
    a.add_argument("--db", default=oai.DB_PATH)
    a.add_argument("--state-file", default=oai.STATE_FILE)
    a.set_defaults(func=oai.cmd_harvest)

    b = sp.add_parser("stage1", help="Regex/keyword gate into papers")
    b.add_argument("--db", default=filters.DB_PATH)
    b.add_argument("--keep-all-and-filter", action="store_true",
                   help="Copy all raw papers into `papers` (mark ai_regex_hit accordingly)")
    b.set_defaults(func=filters.cmd_stage1)

    c = sp.add_parser("embed", help="Ensure Specter2 embeddings for candidates")
    c.add_argument("--db", default=embeddings.DB_PATH)
    c.add_argument("--device", default="auto",
                   help="auto|cpu|mps|cuda|cuda:N (e.g. cuda:0)")
    c.set_defaults(func=embeddings.cmd_embed)

    d = sp.add_parser("filter", help="Stage-2 semantic filter")
    d.add_argument("--db", default=filters.DB_PATH)
    d.add_argument("--method", choices=["centroid", "logreg"], default="centroid")
    d.add_argument("--seeds", help="Path to seeds.txt (one arXiv id/url per line)")
    d.add_argument("--labels", help="labels.csv with columns: id,label (0/1)")
    d.add_argument("--tau", type=float, default=0.38, help="Threshold on sim/proba")
    d.set_defaults(func=filters.cmd_filter)

    e = sp.add_parser("cluster", help="Cluster only kept papers")
    e.add_argument("--db", default=clustering.DB_PATH)
    e.add_argument("--kmeans", type=int, default=8)
    e.add_argument("--agg", type=int, default=8)
    e.add_argument("--hdbscan-min", type=int, default=5)
    e.add_argument("--reduce-dim", type=int, default=None)
    e.add_argument("--device", default="auto")
    e.set_defaults(func=clustering.cmd_cluster)

    fg = sp.add_parser("export-graph", help="Export nodes/links JSON for react-force-graph-2d")
    fg.add_argument("--db", default=export_graph.DB_PATH)
    fg.add_argument("--out", required=True)
    fg.add_argument("--top-k", type=int, default=5)
    fg.add_argument("--min-sim", type=float, default=0.85)
    fg.add_argument("--same-cluster-only", action="store_true")
    fg.add_argument("--no-mst", action="store_true")
    fg.add_argument("--coords", choices=["umap","pca","none","fr"], default="fr")
    fg.add_argument("--umap-n-neighbors", type=int, default=15)
    fg.add_argument("--umap-min-dist", type=float, default=0.10)
    fg.add_argument("--umap-rand", type=int, default=42)
    fg.add_argument("--pca-rand", type=int, default=42)
    fg.add_argument("--canvas-w", type=int, default=1000)
    fg.add_argument("--canvas-h", type=int, default=700)
    fg.add_argument("--canvas-pad", type=int, default=24)
    fg.add_argument("--include-summaries", action="store_true")
    fg.add_argument("--max-summary-len", type=int, default=400)
    fg.add_argument("--verbose", action="store_true")
    fg.add_argument("--gzip", action="store_true")
    fg.set_defaults(func=export_graph.cmd_export_graph)

    g = sp.add_parser("label", help="Auto-label clusters (default recipe)")
    g.add_argument("--db", default=labeling.DB_PATH)
    g.add_argument("--topk", type=int, default=4)
    g.add_argument("--min-df", type=int, default=3)
    g.add_argument("--max-df", type=float, default=0.6)
    g.add_argument("--extra", type=str, default=None)
    g.set_defaults(func=labeling.cmd_label)

    es = sp.add_parser("export-summaries", help="Export a separate summaries JSON")
    es.add_argument("--db", default=export_summaries.DB_PATH)
    es.add_argument("--out", required=True)
    es.add_argument("--ids")
    es.add_argument("--only-ids", action="store_true")
    es.add_argument("--only-clustered", action="store_true")
    es.add_argument("--no-meta", action="store_true")
    es.add_argument("--no-domain", action="store_true")
    es.add_argument("--no-cid", action="store_true")
    es.add_argument("--trim", action="store_true")
    es.add_argument("--max-summary-len", type=int, default=1000)
    es.add_argument("--gzip", action="store_true")
    es.set_defaults(func=export_summaries.cmd_export_summaries)

    return ap


def cli_entry():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)