# Repository Architecture

## Purpose

This repository builds an AI-safety literature exploration system with two major parts:

1. A **Python pipeline** that harvests arXiv metadata, stores it in PostgreSQL, computes embeddings, filters papers, tags them against a fixed topic taxonomy (`taxonomy.py`) with an LLM, derives peer-review status, computes a 2-D graph layout, and precomputes related papers.
2. A **React/Vite UI** that loads all data from a live FastAPI backend.

The active and only supported deployment mode is **API mode**: pipeline → PostgreSQL + pgvector → FastAPI → frontend. See top-level `CLAUDE.md`.

The legacy static-JSON export path has been removed from the pipeline. It now persists everything — including graph layout coordinates — to PostgreSQL, and the FastAPI backend is the sole data source for the frontend.

---

## High-Level Data Flow

```text
arXiv OAI-PMH
  -> papers_raw (PostgreSQL)
  -> papers (stage-1 regex survivors; working set)
  -> SPECTER2 embeddings (papers.embedding, vector(768))
  -> stage-2 semantic keep / reject decisions (ai_stage2_keep)
  -> LLM relevance + taxonomy classification (llm_relevant, llm_tags)
  -> peer-review status (peer_reviewed, venue, venue_type) from arXiv fields, then OpenAlex
  -> BGE topic embeddings (papers.embedding_topic, vector(768)) for relevant papers
  -> graph coords (graph_x, graph_y on papers)
  -> related papers (paper_related, SPECTER2 nearest neighbours)
  -> FastAPI backend                -> React frontend
```

The API is gated on `llm_relevant`/`llm_tags` (written by `llm_classify.py`) — see Key Invariants below.

Canonical CLI workflow:

```bash
aisafety-pipeline harvest
aisafety-pipeline stage1
aisafety-pipeline embed
aisafety-pipeline filter
aisafety-pipeline llm-classify-run   # LLM relevance + taxonomy classification, live tag source
aisafety-pipeline venue              # peer-review status from arXiv journal-ref/DOI/comments
aisafety-pipeline venue-enrich       # fills unknowns from OpenAlex, rechecks recent ones monthly
aisafety-pipeline embed-topic        # BGE topic embeddings (needed by compute-layout and semantic search)
aisafety-pipeline compute-layout     # persists graph_x/y to DB
aisafety-pipeline compute-related    # precomputes related papers into paper_related
aisafety-pipeline serve              # start FastAPI
```

`aisafety-pipeline run-all` chains every stage above (except `serve`) in this order, stopping at the first failure; it is what the scheduled Railway cron job runs. The exception is `venue-enrich`, whose OpenAlex errors never stop the run (a permanent one makes `run-all` exit non-zero after the last stage). All stages are incremental by default — they only process rows that are new or missing their output (see `src/aisafety_pipeline/ARCHITECTURE.md`).

---

## Major Subsystems

### `src/aisafety_pipeline/`

Primary backend package. Owns:

- arXiv/OAI harvesting
- Persistence (PostgreSQL + pgvector via `PgConnection`)
- Embedding generation and storage
- Filtering (stage-1 regex + stage-2 semantic seed-centroid filter)
- LLM-based relevance + multi-label taxonomy classification (via OpenAI, sync or Batch API) — the live tag source
- Peer-review status and venue (`venue.py`): rules over arXiv journal-ref/DOI/comments, then OpenAlex lookups for papers left unknown
- Graph layout computation (incremental kNN placement by default; full UMAP/PCA refit with `--full`) and coordinate persistence to PostgreSQL
- Related-paper precomputation (`related.py`): top-20 SPECTER2 neighbours per relevant paper into `paper_related`
- Pipeline state in the `pipeline_state` table (harvest/stage-1/venue watermarks, in-flight LLM batches, related-papers input fingerprint, latest-batch summary)

See `src/aisafety_pipeline/ARCHITECTURE.md` for module-level details.

### `src/aisafety_pipeline/api/`

FastAPI backend. Owns:

- REST API serving live data from PostgreSQL
- Paginated paper listing with server-side filtering (keyword, date, multi-value tags and domain) and single paper detail
- Graph building on demand, by paper ids (`POST /api/graph/subset`) or by date range (`GET /api/graph/range`)
- Related papers from the precomputed `paper_related` table, falling back to a live pgvector HNSW search over SPECTER2 embeddings for papers not yet precomputed (`GET /api/papers/related`)
- Semantic search via pgvector ANN over BGE topic embeddings (`POST /api/search`; disabled unless `ENABLE_SEMANTIC_SEARCH=true`)
- Author-name suggestions for the graph-recipe author filter (`GET /api/authors`)
- Tag catalog (`GET /api/tags`) and latest-batch / coverage metadata (`GET /api/batch/latest`, `GET /api/batch/coverage`)
- Per-IP rate limiting, cookieless search logging, and CORS for the Netlify frontend

See `src/aisafety_pipeline/api/ARCHITECTURE.md` for route-level details.

### `ui/`

