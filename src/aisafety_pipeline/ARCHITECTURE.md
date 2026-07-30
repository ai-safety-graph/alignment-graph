# `aisafety_pipeline` Architecture

## Purpose

`src/aisafety_pipeline/` is the backend package that turns raw arXiv metadata into a filtered, clustered, labeled dataset served live via FastAPI.

Its core job is to manage a staged literature-processing pipeline:

```text
harvest -> stage1 -> embed -> filter -> cluster -> label -> compute-layout -> serve
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

`PgConnection` uses psycopg2 with `DictCursor` and intercepts `BEGIN`/`COMMIT`/`ROLLBACK` strings to map them to connection-level calls. Parameter placeholders (`?`, `:name`) are translated to psycopg2 format (`%s`, `%(name)s`) automatically via `_to_pg_sql()`.

Schema: `papers_raw`, `papers` (with `embedding vector(768)`, `graph_x`, `graph_y`), `cluster_meta` + HNSW index.

### `oai.py`

Harvests metadata from arXiv via OAI-PMH into `papers_raw`. Uses `:name` paramstyle (translated to `%(name)s` for PostgreSQL automatically).

### `filters.py`

Implements filtering stages:

- **stage 1**: regex/keyword gating into `papers`
- **stage 2**: semantic filtering using centroid or logistic regression

Vector loading reads `papers.embedding` via `id = ANY(%s)`.

### `embeddings.py`

Generates SPECTER2 embeddings and stores them via `UPDATE papers SET embedding = %s WHERE id = %s`.

### `clustering.py`

Assigns clusters to kept papers. Supports k-means, agglomerative, HDBSCAN.

Reads `papers.embedding` via `id = ANY(%s)`.
Uses cursor-based fetch + `pd.DataFrame([list(r) for r in rows], ...)` instead of `pd.read_sql_query` (incompatible with the connection wrapper).

### `labeling.py`

Assigns cluster labels and terms into `cluster_meta`. Uses cursor-based DataFrame construction.

### `compute_layout.py`

Computes 2D layout coordinates (umap/pca) from embeddings of filtered + clustered papers, and persists `graph_x` / `graph_y` back to the `papers` table. No JSON output — purely a DB-persistence stage consumed live by `api/routes/graph.py`.

### `api/`

FastAPI backend module. See `src/aisafety_pipeline/api/ARCHITECTURE.md`.

### `utils.py`

CLI parser and public command surface. Registers all subcommands including `serve` (starts uvicorn with the FastAPI app).

---

## Execution Model

### Canonical commands

```bash
aisafety-pipeline harvest        # OAI-PMH fetch
aisafety-pipeline stage1         # regex filter
aisafety-pipeline embed          # SPECTER2 vectors
aisafety-pipeline filter         # semantic stage-2
aisafety-pipeline cluster        # k-means / agg / HDBSCAN
aisafety-pipeline label          # cluster labels
aisafety-pipeline compute-layout # persists graph_x/y to DB
aisafety-pipeline serve          # FastAPI (DATABASE_URL required)
```

Each pipeline stage persists its outputs back into the database. `serve` requires PostgreSQL — as does every other command.

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

Columns: `id`, `title`, `authors`, `published`, `summary`, `link`, `kmeans_cluster`, `agg_cluster`, `hdbscan_cluster`, `ai_regex_hit`, `ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`, `domain_tag`, `graph_x`, `graph_y`, `embedding vector(768)`

`CREATE EXTENSION IF NOT EXISTS vector` is run automatically by `init_db()`, along with an HNSW index: `CREATE INDEX ON papers USING hnsw (embedding vector_cosine_ops)`.

### `cluster_meta`

`(method, cluster_id)` → `label`, `confidence`, `terms`.

---

## Data Lifecycle

1. **Harvest** → `papers_raw`
2. **Stage 1** → `papers` (regex filter, `ai_regex_hit`)
3. **Embedding** → `papers.embedding`
4. **Stage 2 filter** → `papers` (`ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`)
5. **Clustering** → `papers` (`kmeans_cluster`, `agg_cluster`, `hdbscan_cluster`)
6. **Labeling** → `cluster_meta`
7. **Compute layout** → `papers.graph_x/y`
8. **Serve** → FastAPI reads from PostgreSQL live

---

## Layout Contract

### `compute_layout.py`

Operates only on rows where `ai_stage2_keep = 1` AND `kmeans_cluster IS NOT NULL`.

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
- `cid` in API responses means k-means cluster id
- Embeddings live in `papers.embedding` (pgvector)
- `graph_x/y` are always stored back to DB by `compute-layout`

---

## Safe Edit Zones

Safe:

- CLI help text and ergonomics
- Internal helpers, logging
- API metadata fields (coordinated with UI)
- Labeling heuristics

Be careful around:

- SQL schema changes
- Canonical paper id normalization
- Compact graph field names
- `_to_pg_sql()` param translation in `db.py`
- pgvector HNSW index (needed for API search performance)

---

## Known Architecture Weak Points

1. **Schema migrations are implicit**: `db.py` does `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` for new columns, but has no formal migration framework.
2. **Layout failures occur late**: missing embeddings only caught when `compute-layout` runs.

---

## Recommended Mental Model

Four layers:

1. **Ingest** (`oai.py`, `papers_raw`)
2. **Stateful analysis** (`papers`, `embeddings` / `papers.embedding`, filters, clustering, labeling)
3. **Layout / serving** (`compute_layout.py`, `api/`)
4. **CLI orchestration** (`utils.py`)
