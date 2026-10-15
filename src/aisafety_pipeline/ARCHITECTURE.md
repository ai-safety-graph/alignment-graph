# `aisafety_pipeline` Architecture

## Purpose

`src/aisafety_pipeline/` is the backend package that turns raw arXiv metadata into a filtered, topic-tagged dataset served live via FastAPI.

Its core job is to manage a staged literature-processing pipeline:

```text
harvest -> stage1 -> embed -> filter -> llm-classify(-run) -> embed-topic -> compute-layout -> serve
```

The package is PostgreSQL + pgvector only — every pipeline command and the API require `DATABASE_URL` to be set.

---

## Module Map

### `config.py`

Central configuration:

Loads `.env` from the repo root (shell env wins). Env vars (defaults in parentheses):

- `DATABASE_URL` — PostgreSQL DSN (required by every pipeline command and the API)
- Local state: `AIS_DATA_DIR` (`./data`), `AIS_STATE_FILE` (`data/last_run.txt`, local mirror of the harvest watermark)
- API: `API_HOST` (`0.0.0.0`), `API_PORT` (`8000`), `CORS_ORIGINS` (comma-separated; exposed as the `API_CORS_ORIGINS` constant), `API_DB_POOL_MAX` (`10`), `API_DB_POOL_MIN` (= max), `API_DB_POOL_TIMEOUT` (`5` s)
- Rate limiting: `RATE_LIMIT_ENABLED` (`true`), `RATE_LIMIT_DEFAULT` (`120/minute`), `RATE_LIMIT_EXPENSIVE` (`30/minute`)
- Features: `ENABLE_SEMANTIC_SEARCH` (`false`), `SEARCH_LOG_ENABLED` (`true`)
- LLM: `LLM_MODEL`, `OPENAI_API_KEY`, `LLM_MAX_RETRIES` (`5`), `LLM_REQUEST_TIMEOUT_SEC` (`60`), `LLM_BATCH_MAX_ENQUEUED_TOKENS` (`3000000`)

`AIS_USER_AGENT` (the User-Agent sent to arXiv) is read directly in `oai.py`. Boolean env vars are true only for `1`/`true`/`yes`. Non-env constants: embedding model metadata (SPECTER2 for `embedding`, `BAAI/bge-base-en-v1.5` for `embedding_topic`, both 768-d), `STAGE2_CENTROID_TAU` (`0.90`), OAI-PMH settings (`OAI_BASE`, `OAI_SETS` = `cs`, `stat`, `econ`, `eess:eess:SY`, 3 s throttle), logging colors.

### `taxonomy.py`

`TAXONOMY` (the fixed topic list) and `TAXONOMY_DESCRIPTIONS` (per-topic descriptions fed to the LLM prompt). Editing the list is the supported way to add/rename/split topics; UI icons in `ui/src/lib/tags.ts` are keyed by these names.

### `arxiv_ids.py`

`normalize_arxiv_id_or_url()` — maps bare ids and arXiv URL variants to the canonical `https://arxiv.org/abs/<id>` form used as the primary key (used when loading seeds).

### `db.py`

Owns database connection setup and schema initialization.

Key exports:

- `connect(db_arg)` — returns a `PgConnection`; raises `RuntimeError` if neither `db_arg` (a `postgresql://`/`postgres://` DSN) nor `DATABASE_URL` is set
- `init_db(db_arg)` — idempotently creates/upgrades the schema (extension, tables, missing columns, indexes) and drops legacy indexes
- `PgConnection` — thin wrapper around psycopg2
- `get_state(conn, key, default)` / `set_state(conn, key, value)` — read/write one `pipeline_state` key/value row (JSONB). Used for cross-run bookkeeping that used to live in local files under `data/` (the harvest watermark in `oai.py`, in-flight OpenAI batch tracking in `llm_classify.py`) — those files aren't safe for a cron-triggered container that gets a fresh filesystem per run, so this is the durable, DB-backed replacement. Also holds `latest_batch`, which `run-all` writes after a successful run (`{date, added}`: papers newly classified relevant during the run; skipped when 0) and `GET /api/batch/latest` serves to the UI header.