Frontend application built with Vite/React. Owns:

- Choosing desktop (`GraphView`) vs mobile (`BrowseView`) rendering at `/`; `/browse` always renders `BrowseView` (`/stats` redirects there); `/about` renders `AboutView`
- Desktop graph rendering: the last month of papers by default (`GET /api/graph/range`) or a saved graph (`POST /api/graph/subset`), with keyword/semantic search and ghost nodes
- Saved graphs (user-curated paper sets) kept in browser `localStorage`
- Server-side filtered, paginated paper browsing for the list view (`GET /api/papers`)
- Related papers fetched per paper selection (`GET /api/papers/related`)
- Cookieless product analytics via Umami Cloud (`ui/src/lib/analytics.ts`), loaded only in production builds when `VITE_UMAMI_WEBSITE_ID` is set

See `ui/ARCHITECTURE.md` for frontend details.

### `migrations/`

One-off SQL files, run manually (e.g. in the Supabase SQL editor). The schema itself is owned by `init_db()` in `db.py`, which is idempotent and applies additive changes on every run.

- `enable_rls.sql`: enables row-level security (no policies) on all tables so Supabase's REST roles can't read them; the backend's `postgres` role bypasses RLS.
- `add_search_log.sql`: creates the `search_log` analytics table for databases created before `init_db()` did so, and enables RLS on it.
- `drop_paper_tags.sql`: drops the legacy zero-shot `paper_tags` table.
- `drop_cluster_columns.sql`: drops the legacy `agg_cluster` / `hdbscan_cluster` columns from `papers`.
- `add_arxiv_venue_fields.sql`, `add_peer_review_columns.sql`, `add_openalex_checked_at.sql`: the peer-review columns on `papers_raw` (`journal_ref`, `doi`, `comments`) and `papers` (`peer_reviewed`, `venue`, …, `openalex_checked_at`).
- `add_recipe_trigram_indexes.sql`, `add_related_input_index.sql`, `add_relevant_published_index.sql`, `add_unclassified_index.sql`: indexes for existing databases, mirroring `init_db()`.

### `data/`

Local-only runtime artifacts (git-ignored). Cross-run state lives in the `pipeline_state` table, which is authoritative:

- `last_run.txt`: best-effort local mirror of the harvest watermark (`AIS_STATE_FILE`)
- `harvest_chunk*.txt`: checkpoints for `scripts/run_harvest_chunked.py` backfills

### `archive/`

Historical and deprecated pipeline code (git-ignored, local only). Reference material only, not active production code.

---

## Supported Execution Model

The public orchestration surface is defined in `src/aisafety_pipeline/utils.py`:

- `init-db` — create/upgrade the schema (extensions, tables, indexes)
- `harvest` — OAI-PMH fetch into `papers_raw`
- `stage1` — regex filter into `papers`
- `embed` — SPECTER2 embeddings (`papers.embedding`)
- `filter` — semantic stage-2 filter (cosine similarity to the `seeds.txt` centroid, `--tau`)
- `llm-classify` / `llm-classify-submit` / `llm-classify-collect` / `llm-classify-run` — LLM relevance + taxonomy classification into `llm_relevant`/`llm_tags` (the live tag source; `llm-classify-run` is the recommended production command — submits, waits, and collects Batch API jobs until the corpus is classified)
- `venue` — peer-review status (`peer_reviewed`, `venue`, `venue_type`) for LLM-relevant papers, derived from arXiv journal-ref/DOI/comments (`--full` re-derives after rule changes)
- `venue-enrich` — looks up papers `venue` left unknown in OpenAlex for a published version; rechecks recent ones monthly (`--limit`, default `OPENALEX_MAX_PER_RUN`)
- `embed-topic` — BGE topic embeddings (`papers.embedding_topic`) for LLM-relevant papers
- `compute-layout` — persists `graph_x/y` to DB (incremental kNN placement; `--full` refits UMAP/PCA)
- `compute-related` — precomputes SPECTER2 neighbours into `paper_related` (skipped when its input is unchanged; `--force` after re-embedding)
- `run-all` — harvest → stage1 → embed → filter → llm-classify (via `llm-classify-run`) → venue → venue-enrich → embed-topic → compute-layout → compute-related, for the scheduled job (not `init-db` or the other `llm-classify-*` commands; `--skip <stage>` to omit stages by those names); records a latest-batch summary in `pipeline_state`
- `serve` — start FastAPI with uvicorn (`--host`, `--port`, `--reload`; defaults from `API_HOST`/`API_PORT`)

Ad-hoc tooling (backfills, eval-set builders, filter/classifier evaluation, mojibake repair, the search-log report query) lives in `scripts/` and is not part of the scheduled pipeline.

---

## Database Backend

### PostgreSQL + pgvector (only supported backend)

Tables:

