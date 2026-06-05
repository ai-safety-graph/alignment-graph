# Repository Architecture

## Purpose

This repository builds an AI-safety literature exploration system with two major parts:

1. A **Python pipeline** that harvests arXiv metadata, stores it in SQLite or PostgreSQL, computes embeddings, filters papers, clusters them, labels clusters, and optionally exports JSON artifacts.
2. A **React/Vite UI** that loads data either from a live FastAPI backend or from exported static JSON artifacts (fallback / legacy mode).

The system supports two deployment modes:

- **API mode** (production): pipeline → PostgreSQL + pgvector → FastAPI → frontend
- **Static mode** (legacy/dev): pipeline → SQLite → JSON artifacts → frontend (limited — MobileView and StatsView require the API)

---

## High-Level Data Flow

```text
arXiv OAI-PMH
  -> papers_raw (SQLite or PostgreSQL)
  -> papers (working set / pipeline state)
  -> embeddings (SPECTER2 vectors — BLOB in SQLite, vector(768) in PostgreSQL)
  -> stage-2 keep / reject decisions
  -> clustering assignments
  -> cluster labels + graph coords (graph_x, graph_y stored in papers table)
  -> FastAPI backend (API mode)     -> React frontend
  -> export_graph.py  (static mode) -> ui/public/graph.json
  -> export_summaries.py (static)   -> ui/public/summaries.json
```

Canonical CLI workflow:

```bash
aisafety-pipeline harvest
aisafety-pipeline stage1
aisafety-pipeline embed
aisafety-pipeline filter
aisafety-pipeline cluster
aisafety-pipeline label
aisafety-pipeline export-graph   # also persists graph_x/y to DB
aisafety-pipeline serve          # start FastAPI (API mode only)
```

---

## Major Subsystems

### `src/aisafety_pipeline/`

Primary backend package. Owns:

- arXiv/OAI harvesting
- Dual-mode persistence (SQLite via `SqliteConnection`, PostgreSQL via `PgConnection`)
- Embedding generation and storage
- Filtering (regex + semantic centroid)
- Clustering (k-means, agglomerative, HDBSCAN)
- Cluster labeling
- Artifact export (JSON) and graph coord persistence

See `src/aisafety_pipeline/ARCHITECTURE.md` for module-level details.

### `src/aisafety_pipeline/api/`

FastAPI backend. Owns:

- REST API serving live data from PostgreSQL
- Paginated paper listing with server-side filtering (keyword, date, multi-value cluster and domain) and single paper detail
- Subset graph building on demand (`POST /api/graph/subset`)
- On-demand related papers via pgvector HNSW nearest-neighbor (`GET /api/papers/related`)
- Semantic search via pgvector ANN
- CORS for Netlify frontend

See `src/aisafety_pipeline/api/ARCHITECTURE.md` for route-level details.

### `ui/`

Frontend application built with Vite/React. Owns:

- Choosing desktop vs mobile rendering
- Fetching all papers and clusters from the API on mount
- Subset graph rendering for desktop (`POST /api/graph/subset`)
- On-demand related papers per paper selection (`GET /api/papers/related`)
- Keyword search and semantic search (API mode only)

See `ui/ARCHITECTURE.md` for frontend details.

### `migrations/`

One-time migration utilities:

- `sqlite_to_postgres.py`: migrates existing SQLite database to PostgreSQL, converts embedding BLOBs to pgvector, verifies row counts.

### `data/`

Runtime state and local persistence:

- `arxiv_papers.db`: SQLite database (used in local/static mode)
- `last_run.txt`: harvest state/checkpointing

### `archive/`

Historical and deprecated pipeline code. Reference material only, not active production code.

---

## Supported Execution Model

The public orchestration surface is defined in `src/aisafety_pipeline/utils.py`:

- `harvest` — OAI-PMH fetch into `papers_raw`
- `stage1` — regex filter into `papers`
- `embed` — SPECTER2 embeddings
- `filter` — semantic stage-2 filter
- `cluster` — k-means / agg / HDBSCAN assignments
- `label` — cluster labels into `cluster_meta`
- `export-graph` — JSON artifact + persists `graph_x/y` to DB
- `export-summaries` — summary lookup JSON artifact
- `serve` — start FastAPI with uvicorn (`--host`, `--port`, `--reload`)

