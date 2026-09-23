# `aisafety_pipeline` Architecture

## Purpose

`src/aisafety_pipeline/` is the backend package that turns raw arXiv metadata into a filtered, topic-tagged dataset served live via FastAPI.

Its core job is to manage a staged literature-processing pipeline:

```text
harvest -> stage1 -> embed -> filter -> embed-topic -> llm-classify(-run) -> compute-layout -> serve
```

The package is PostgreSQL + pgvector only — every pipeline command and the API require `DATABASE_URL` to be set.

---

## Module Map

### `config.py`

Central configuration:

- `DATABASE_URL` — PostgreSQL DSN (required by every pipeline command and the API)
- `API_HOST`, `API_PORT`, `API_CORS_ORIGINS`
- Embedding model metadata, OAI-PMH settings, logging colors

### `db.py`

Owns database connection setup and schema initialization.

Key exports:

- `connect(db_arg)` — returns a `PgConnection`; raises `RuntimeError` if neither `db_arg` (a `postgresql://`/`postgres://` DSN) nor `DATABASE_URL` is set
- `init_db(db_arg)` — creates the schema (tables, `vector` extension, HNSW index)
- `PgConnection` — thin wrapper around psycopg2
- `get_state(conn, key, default)` / `set_state(conn, key, value)` — read/write one `pipeline_state` key/value row (JSONB). Used for cross-run bookkeeping that used to live in local files under `data/` (the harvest watermark in `oai.py`, in-flight OpenAI batch tracking in `llm_classify.py`) — those files aren't safe for a cron-triggered container that gets a fresh filesystem per run, so this is the durable, DB-backed replacement.

`PgConnection` uses psycopg2 with `DictCursor` and intercepts `BEGIN`/`COMMIT`/`ROLLBACK` strings to map them to connection-level calls. Parameter placeholders (`?`, `:name`) are translated to psycopg2 format (`%s`, `%(name)s`) automatically via `_to_pg_sql()`.

Schema: `papers_raw`, `papers` (with `embedding vector(768)`, `graph_x`, `graph_y`, `llm_relevant`/`llm_tags`/etc.) + HNSW index.

### `oai.py`

Harvests metadata from arXiv via OAI-PMH into `papers_raw`. Uses `:name` paramstyle (translated to `%(name)s` for PostgreSQL automatically).

### `filters.py`

Implements filtering stages:

- **stage 1**: regex/keyword gating into `papers`
- **stage 2**: semantic filtering using centroid or logistic regression

Vector loading reads `papers.embedding` via `id = ANY(%s)`.

### `embeddings.py`

Generates SPECTER2 embeddings (`papers.embedding`, CLI `embed`) for every stage-1 candidate, and BGE topic embeddings (`papers.embedding_topic`, CLI `embed-topic`) for kept papers only. `embed-topic` must run *after* `filter` — it only embeds rows where `ai_stage2_keep = TRUE`, and `compute_layout.py` requires every kept row to already have a topic embedding.

### `llm_classify.py`

LLM-based combined relevance + taxonomy classification (post stage-2), via OpenAI — the live source of the tags served by the API. Supports sync classification (`classify_papers`, CLI `llm-classify`) and the OpenAI Batch API (`submit_batch`/`collect_batch`, CLI `llm-classify-submit`/`llm-classify-collect`), plus `run_until_done` (CLI `llm-classify-run`) which loops submit→wait→collect until the whole corpus is classified — the recommended production command. Writes to `papers` via `_UPDATE_LLM`: `llm_relevant`, `llm_confidence`, `llm_tags`, `llm_reason`, `llm_model`, `llm_classified_at`, `llm_batch_id`.

### `compute_layout.py`

Computes 2D layout coordinates (umap/pca) from embeddings of filtered papers, and persists `graph_x` / `graph_y` back to the `papers` table. No JSON output — purely a DB-persistence stage consumed live by `api/routes/graph.py`.

### `api/`

FastAPI backend module. See `src/aisafety_pipeline/api/ARCHITECTURE.md`.

### `utils.py`

CLI parser and public command surface. Registers all subcommands including `serve` (starts uvicorn with the FastAPI app) and `run-all` (chains every stage in order for unattended/cron use — see `Dockerfile.pipeline`/`railway.pipeline.json` at the repo root for the scheduled Railway job that runs it daily).

---

## Execution Model

### Canonical commands

```bash
aisafety-pipeline harvest           # OAI-PMH fetch
aisafety-pipeline stage1            # regex filter
aisafety-pipeline embed             # SPECTER2 vectors
aisafety-pipeline filter            # semantic stage-2
aisafety-pipeline embed-topic       # BGE topic vectors (kept rows only, after filter)
aisafety-pipeline llm-classify-run  # LLM relevance + taxonomy tags (live source, into llm_relevant/llm_tags)
aisafety-pipeline compute-layout    # persists graph_x/y to DB
aisafety-pipeline serve             # FastAPI (DATABASE_URL required)
```

