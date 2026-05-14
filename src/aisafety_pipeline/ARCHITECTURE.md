# `aisafety_pipeline` Architecture

## Purpose

`src/aisafety_pipeline/` is the backend package that turns raw arXiv metadata into a filtered, clustered, labeled dataset served via FastAPI or exported as static JSON artifacts.

Its core job is to manage a staged literature-processing pipeline:

```text
harvest -> stage1 -> embed -> filter -> cluster -> label -> export / serve
```

The package supports two database backends transparently: **SQLite** (local / static) and **PostgreSQL + pgvector** (production / API).

---

## Module Map

### `config.py`

Central configuration:
- `DB_PATH` — SQLite path (local dev)
- `DATABASE_URL` — PostgreSQL DSN (production; activates `PgConnection`)
- `API_HOST`, `API_PORT`, `API_CORS_ORIGINS`
- Embedding model metadata, OAI-PMH settings, logging colors

### `db.py`

Owns database connection setup and schema initialization for both backends.

Key exports:
- `connect(db_arg)` — returns `SqliteConnection` or `PgConnection` based on `DATABASE_URL`
- `init_db(db_arg)` — creates schema for the detected backend
- `SqliteConnection` / `PgConnection` — unified wrapper pair with `is_pg` flag

Both wrappers implement the same cursor interface. `PgConnection` uses psycopg2 with `DictCursor` and intercepts `BEGIN`/`COMMIT`/`ROLLBACK` strings to map them to connection-level calls. Parameter placeholders (`?`, `:name`) are translated to psycopg2 format (`%s`, `%(name)s`) automatically.

Schema variants:
- **SQLite**: `papers_raw`, `papers`, `embeddings` (BLOB), `cluster_meta`
- **PostgreSQL**: `papers_raw`, `papers` (with `embedding vector(768)`, `graph_x`, `graph_y`), `cluster_meta` + HNSW index

### `oai.py`

Harvests metadata from arXiv via OAI-PMH into `papers_raw`. Uses `:name` paramstyle (translated to `%(name)s` for PostgreSQL automatically).

### `filters.py`

Implements filtering stages:
- **stage 1**: regex/keyword gating into `papers`
- **stage 2**: semantic filtering using centroid or logistic regression

Dual-mode for vector loading: PostgreSQL reads `papers.embedding`, SQLite reads `embeddings` table.

### `embeddings.py`

Generates SPECTER2 embeddings and stores them.

Dual-mode storage:
- PostgreSQL: `UPDATE papers SET embedding = %s WHERE id = %s`
- SQLite: INSERT into separate `embeddings` BLOB table

Provides `bytes_from_vec` / `vec_from_bytes` helpers for SQLite BLOB encoding.

### `clustering.py`

Assigns clusters to kept papers. Supports k-means, agglomerative, HDBSCAN.

Dual-mode: PostgreSQL reads `papers.embedding`, SQLite reads `embeddings` table.
Uses cursor-based fetch + `pd.DataFrame([list(r) for r in rows], ...)` instead of `pd.read_sql_query` (incompatible with the connection wrapper).

### `labeling.py`

Assigns cluster labels and terms into `cluster_meta`. Uses cursor-based DataFrame construction.

### `export_graph.py`

Exports frontend graph JSON from filtered + clustered papers. Also persists `graph_x` / `graph_y` back to the `papers` table after layout computation.

Dual-mode embedding loading for neighbor-link calculation.

### `export_summaries.py`

