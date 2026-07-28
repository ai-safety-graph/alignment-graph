# Repository Architecture

## Purpose

This repository builds an AI-safety literature exploration system with two major parts:

1. A **Python pipeline** that harvests arXiv metadata, stores it in PostgreSQL, computes embeddings, filters papers, clusters them, and labels clusters.
2. A **React/Vite UI** that loads all data from a live FastAPI backend.

The active and only supported deployment mode is **API mode**: pipeline → PostgreSQL + pgvector → FastAPI → frontend. See top-level `CLAUDE.md`.

The pipeline can still export static JSON artifacts (`export-graph`, `export-summaries`) and the UI retains a `summaries.json` fallback in `lib/summaries.ts`, but this static path is legacy — it is not the deployment target and new work should not extend it.

---

## High-Level Data Flow

```text
arXiv OAI-PMH
  -> papers_raw (PostgreSQL)
  -> papers (working set / pipeline state)
  -> embeddings (SPECTER2 vectors — vector(768) in PostgreSQL/pgvector)
  -> stage-2 keep / reject decisions
  -> clustering assignments
  -> cluster labels + graph coords (graph_x, graph_y stored in papers table)
  -> FastAPI backend                -> React frontend
  -> export_graph.py  (legacy)      -> ui/public/graph.json
  -> export_summaries.py (legacy)   -> ui/public/summaries.json
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
aisafety-pipeline serve          # start FastAPI
```

---

## Major Subsystems

### `src/aisafety_pipeline/`

Primary backend package. Owns:

- arXiv/OAI harvesting
- Persistence (PostgreSQL + pgvector via `PgConnection`)
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

- Choosing desktop (`GraphView`) vs mobile (`StatsView`) rendering at `/`; `/stats` always renders `StatsView`
- Subset graph rendering for desktop (`POST /api/graph/subset`) with semantic search and ghost nodes
- Server-side filtered, paginated paper browsing for the list view (`GET /api/papers`)
- On-demand related papers per paper selection (`GET /api/papers/related`)

(`MobileView` was removed; mobile now uses `StatsView`.) See `ui/ARCHITECTURE.md` for frontend details.

### `migrations/`

Postgres-specific setup utilities:

- `enable_rls.sql`: Supabase row-level-security setup.

### `data/`

Runtime state and local persistence:

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

## Database Backend

### PostgreSQL + pgvector (only supported backend)

Tables: `papers_raw`, `papers` (includes `embedding vector(768)`, `graph_x`, `graph_y`), `cluster_meta`

Requires the `DATABASE_URL` env var to be set to a valid PostgreSQL DSN — `db.connect()` raises `RuntimeError` otherwise. Vector search uses an HNSW index (`vector_cosine_ops`). Run `aisafety-pipeline init-db` (or any pipeline command — `harvest` already bootstraps the schema) against a fresh database to create tables/extensions.

---

## Legacy Static Artifacts

The pipeline can still produce static files in `ui/public/` via `export-graph` / `export-summaries` (`graph.json`, `summaries.json`), and `lib/summaries.ts` retains a fallback that reads `summaries.json` when the API has no data for a paper. This predates API mode and is not exercised by the deployed UI, which always has `VITE_API_URL` set — do not build new features against it (see top-level `CLAUDE.md`).

---

## Deployment Model

| Component             | Service          | Notes                                                                 |
| --------------------- | ---------------- | --------------------------------------------------------------------- |
| PostgreSQL + pgvector | Supabase         | Native pgvector, connection pooling                                   |
| FastAPI API           | Railway          | `DATABASE_URL` env var required; `aisafety-pipeline serve` entrypoint |
| Frontend              | Netlify          | `VITE_API_URL` set to the API URL via Netlify's env vars              |

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

- PostgreSQL schema changes
- Paper id normalization
- Compact graph field names (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`)
- Cluster id semantics
- pgvector operator syntax (`<=>`)

---

## Cross-Subsystem Risks

1. **Artifact schema drift**: changes to `export_graph.py` field names silently break the legacy static export path (not the deployed UI).
2. **Cluster-method mismatch**: the API and legacy static export both assume k-means; changing this requires coordinated updates.
3. **Identifier mismatch**: arXiv abs URL format must remain stable across pipeline and UI. The frontend assigns ephemeral numeric `id` values by index; `aid` (the arXiv URL) is the durable key.
4. **Legacy artifact staleness**: if `graph.json` / `summaries.json` are ever regenerated for local/offline use, they go stale the moment pipeline data changes unless re-exported — not a concern for the deployed UI, which doesn't read them.
5. **API dependency in UI**: semantic search, related papers, subset graph, and paper listing all require `VITE_API_URL`. `GraphView` and `StatsView` will not load without it.
6. **Graph coordinate alignment**: the desktop graph places search/related "ghost" nodes by re-applying the loaded subset's normalisation to each paper's raw coords. This is a contract spanning `graph.py`/`papers.py` (which expose `meta.coords.bounds` and raw `rx`/`ry`) and `GraphView.tsx`'s `ghostCoord()` (which mirrors the backend canvas-mapping formula). Changing the normalisation on either side without the other misplaces ghost nodes.

---

## Recommended Mental Model

When editing this repository, treat it as four layers:

1. **Ingest and analysis** (`src/aisafety_pipeline/` pipeline modules)
2. **Persistence** (`db.py` — PostgreSQL)
3. **Serving contract** (API routes; legacy `graph.json` / `summaries.json` export)
4. **Presentation** (`ui/`)

Most safe changes stay within a layer. Cross-layer changes should be intentional and documented.