- `papers_raw` — every harvested record (includes `harvested_at`, the stage-1/venue watermark column, and arXiv's `journal_ref`/`doi`/`comments`)
- `papers` — stage-1 survivors and all pipeline outputs: `embedding vector(768)` (SPECTER2), `embedding_topic vector(768)` (BGE), stage-2 columns, the LLM classification columns `llm_relevant`/`llm_tags`/etc., the peer-review columns `peer_reviewed`/`venue`/`venue_type`/etc., and `graph_x`/`graph_y`
- `paper_related` — precomputed related papers (neighbour ids + sims per relevant paper), written by `compute-related`
- `pipeline_state` — key/JSON-value store: `harvest_watermark`, `stage1_watermark`, `venue_watermark`, `llm_batches` (in-flight Batch API jobs), `related_fingerprint` (compute-related's last input), `latest_batch` (shown in the UI)
- `search_log` — cookieless search analytics written by the API

Requires the `DATABASE_URL` env var to be set to a valid PostgreSQL DSN — `db.connect()` raises `RuntimeError` otherwise. Vector search uses two partial HNSW indexes (`vector_cosine_ops`), one on `embedding` and one on `embedding_topic`, both restricted to `llm_relevant` rows. Run `aisafety-pipeline init-db` (or `harvest`, which calls `init_db()` itself) against a fresh database to create tables/extensions; the other stages assume the schema exists.

---

## Deployment Model

| Component             | Service          | Notes                                                                 |
| --------------------- | ---------------- | --------------------------------------------------------------------- |
| PostgreSQL + pgvector | Supabase         | Native pgvector, connection pooling; RLS enabled via `migrations/enable_rls.sql` |
| FastAPI API           | Railway          | `Dockerfile` — runs uvicorn directly on Railway's `$PORT`; `DATABASE_URL` required; no pipeline extras installed, so semantic search is off |
| Pipeline cron         | Railway          | `Dockerfile.pipeline` — runs `aisafety-pipeline run-all` (CPU torch); schedule and `RAILWAY_DOCKERFILE_PATH` set in the Railway dashboard |
| Frontend              | Netlify          | `netlify.toml` (base `ui/`); `VITE_API_URL` set to the API URL via Netlify's env vars |

CI (`.github/workflows/ci.yml`) runs ruff, pytest against a pgvector service container, and the UI lint/test/build.

---

## Important Assumptions

### Canonical paper identity

Paper ids are canonical arXiv abs URLs, e.g. `https://arxiv.org/abs/2401.01234`. This is the join key across all tables. `arxiv_ids.normalize_arxiv_id_or_url()` turns bare ids and other arXiv URL forms into this canonical form.

### Reproducibility of stage-2 filtering

`seeds.txt` is tied to a specific harvest window. To reproduce prior filtering, the harvest window and seed set must match.

---

## Safe Edit Zones

AI may safely modify:

- Documentation
- UI rendering logic
- API response formatting (coordinated with UI)
- Pipeline internal helpers
- CLI help text

AI should be careful around:

- PostgreSQL schema changes
- Paper id normalization
- Compact graph field names (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `tags`, `pr`, `vn`)
- pgvector operator syntax (`<=>`)

---

## Cross-Subsystem Risks

1. **Identifier mismatch**: arXiv abs URL format must remain stable across pipeline and UI. The frontend assigns ephemeral numeric `id` values by index; `aid` (the arXiv URL) is the durable key.
2. **Layout staleness**: `graph_x`/`graph_y` only reflect the last `compute-layout` run — new papers added to `papers` after that (via later harvest/filter runs) have no coords until `compute-layout` runs again.
3. **API dependency in UI**: every view fetches from the API. With `VITE_API_URL` unset, `api.ts` falls back to same-origin relative paths, which only works behind a proxy — in practice it must be set.
4. **Related-papers staleness**: `paper_related` only reflects the last `compute-related` run. Papers newer than that have no stored row and are served by the live HNSW fallback, while existing papers' stored neighbour lists won't include those newer papers until `compute-related` runs again.
5. **Two embedding spaces**: related papers and stage-2 filtering use SPECTER2 (`embedding`); semantic search and the layout use BGE (`embedding_topic`). Papers without `embedding_topic` (e.g. `embed-topic` not yet run) are absent from search and get no coordinates.
6. **Graph coordinate alignment**: the desktop graph places search/related "ghost" nodes by re-applying the loaded subset's normalisation to each paper's raw coords. This is a contract spanning `graph.py`/`papers.py` (which expose `meta.coords.bounds` and raw `rx`/`ry`) and `GraphView.tsx`'s `ghostCoord()` (which mirrors the canvas-mapping formula in `graph.py`'s `_graph_from_rows`). Changing the normalisation on either side without the other misplaces ghost nodes.

---

## Recommended Mental Model

When editing this repository, treat it as four layers:

1. **Ingest and analysis** (`src/aisafety_pipeline/` pipeline modules)
2. **Persistence** (`db.py` — PostgreSQL)
3. **Serving contract** (API routes)
4. **Presentation** (`ui/`)

Most safe changes stay within a layer. Cross-layer changes should be intentional and documented.