Exports summary lookup JSON. Dual-mode WHERE clause for id whitelist.

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
aisafety-pipeline export-graph   # JSON + persists graph_x/y to DB
aisafety-pipeline export-summaries
aisafety-pipeline serve          # FastAPI (DATABASE_URL required)
```

Each pipeline stage persists its outputs back into the database. `serve` requires PostgreSQL.

---

## Database Architecture

### Connection model

`db.connect()` auto-detects backend:
- `DATABASE_URL` set → `PgConnection` (psycopg2, DictCursor, pgvector registered)
- `DATABASE_URL` unset → `SqliteConnection` (sqlite3, row_factory=Row, foreign keys ON)

Both return a wrapper with `.cursor()`, `.commit()`, `.rollback()`, `.execute()`, `.close()`, and `.is_pg` flag.

### SQLite tables

**`papers_raw`**: raw upstream metadata from OAI harvest.

**`papers`**: working set and pipeline state.

Columns: `id`, `title`, `authors`, `published`, `summary`, `link`, `kmeans_cluster`, `agg_cluster`, `hdbscan_cluster`, `ai_regex_hit`, `ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`, `domain_tag`, `graph_x`, `graph_y`

**`embeddings`**: separate BLOB table — `paper_id`, `model`, `dim`, `vector`, `created_at`.

**`cluster_meta`**: `(method, cluster_id)` → `label`, `confidence`, `terms`.

### PostgreSQL tables

Same as SQLite except:
- `papers` includes `embedding vector(768)` (replaces the `embeddings` table)
- `papers` includes `graph_x REAL`, `graph_y REAL`
- No separate `embeddings` table
- `CREATE EXTENSION IF NOT EXISTS vector` required
- HNSW index: `CREATE INDEX ON papers USING hnsw (embedding vector_cosine_ops)`

### Dual-mode invariant

All pipeline modules use `conn.is_pg` to branch between vector storage strategies. No module imports `sqlite3` or `psycopg2` directly — they use `db.connect()`.

---

## Data Lifecycle

1. **Harvest** → `papers_raw`
2. **Stage 1** → `papers` (regex filter, `ai_regex_hit`)
3. **Embedding** → `papers.embedding` (PostgreSQL) or `embeddings` (SQLite)
4. **Stage 2 filter** → `papers` (`ai_sem_sim`, `ai_stage2_keep`, `ai_stage2_reason`)
5. **Clustering** → `papers` (`kmeans_cluster`, `agg_cluster`, `hdbscan_cluster`)
6. **Labeling** → `cluster_meta`
7. **Export graph** → `ui/public/graph.json` + `papers.graph_x/y`
8. **Export summaries** → `ui/public/summaries.json`
9. **Serve** → FastAPI reads from PostgreSQL live

---

## Export Contract

### `export_graph.py`

Exports only rows where `ai_stage2_keep = 1` AND `kmeans_cluster IS NOT NULL`.

Uses `kmeans_cluster AS cid` — this is the production cluster id consumed by the UI.

After layout computation, persists coords: `UPDATE papers SET graph_x=?, graph_y=? WHERE id=?`

Compact node fields: `id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`, optional `sm`, `x`, `y`

Edges: top-k cosine similarity neighbors, optional same-cluster and MST edges.

### `export_summaries.py`

All `ai_stage2_keep = 1` papers. Keyed by canonical arXiv abs URL.

---

## CLI Surface

Notable defaults:
- Stage-2 method: `centroid`
- Graph export coords: `fr` (Fruchterman-Reingold)
- Graph output: compact unless `--verbose`
- Serve: `--host 0.0.0.0 --port 8000`

---

## Invariants and Assumptions

- Paper ids are canonical arXiv abs URLs
- `papers` is the central state table — changes affect all downstream stages
- `cid` in exports means k-means cluster id
- Embedding storage location differs by backend (`papers.embedding` vs `embeddings` table)
- `graph_x/y` are always stored back to DB by `export-graph`, regardless of backend

---

## Safe Edit Zones

Safe:
- CLI help text and ergonomics
- Internal helpers, logging
- Export metadata fields (coordinated with UI)
- Labeling heuristics

Be careful around:
- SQL schema changes (either backend)
- `is_pg` branching logic in pipeline modules
- Embedding serialization format (`bytes_from_vec` / `vec_from_bytes`)
- Canonical paper id normalization
- Compact graph field names
- `_to_pg_sql()` param translation in `db.py`
- pgvector HNSW index (needed for API search performance)

---

## Known Architecture Weak Points

1. **Multi-method clustering, single-method export**: backend stores k-means, agg, HDBSCAN but frontend only consumes k-means.
2. **Schema migrations are implicit**: `db.py` does `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` for new columns, but has no formal migration framework.
3. **Duplicate metadata in exports**: graph and summaries overlap; changes must stay consistent.
4. **Export failures occur late**: missing embeddings only caught at export time.
5. **`serve` requires PostgreSQL**: the FastAPI backend has no SQLite fallback.

---

## Recommended Mental Model

Four layers:

1. **Ingest** (`oai.py`, `papers_raw`)
2. **Stateful analysis** (`papers`, `embeddings` / `papers.embedding`, filters, clustering, labeling)
3. **Artifact shaping / serving** (`export_graph.py`, `export_summaries.py`, `api/`)
4. **CLI orchestration** (`utils.py`)