`PgConnection` uses psycopg2 with `DictCursor` and intercepts `BEGIN`/`COMMIT`/`ROLLBACK` strings to map them to connection-level calls. Parameter placeholders (`?` with tuple params, `:name` with dict params) are translated to psycopg2 format (`%s`, `%(name)s`) automatically via `_to_pg_sql()` in `.execute()`; `raw_cursor()` bypasses this for `psycopg2.extras.execute_values`.

Schema: `papers_raw`, `papers`, `pipeline_state`, `search_log` — see Database Architecture below.

### `oai.py`

Harvests metadata from arXiv via OAI-PMH (sets in `config.OAI_SETS`) into `papers_raw`, upserting with `execute_values` on a raw cursor and stamping `harvested_at = now()` on every insert/update. Calls `init_db()` itself, so it bootstraps a fresh database. Incremental: resumes from the `harvest_watermark` key in `pipeline_state` (falling back to `AIS_STATE_FILE`, then 2005-09-16) unless `--from` is given (`--until` defaults to today), and writes the new watermark to both on success. `scripts/run_harvest_chunked.py` wraps it for resumable multi-window backfills.

### `filters.py`

Implements filtering stages:

- **stage 1**: regex/keyword gating into `papers`, also deriving `domain_tag` (`tech`/`gov`/`both`/`unknown`) from the arXiv categories; policy-ish categories (`cs.CY`, `cs.SI`, `cs.CR`, `econ.*`) get a looser match. Incremental: only scans `papers_raw` rows whose `harvested_at` (stamped by every harvest upsert) is newer than the `stage1_watermark` key in `pipeline_state`. It does a full scan when that key is missing, or with `--full` (needed after changing the stage-1 regexes).
- **stage 2**: semantic filtering over SPECTER2 vectors, `--method centroid` (cosine to one seed centroid from `seeds.txt`, threshold `--tau`, default `0.90`) or `centroid-multi` (per-subtopic centroids from `seeds_subtopics.tsv`, z-scored per group). `logreg` is accepted by the parser but not implemented. `centroid` only scores papers with `ai_sem_sim IS NULL` unless `--full` is passed (needed after changing the seeds or tau); `centroid-multi` always rescores everything, since its z-scores depend on the whole population.

`load_vectors(conn, ids, model=)` reads `papers.embedding` (`model="specter2"`, default) or `papers.embedding_topic` (`model="topic"`, used by `compute_layout.py`) via `id = ANY(%s)`, L2-normalised.

### `embeddings.py`

Generates SPECTER2 embeddings (`papers.embedding`, CLI `embed`) for every stage-1 candidate, and BGE topic embeddings (`papers.embedding_topic`, CLI `embed-topic`) for `llm_relevant` papers only. `embed-topic` must run *after* `llm-classify` — it only embeds rows where `llm_relevant` is true, and `compute_layout.py` only lays out `llm_relevant` rows that already have a topic embedding.

### `llm_classify.py`

LLM-based combined relevance + taxonomy classification (post stage-2), via OpenAI — the live source of the tags served by the API. Supports sync classification (`classify_papers`, CLI `llm-classify`) and the OpenAI Batch API (`submit_batch`/`collect_batch`, CLI `llm-classify-submit`/`llm-classify-collect`), plus `run_until_done` (CLI `llm-classify-run`) which loops submit→wait→collect until the whole corpus is classified — the recommended production command. Writes to `papers` via `_UPDATE_LLM`: `llm_relevant`, `llm_confidence`, `llm_tags`, `llm_reason`, `llm_model`, `llm_classified_at`, `llm_batch_id`.