---

## Database Backends

### SQLite (local / static mode)

Tables: `papers_raw`, `papers`, `embeddings` (BLOB), `cluster_meta`

Activated when `DATABASE_URL` is unset. Used for local pipeline runs and static artifact export. `db.connect()` returns a `SqliteConnection` wrapper.

### PostgreSQL + pgvector (production / API mode)

Tables: `papers_raw`, `papers` (includes `embedding vector(768)`, `graph_x`, `graph_y`), `cluster_meta`

Activated when `DATABASE_URL` env var is set to a valid PostgreSQL DSN. `db.connect()` returns a `PgConnection` wrapper. Vector search uses an HNSW index (`vector_cosine_ops`).

Both backends share the same `Connection` interface so all pipeline modules are backend-agnostic.

---

## Frontend Artifacts (static mode)

When `VITE_API_URL` is not set, the UI falls back to static files in `ui/public/`:

- `graph.json` — compact graph with nodes, links, clusters, and coords
- `summaries.json` — summary lookup keyed by arXiv abs URL

These are produced by `export-graph` and `export-summaries` respectively.

---

## Deployment Model

| Component | Service | Notes |
|-----------|---------|-------|
| PostgreSQL + pgvector | Supabase | Native pgvector, connection pooling |
| FastAPI API | Render / Railway | `DATABASE_URL` env var required; `aisafety-pipeline serve` entrypoint |
| Frontend | Netlify | Set `VITE_API_URL` to API URL; falls back to static JSON if unset |

---

## Important Assumptions

### Cluster namespace

Export and API routes use `kmeans_cluster` as the production cluster id (`cid`). `agg_cluster` and `hdbscan_cluster` are stored but not currently exposed.

### Canonical paper identity

Paper ids are canonical arXiv abs URLs, e.g. `https://arxiv.org/abs/2401.01234`. This is the join key across all tables and artifacts.

### Reproducibility of stage-2 filtering

`seeds.txt` is tied to a specific harvest window. To reproduce prior filtering, the harvest window and seed set must match.

---

## Safe Edit Zones

AI may safely modify:
- Documentation
- UI rendering logic
- Export formatting (coordinated with UI)
- Pipeline internal helpers
- CLI help text

AI should be careful around:
- PostgreSQL/SQLite schema changes
- Paper id normalization
- Compact graph field names (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`)
- Cluster id semantics
- `is_pg` branching in pipeline modules
- pgvector operator syntax (`<=>`)

---

## Cross-Subsystem Risks

1. **Artifact schema drift**: changes to `export_graph.py` field names silently break the UI in static mode.
2. **Cluster-method mismatch**: API and static export both assume k-means; changing this requires coordinated updates.
3. **Identifier mismatch**: arXiv abs URL format must remain stable across pipeline and UI. The frontend assigns ephemeral numeric `id` values by index; `aid` (the arXiv URL) is the durable key.
4. **Static artifact staleness**: in static mode, pipeline changes have no effect until fresh JSON is exported and redeployed.
5. **API-only features in UI**: semantic search, related papers, and paper listing all require `VITE_API_URL`. MobileView and StatsView will not load papers without it.
6. **Graph coordinate alignment**: the desktop graph places search/related "ghost" nodes by re-applying the loaded subset's normalisation to each paper's raw coords. This is a contract spanning `graph.py`/`papers.py` (which expose `meta.coords.bounds` and raw `rx`/`ry`) and `Graph.tsx`'s `ghostCoord()` (which mirrors the backend canvas-mapping formula). Changing the normalisation on either side without the other misplaces ghost nodes.

---

## Recommended Mental Model

When editing this repository, treat it as four layers:

1. **Ingest and analysis** (`src/aisafety_pipeline/` pipeline modules)
2. **Persistence** (`db.py` — SQLite or PostgreSQL)
3. **Serving / artifact contract** (API routes or `graph.json` / `summaries.json`)
4. **Presentation** (`ui/`)

Most safe changes stay within a layer. Cross-layer changes should be intentional and documented.
