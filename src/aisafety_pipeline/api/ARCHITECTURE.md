# `aisafety_pipeline.api` Architecture

## Purpose

FastAPI backend that serves live data from a PostgreSQL + pgvector database to the React frontend. Replaces static JSON artifact loading with dynamic, queryable endpoints.

Requires `DATABASE_URL` env var pointing to a PostgreSQL instance with pgvector (run `aisafety-pipeline init-db`, then the full pipeline, to populate it).

---

## Module Structure

```
src/aisafety_pipeline/api/
  __init__.py
  main.py          # FastAPI app, CORS, lifespan
  deps.py          # get_conn() dependency (yields PgConnection per request)
  routes/
    graph.py       # POST /api/graph/subset
    papers.py      # GET /api/papers, GET /api/papers/related, GET /api/papers/{arxiv_id:path}
    search.py      # POST /api/search
    clusters.py    # GET /api/clusters
```

---

## Startup / Lifespan

`main.py` uses FastAPI's `lifespan` context manager to **warm the search embedding generator** on startup (calls `_get_generator()`), so the first `/api/search` request isn't slowed by model load. The warm-up is best-effort — failures are swallowed and the model loads lazily on first request instead. The lifespan does **not** validate `DATABASE_URL`; that check happens per-request in `get_conn()`.

CORS origins are configured from `config.API_CORS_ORIGINS` (includes `https://alignment-graph.netlify.app` and `http://localhost:5173`).

---

## Dependency

`deps.py` pools connections rather than opening one per request:
- `init_pool()` / `close_pool()` run in `main.py`'s `lifespan`, creating/closing a `ThreadedConnectionPool` (size from `config.API_DB_POOL_MIN`/`API_DB_POOL_MAX`) once for the process lifetime. `register_vector` is registered once per physical connection (in the pool's `_connect` override), not per request.
- `get_conn()` borrows a connection from the pool, wraps it via `PgConnection.from_raw()`, yields it, then rolls back (in case a request left an open transaction) and returns it to the pool in `finally` — it never closes the underlying connection.
- Raises `RuntimeError` if the pool wasn't initialized (`DATABASE_URL` unset at startup).

Route handlers declare `conn=Depends(get_conn)`.

---

## Endpoints

### `POST /api/graph/subset`

Returns a compact graph for a specific list of paper IDs. This is the only graph endpoint — there is no full-graph endpoint.

Request body: `{ ids: string[] }` (max 500 IDs)

Response shape: `{ meta, clusters, nodes: NodeCompact[], links: LinkCompact[] }`

Implementation:
- Fetches only the requested papers (must be `ai_stage2_keep = TRUE`)
- Reads `cluster_meta` for labels
- Re-normalises stored `graph_x/y` coordinates to fit the canvas bounds for the subset
- Builds neighbor links using pgvector `<=>` cosine similarity (batch queries, threshold 0.85, top-5 per paper)

Coordinate fields (used by the UI to align ghost nodes — see `ui/ARCHITECTURE.md`):
- Each node carries both the canvas-normalised `x`/`y` **and** the raw stored `rx`/`ry` (= `graph_x`/`graph_y`, nullable)
- `meta.coords.bounds` carries the subset's raw min/max (`x_min`, `x_max`, `y_min`, `y_max`) when coords are present, else `null`. This lets the frontend re-apply *this* subset's normalisation to papers fetched in later calls (search / related), so they land in the same coordinate space rather than each call's own normalisation

### `GET /api/papers`

Paginated paper listing with server-side filtering.

Query params:
- `page` (default 1), `limit` (default 50, max 200)
- `cluster` — repeatable; multiple values are OR-ed (`kmeans_cluster IN (...)`)
- `domain` — repeatable; multiple values are OR-ed (`domain_tag IN (...)`)
- `from` / `to` — `published` date bounds
- `q` — keyword substring match on `title`/`authors` (`ILIKE`)

Ordered by `published DESC`. Returns: `{ total, page, limit, items: NodeCompact[] }`. Items carry no `sm` (summary) — fetch a single paper for that.

### `GET /api/papers/related`

On-demand related papers for a selected paper using pgvector HNSW nearest-neighbor lookup. Registered before the catch-all `/{arxiv_id:path}` route.

Query params: `id` (arxiv ID or full URL, required), `limit` (default 10, max 50)

Implementation:
- Reads the paper's stored `embedding` vector (single row lookup)
- SQL: `ORDER BY embedding <=> %s LIMIT %s` — served by the HNSW index in ~1–5ms
- No embedding inference at query time

Returns: `NodeCompact[]` with `sim: float` (cosine similarity, 0–1) plus the raw stored coords `rx`/`ry` (= `graph_x`/`graph_y`, nullable). The UI uses `rx`/`ry` together with the main graph's `meta.coords.bounds` to place related papers as ghost nodes in the correct position.

### `GET /api/papers/{arxiv_id:path}`

Single paper detail. The `:path` type handles both bare IDs (`2503.01694`) and full URLs (`https://arxiv.org/abs/2503.01694`).

Returns full paper record including `summary`.

### `POST /api/search`

Semantic search using pgvector ANN.

Request body: `{ query: str, limit: int = 20 (max 100), domain?: str, cluster?: int }`

Implementation:
- Embeds `query` using a lazily-initialized `EmbeddingGenerator` singleton (`_generator`)
- SQL: `SELECT ..., 1 - (embedding <=> %s::vector) AS sim FROM papers WHERE ... ORDER BY embedding <=> %s::vector LIMIT %s`
- Parameters: `[query_vec] + filter_params + [query_vec, limit]` — `query_vec` is passed twice, once for the SELECT similarity value and once for ORDER BY

Returns: `{ query: str, results: SearchResult[] }` where each result includes `sim` (cosine similarity, 0–1).

### `GET /api/clusters`

All cluster metadata from `cluster_meta` where `method = 'default'`. No join to `papers` — `size` is precomputed and stored on `cluster_meta` by `label_clusters_default` (`labeling.py`) each time the `label` pipeline stage runs, not recomputed per request.

Returns: array of `{ cid, label, confidence, terms, size }`.

### `GET /health`

Simple liveness check. Returns `{ status: "ok" }`.

---

## Running the API

```bash
# Development (with auto-reload)
DATABASE_URL=postgresql://... aisafety-pipeline serve --reload

# Production
DATABASE_URL=postgresql://... aisafety-pipeline serve --host 0.0.0.0 --port 8000
```

The `serve` command is registered in `utils.py` and delegates to `uvicorn.run("aisafety_pipeline.api.main:app", ...)`.

API docs: `http://localhost:8000/docs`

---

## Invariants

- All routes require PostgreSQL — there is no SQLite fallback in the API
- There is no full-graph endpoint; the frontend always works with subsets or paginated paper lists
- Related papers and semantic search both require `embedding` to be populated; papers without embeddings are excluded
- Cluster ids in API responses always refer to `kmeans_cluster` values
- `GET /api/papers/related` must remain registered before `GET /api/papers/{arxiv_id:path}` in `papers.py` to avoid the catch-all route swallowing it

---

## Safe Edit Zones

Safe:
- Response field additions (additive, backwards compatible)
- Pagination defaults
- Related papers `limit` cap

Be careful around:
- pgvector operator syntax (`<=>` for cosine distance)
- Parameter order in search SQL (`query_vec` used twice)
- Route registration order in `papers.py` (`/related` before `/{arxiv_id:path}`)
- `get_conn()` — each request gets its own connection (not pooled at the application level)
- CORS origins list (affects which frontends can call the API)
