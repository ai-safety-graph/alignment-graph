from __future__ import annotations

import argparse
import datetime as dt

from . import compute_layout, config, embeddings, filters, llm_classify, oai
from .config import API_HOST, API_PORT, BLUE, GREEN, RED, RESET, YELLOW


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

    c = sp.add_parser("embed", help="Ensure Specter2 embeddings for candidates (used for /api/papers/related)")
    c.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    c.add_argument("--device", default="auto",
                   help="auto|cpu|mps|cuda|cuda:N (e.g. cuda:0)")
    c.add_argument("--batch-size", type=int, default=32, dest="batch_size",
                   help="Encoding batch size (raise this on GPU, e.g. 256, for much better throughput)")
    c.set_defaults(func=embeddings.cmd_embed)

    ct = sp.add_parser("embed-topic", help="Ensure BGE topic embeddings for candidates (used for search/compute-layout)")
    ct.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    ct.add_argument("--device", default="auto",
                    help="auto|cpu|mps|cuda|cuda:N (e.g. cuda:0)")
    ct.add_argument("--batch-size", type=int, default=32, dest="batch_size",
                    help="Encoding batch size (raise this on GPU, e.g. 256, for much better throughput)")
    ct.set_defaults(func=embeddings.cmd_embed_topic)

    d = sp.add_parser("filter", help="Stage-2 semantic filter")
    d.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    d.add_argument("--method", choices=["centroid", "centroid-multi", "logreg"], default="centroid")
    d.add_argument("--seeds", help="Path to seeds.txt (one arXiv id/url per line)")
    d.add_argument("--seeds-subtopics", dest="seeds_subtopics",
                    help="Path to seeds_subtopics.tsv (arxiv_id, subtopic, ...) for --method centroid-multi "
                         "(default: seeds_subtopics.tsv)")
    d.add_argument("--labels", help="labels.csv with columns: id,label (0/1)")
    d.add_argument("--tau", type=float, default=0.38,
                    help="Threshold on sim/proba (centroid: raw cosine; centroid-multi: z-score, "
                         "not directly comparable to the centroid method's tau)")
    d.set_defaults(func=filters.cmd_filter)

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

    lc = sp.add_parser("llm-classify", help="LLM-based combined relevance + taxonomy classification (post stage-2)")
    lc.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    lc.add_argument("--model", default=config.LLM_MODEL, help="OpenAI model name/id")
    lc.add_argument("--limit", type=int, default=None, help="Max papers to classify this run")
    lc.add_argument("--dry-run", action="store_true", dest="dry_run",
                     help="Call the LLM and print results, but do not write to the DB")
    lc.add_argument("--force", action="store_true",
                     help="Re-classify papers that already have llm_classified_at set")
    lc.set_defaults(func=llm_classify.cmd_llm_classify)

    lcs = sp.add_parser("llm-classify-submit",
                         help="Submit an OpenAI Batch API job for post-stage-2 LLM classification "
                              "(cheaper + much faster at scale than `llm-classify`, results ready within 24h)")
    lcs.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    lcs.add_argument("--model", default=config.LLM_MODEL, help="OpenAI model name/id")
    lcs.add_argument("--limit", type=int, default=None,
                      help="Max papers to include in this batch, before the file-size/enqueued-token "
                           "caps (whichever binds first) trim it further")
    lcs.add_argument("--dry-run", action="store_true", dest="dry_run",
                      help="Preview the batch (count + first request) without submitting or writing to the DB")
    lcs.add_argument("--force", action="store_true",
                      help="Include papers that already have llm_classified_at or llm_batch_id set")
    lcs.add_argument("--allow-concurrent", action="store_true", dest="allow_concurrent",
                      help="Submit even if other tracked batches are still processing (OpenAI enforces "
                           "an org-wide enqueued-token cap per model; skip this check only if you've "
                           "confirmed there's headroom)")
    lcs.set_defaults(func=llm_classify.cmd_llm_classify_submit)

    lcc = sp.add_parser("llm-classify-collect",
                         help="Check status of / collect results from submitted llm-classify-submit batch job(s)")
    lcc.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    lcc.add_argument("--batch-id", default=None, dest="batch_id",
                      help="Collect a specific batch id; default: every tracked, not-yet-collected batch")
    lcc.add_argument("--dry-run", action="store_true", dest="dry_run",
                      help="Report status/results without writing to the DB")
    lcc.add_argument("--wait", action="store_true",
                      help="Poll until each batch reaches a terminal status instead of checking once")
    lcc.add_argument("--poll-interval", type=int, default=60, dest="poll_interval",
                      help="Seconds between polls when --wait is set")
    lcc.set_defaults(func=llm_classify.cmd_llm_classify_collect)

    lcr = sp.add_parser("llm-classify-run",
                         help="Submit + wait + collect in a loop until the whole corpus is classified "
                              "(one batch at a time, respecting OpenAI's org-wide enqueued-token cap)")
    lcr.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    lcr.add_argument("--model", default=config.LLM_MODEL, help="OpenAI model name/id")
    lcr.add_argument("--force", action="store_true",
                      help="Include papers that already have llm_classified_at set")
    lcr.add_argument("--poll-interval", type=int, default=60, dest="poll_interval",
                      help="Seconds between status polls while waiting for each batch")
    lcr.set_defaults(func=llm_classify.cmd_llm_classify_run)

    srv = sp.add_parser("serve", help="Start the FastAPI server (requires DATABASE_URL)")
    srv.add_argument("--host", default=API_HOST)
    srv.add_argument("--port", type=int, default=API_PORT)
    srv.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    srv.set_defaults(func=_cmd_serve)

    ra = sp.add_parser(
        "run-all",
        help="Chain harvest -> stage1 -> embed -> filter -> embed-topic -> llm-classify-run -> "
             "compute-layout in order, for unattended/cron use",
    )
    ra.add_argument("--db", default=None, help="PostgreSQL DSN (postgresql://...); defaults to $DATABASE_URL")
    ra.add_argument("--seeds", default="seeds.txt", help="Path to seeds.txt for the stage-2 filter")
    ra.add_argument("--tau", type=float, default=0.92, help="Stage-2 filter threshold")
    ra.add_argument("--filter-method", dest="filter_method", choices=["centroid", "centroid-multi", "logreg"],
                     default="centroid")
    ra.add_argument("--device", default="auto", help="auto|cpu|mps|cuda|cuda:N (embed / embed-topic)")
    ra.add_argument("--coords", choices=["umap", "pca", "none"], default="umap")
    ra.add_argument("--skip", action="append", default=[], choices=_RUN_ALL_STAGE_NAMES,
                     help="Skip a stage (repeatable) -- for manual recovery/debugging, not normal cron use")
    ra.set_defaults(func=_cmd_run_all)

    return ap