Each pipeline stage persists its outputs back into the database. `serve` requires PostgreSQL — as does every other command. `aisafety-pipeline run-all` chains harvest through compute-layout in this exact order for unattended use (the daily Railway cron job).

---

## Database Architecture

### Connection model

`db.connect(db_arg)` returns a `PgConnection` (psycopg2, DictCursor, pgvector registered). It raises `RuntimeError` unless a DSN is available — either `db_arg` (when it looks like a `postgresql://`/`postgres://` DSN, e.g. via each subcommand's `--db` flag) or the `DATABASE_URL` env var.

The wrapper exposes `.cursor()`, `.commit()`, `.rollback()`, `.execute()`, `.close()`.

A fresh database is bootstrapped by running `aisafety-pipeline init-db` (or any command that happens to call `db.init_db()` internally, like `harvest`).

### `papers_raw`

Raw upstream metadata from OAI harvest.

### `papers`

Working set and pipeline state.

Columns: `id`, `title`, `authors`, `published`, `summary`, `link`, `ai_regex_hit`, `ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`, `domain_tag`, `graph_x`, `graph_y`, `embedding vector(768)`, plus LLM classification columns `llm_relevant`, `llm_confidence`, `llm_tags`, `llm_reason`, `llm_model`, `llm_classified_at`, `llm_batch_id` (written by `llm_classify.py`; these are what the API reads)

`CREATE EXTENSION IF NOT EXISTS vector` is run automatically by `init_db()`, along with an HNSW index: `CREATE INDEX ON papers USING hnsw (embedding vector_cosine_ops)`.

---

## Data Lifecycle

1. **Harvest** → `papers_raw`
2. **Stage 1** → `papers` (regex filter, `ai_regex_hit`)
3. **Embedding** → `papers.embedding`
4. **Stage 2 filter** → `papers` (`ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`)
5. **Topic embedding** → `papers.embedding_topic` (kept rows only)
6. **LLM classification** → `papers` (`llm_relevant`, `llm_tags`, etc.) — the live tag source read by the API
7. **Compute layout** → `papers.graph_x/y`
8. **Serve** → FastAPI reads from PostgreSQL live

---

## Layout Contract

### `compute_layout.py`

Operates only on rows where `ai_stage2_keep = 1`.

Computes a 2D projection (`umap` by default, `pca` fallback) of `papers.embedding`, then persists coords: `UPDATE papers SET graph_x=?, graph_y=? WHERE id=?`

No JSON output, no neighbor-edge computation — `api/routes/graph.py` reads `graph_x`/`graph_y` live and re-normalizes per-request; it does not recompute layout.

---

## CLI Surface

Notable defaults:

- Stage-2 method: `centroid`
- Layout coords: `umap` (falls back to `pca` if UMAP is unavailable)
- Serve: `--host 0.0.0.0 --port 8000`

---

## Invariants and Assumptions

- Paper ids are canonical arXiv abs URLs
- `papers` is the central state table — changes affect all downstream stages
- Embeddings live in `papers.embedding` (pgvector)
- `graph_x/y` are always stored back to DB by `compute-layout`

---

## Safe Edit Zones

Safe:

- CLI help text and ergonomics
- Internal helpers, logging
- API metadata fields (coordinated with UI)
- LLM classification prompt/taxonomy descriptions (`taxonomy.py`, `llm_classify.py`)

Be careful around:

- SQL schema changes
- Canonical paper id normalization
- Compact graph field names
- `_to_pg_sql()` param translation in `db.py`
- pgvector HNSW index (needed for API search performance)

---

## Known Architecture Weak Points

1. **Schema migrations are implicit**: `db.py` does `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` for new columns, but has no formal migration framework.
2. **Layout failures occur late when stages are run manually out of order**: `compute-layout` hard-fails if any kept paper is missing its *topic* embedding (`embedding_topic`, from `embed-topic` — not the SPECTER2 `embedding` from `embed`). `run-all` avoids this by always running `embed-topic` after `filter` and before `compute-layout`; running individual CLI commands by hand in the wrong order can still hit it.

---

## Recommended Mental Model

Four layers:

1. **Ingest** (`oai.py`, `papers_raw`)
2. **Stateful analysis** (`papers`, `embeddings` / `papers.embedding`, filters, LLM classification)
3. **Layout / serving** (`compute_layout.py`, `api/`)
4. **CLI orchestration** (`utils.py`)