Eligible papers are `ai_stage2_keep = TRUE` rows not yet classified and not in flight (`llm_batch_id IS NULL`), unless `--force`. In-flight batches are tracked under the `llm_batches` key in `pipeline_state`. Each submitted batch is capped at 50k requests, ~190 MB of JSONL, and `LLM_BATCH_MAX_ENQUEUED_TOKENS` estimated tokens (OpenAI's org-wide enqueued-token limit); `llm-classify-submit` refuses to submit while other tracked batches are still processing unless `--allow-concurrent`.

### `compute_layout.py`

Places `llm_relevant` papers in 2D from their topic embeddings — incrementally (new papers at the mean of their nearest placed neighbours) by default, or a full umap/pca refit with `--full` — and persists `graph_x` / `graph_y` back to the `papers` table. No JSON output — purely a DB-persistence stage consumed live by `api/routes/graph.py`.

### `api/`

FastAPI backend module. See `src/aisafety_pipeline/api/ARCHITECTURE.md`.

### `utils.py`

CLI parser and public command surface. Registers all subcommands including `serve` (starts uvicorn with the FastAPI app) and `run-all` (chains every stage in order for unattended/cron use — see `Dockerfile.pipeline` at the repo root for the scheduled Railway job that runs it daily; both Railway services are configured in the dashboard via `RAILWAY_DOCKERFILE_PATH`, with no Railway config file in the repo).

---

## Execution Model

### Canonical commands

```bash
aisafety-pipeline harvest           # OAI-PMH fetch
aisafety-pipeline stage1            # regex filter
aisafety-pipeline embed             # SPECTER2 vectors
aisafety-pipeline filter            # semantic stage-2
aisafety-pipeline llm-classify-run  # LLM relevance + taxonomy tags (live source, into llm_relevant/llm_tags)
aisafety-pipeline embed-topic       # BGE topic vectors (relevant rows only, after llm-classify)
aisafety-pipeline compute-layout    # persists graph_x/y to DB
aisafety-pipeline serve             # FastAPI (DATABASE_URL required)
```

Each pipeline stage persists its outputs back into the database. `serve` requires PostgreSQL — as does every other command. `aisafety-pipeline run-all` chains harvest through compute-layout in this exact order for unattended use (the daily Railway cron job).

---

## Database Architecture

### Connection model

`db.connect(db_arg)` returns a `PgConnection` (psycopg2, DictCursor, pgvector registered). It raises `RuntimeError` unless a DSN is available — either `db_arg` (when it looks like a `postgresql://`/`postgres://` DSN, e.g. via each subcommand's `--db` flag) or the `DATABASE_URL` env var.

The wrapper exposes `.cursor()`, `.execute()`, `.commit()`, `.rollback()`, `.close()`, plus `.raw_cursor()` (an unwrapped psycopg2 cursor, for `execute_values`), `.reconnect()` (re-open after a dropped connection during long stages), `PgConnection.from_raw(conn)` (wrap an existing psycopg2 connection — used by the API pool), and `.try_register_vector()`.

A fresh database is bootstrapped by running `aisafety-pipeline init-db` (or any command that happens to call `db.init_db()` internally, like `harvest`).

### `papers_raw`

Raw upstream metadata from OAI harvest. Columns: `id`, `title`, `authors`, `published`, `summary`, `link`, `categories`, `updated`, `pdf_url`, `harvested_at` (default `now()`; NULL for rows harvested before the column existed).

### `papers`

Working set and pipeline state.

Columns: `id`, `title`, `authors`, `published`, `summary`, `link`, `ai_regex_hit`, `ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`, `domain_tag`, `graph_x`, `graph_y`, `embedding vector(768)` (SPECTER2), `embedding_topic vector(768)` (BGE), plus LLM classification columns `llm_relevant`, `llm_confidence`, `llm_tags`, `llm_reason`, `llm_model`, `llm_classified_at`, `llm_batch_id` (written by `llm_classify.py`; these are what the API reads)

### `pipeline_state`

`key TEXT PRIMARY KEY, value JSONB, updated_at`. Keys in use: `harvest_watermark` (`oai.py`), `stage1_watermark` (`filters.py`), `llm_batches` (`llm_classify.py`), `latest_batch` (`utils.py`, served by `GET /api/batch/latest`).

### `search_log`

`id, ts, query, mode, total, has_filters` — written by the API (`api/search_log.py`), no IPs or user identifiers.

### Indexes

`CREATE EXTENSION IF NOT EXISTS vector` is run automatically by `init_db()`, which also creates:

- Partial HNSW indexes (`vector_cosine_ops`), both `WHERE llm_relevant = TRUE AND <col> IS NOT NULL` so they only match API queries that gate on `llm_relevant`: `idx_papers_embedding_llm` on `embedding`, `idx_papers_embedding_topic_llm` on `embedding_topic`. The older non-partial `idx_papers_embedding`/`idx_papers_embedding_topic` are dropped.
- `idx_papers_llm_relevant`, GIN `idx_papers_llm_tags`, partial `idx_papers_llm_batch_id`, `idx_papers_keep`, `idx_papers_domain`.
- "Work queue" partial indexes for the incremental stages: `idx_papers_missing_embedding`, `idx_papers_unscored`, `idx_papers_missing_topic`, `idx_papers_unplaced`.
- Partial `idx_papers_raw_harvested_at` (backs stage 1's watermark scan) and `idx_search_log_ts`.

---

## Data Lifecycle

1. **Harvest** → `papers_raw`
2. **Stage 1** → `papers` (regex filter, `ai_regex_hit`)
3. **Embedding** → `papers.embedding`
4. **Stage 2 filter** → `papers` (`ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`)
5. **LLM classification** → `papers` (`llm_relevant`, `llm_tags`, etc.) — the live tag source read by the API
6. **Topic embedding** → `papers.embedding_topic` (`llm_relevant` rows only)
7. **Compute layout** → `papers.graph_x/y`
8. **Serve** → FastAPI reads from PostgreSQL live

---

## Layout Contract

### `compute_layout.py`

Operates only on rows where `llm_relevant` is true and `embedding_topic` is present — the same set the graph and search API routes serve.

Default (incremental): for each such row with `graph_x IS NULL`, finds its `--knn-k` nearest already-placed neighbours by `embedding_topic <=>` (served by the `idx_papers_embedding_topic_llm` HNSW index) and stores their mean position. Existing coords are never touched.

`--full` (or no existing layout): computes a 2D projection (`umap` by default, `pca` fallback) of `papers.embedding_topic` for every row, scaled to the 1000×700 canvas.

Both paths write coords with batched `UPDATE ... FROM (VALUES ...)` statements; the full path skips rows whose coords didn't change.

No JSON output, no neighbor-edge computation — `api/routes/graph.py` reads `graph_x`/`graph_y` live and re-normalizes per-request; it does not recompute layout.

---

## CLI Surface

Notable defaults:

- Every pipeline subcommand (all but `serve`) takes `--db` (DSN; defaults to `$DATABASE_URL`)
- Stage-2 method: `centroid`, `--tau` default `0.90`
- Layout coords: `umap` (falls back to `pca` if UMAP is unavailable); `--coords none` skips; `--knn-k` (incremental), `--umap-*`, `--pca-rand`, `--canvas-*` (full)
- Embeddings: `--device auto|cpu|mps|cuda[:N]`, `--batch-size`
- LLM: `llm-classify --limit/--dry-run/--force`; `llm-classify-collect --batch-id/--wait/--poll-interval`
- Serve: `--host`/`--port` default to `API_HOST`/`API_PORT` (`0.0.0.0`/`8000`); production runs uvicorn directly from the root `Dockerfile` instead
- `run-all`: `--seeds`, `--tau`, `--filter-method`, `--device`, `--coords`, repeatable `--skip <stage>`; always incremental (`full=False`), with `batch_size=32` and `knn_k=10` hard-coded. Stops on the first failing stage, then records `latest_batch`.

---

## Invariants and Assumptions

- Paper ids are canonical arXiv abs URLs
- `papers` is the central state table — changes affect all downstream stages
- Embeddings live in `papers.embedding` (SPECTER2: stage 2, related papers) and `papers.embedding_topic` (BGE: search, layout)
- Stages are incremental by default — each processes only rows missing its output (watermarks for harvest/stage 1; NULL columns, backed by the work-queue indexes, for the rest); `--full` reprocesses everything where supported
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
2. **Layout failures occur late when stages are run manually out of order**: `compute-layout` silently skips any relevant paper that is missing its *topic* embedding (`embedding_topic`, from `embed-topic` — not the SPECTER2 `embedding` from `embed`). `run-all` avoids this by always running `embed-topic` after `llm-classify` and before `compute-layout`; running individual CLI commands by hand in the wrong order can still hit it.

---

## Recommended Mental Model

Four layers:

1. **Ingest** (`oai.py`, `papers_raw`)
2. **Stateful analysis** (`papers`, `embeddings` / `papers.embedding`, filters, LLM classification)
3. **Layout / serving** (`compute_layout.py`, `api/`)
4. **CLI orchestration** (`utils.py`)