def _cmd_init_db(args):
    from .db import init_db
    conn = init_db(args.db)
    conn.close()
    print(f"{GREEN}init-db:{RESET} schema ready.")


# Fixed pipeline order for `run-all`. embed-topic runs *after* filter --
# it only embeds ai_stage2_keep=TRUE rows (see embeddings.py's
# ensure_topic_embeddings_for_candidates docstring), and compute-layout
# requires topic embeddings on every kept row or it raises. Running these
# out of order was the actual cause of "layout failures occur late"
# (compute-layout hard-failing on newly-kept papers with no topic vector
# yet) -- see ARCHITECTURE.md.
_RUN_ALL_STAGES = [
    ("harvest", oai.cmd_harvest),
    ("stage1", filters.cmd_stage1),
    ("embed", embeddings.cmd_embed),
    ("filter", filters.cmd_filter),
    ("embed-topic", embeddings.cmd_embed_topic),
    ("llm-classify", llm_classify.cmd_llm_classify_run),
    ("compute-layout", compute_layout.cmd_compute_layout),
]
_RUN_ALL_STAGE_NAMES = [name for name, _ in _RUN_ALL_STAGES]


def _cmd_run_all(args) -> None:
    """Chain every pipeline stage in the order above, for unattended/cron
    use. Stops immediately on the first stage failure (non-zero exit) --
    running a later stage after e.g. a failed embed-topic would just
    reproduce the compute-layout crash this ordering already fixes."""
    ns = argparse.Namespace(
        db=args.db,
        # harvest
        from_date=None, until_date=None, state_file=config.STATE_FILE,
        # stage1
        keep_all_and_filter=False,
        # embed / embed-topic
        device=args.device, batch_size=32,
        # filter
        method=args.filter_method, seeds=args.seeds, seeds_subtopics=None, labels=None, tau=args.tau,
        # llm-classify-run
        model=config.LLM_MODEL, force=False, poll_interval=60,
        # compute-layout
        coords=args.coords, umap_n_neighbors=15, umap_min_dist=0.10, umap_rand=42, pca_rand=42,
        canvas_w=1000, canvas_h=700, canvas_pad=24,
    )

    for name, fn in _RUN_ALL_STAGES:
        if name in args.skip:
            print(f"{YELLOW}run-all:{RESET} skipping {name} (--skip)")
            continue
        print(f"{BLUE}run-all:{RESET} starting {name}...")
        try:
            fn(ns)
        except Exception as exc:
            print(f"{RED}run-all: FAILED at stage {name}:{RESET} {exc}")
            raise

    print(f"{GREEN}run-all: complete{RESET}")


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