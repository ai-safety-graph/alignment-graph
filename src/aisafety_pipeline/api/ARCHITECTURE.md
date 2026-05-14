# `aisafety_pipeline.api` Architecture

## Purpose

FastAPI backend that serves live data from a PostgreSQL + pgvector database to the React frontend. Replaces static JSON artifact loading with dynamic, queryable endpoints.

Requires `DATABASE_URL` env var pointing to a PostgreSQL instance with pgvector and a fully-migrated schema (run `migrations/sqlite_to_postgres.py` first, then the full pipeline).

---

## Module Structure

```
src/aisafety_pipeline/api/
  __init__.py
  main.py          # FastAPI app, CORS, lifespan
  deps.py          # get_conn() dependency (yields PgConnection per request)
  routes/
    graph.py       # GET /api/graph
    papers.py      # GET /api/papers, GET /api/papers/{arxiv_id:path}
    search.py      # POST /api/search
    clusters.py    # GET /api/clusters
    stats.py       # GET /api/stats
```

---

## Startup / Lifespan

`main.py` uses FastAPI's `lifespan` context manager to verify the DB connection on startup. If `DATABASE_URL` is unset the process exits at startup.

CORS origins are configured from `config.API_CORS_ORIGINS` (includes `https://alignment-graph.netlify.app` and `http://localhost:5173`).

---

## Dependency

`deps.py` defines `get_conn()`:
- Opens a fresh `PgConnection(DATABASE_URL)` per request
- Yields the connection
- Closes it in `finally`

All route handlers declare `conn: PgConnection = Depends(get_conn)`.

---

## Endpoints

### `GET /api/graph`

Returns the compact graph JSON used to bootstrap both the desktop and mobile frontends.

Response shape: `{ meta, clusters, nodes: NodeCompact[], links: LinkCompact[] }`

Implementation:
- Reads `papers` where `ai_stage2_keep AND kmeans_cluster IS NOT NULL AND graph_x IS NOT NULL`
- Reads `cluster_meta` for labels
- Builds neighbor links: for each node, finds top-k similar papers using pgvector `<=>` operator via self-join batch queries
- Assembles the same compact schema as `export_graph.py`

**In-process cache**: result stored in `_cache = {"data": None, "ts": 0.0}` with a 1-hour TTL. Cache is invalidated on server restart. This avoids re-querying pgvector on every page load.

### `GET /api/papers`

Paginated paper listing.

Query params: `page` (default 1), `limit` (default 50, max 200), `cluster` (kmeans_cluster), `domain`, `from` (date), `to` (date)

Returns: `{ total, page, limit, results: PaperSummary[] }`

### `GET /api/papers/{arxiv_id:path}`

Single paper detail. The `:path` type handles both bare IDs (`2503.01694`) and full URLs (`https://arxiv.org/abs/2503.01694`).

Returns full paper record including `summary`.

### `POST /api/search`

Semantic search using pgvector ANN.

Request body: `{ query: str, limit: int = 10, domain?: str, cluster?: int }`

Implementation:
- Embeds `query` using a lazily-initialized `EmbeddingGenerator` singleton (`_generator`)
- SQL: `SELECT ..., 1 - (embedding <=> %s::vector) AS sim FROM papers WHERE ... ORDER BY embedding <=> %s::vector LIMIT %s`
- Parameters: `[query_vec] + filter_params + [query_vec, limit]` — `query_vec` is passed twice, once for the SELECT similarity value and once for ORDER BY

Returns: `{ results: SearchResult[] }` where each result includes `sim` (cosine similarity, 0–1).

### `GET /api/clusters`

All cluster metadata from `cluster_meta` where `method = 'kmeans'`, joined with paper counts from `papers`.

Returns: `{ clusters: ClusterInfo[] }`

### `GET /api/stats`

Aggregate statistics:
- Total papers
- Domain breakdown (tech / gov / both / unknown)
- Cluster sizes
- Monthly histogram via `DATE_TRUNC('month', published)`

Returns: `{ total, by_domain, by_cluster, by_month }`

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
- Graph endpoint cache is in-process only; multiple replicas do not share cache
- Semantic search requires embeddings in `papers.embedding`; papers without embeddings are excluded from search results
- Cluster ids in API responses always refer to `kmeans_cluster` values

---

## Safe Edit Zones

Safe:
- Response field additions (additive, backwards compatible)
- Cache TTL adjustment
- Pagination defaults

Be careful around:
- pgvector operator syntax (`<=>` for cosine distance)
- Parameter order in search SQL (`query_vec` used twice)
- `get_conn()` — each request gets its own connection (not pooled at the application level)
- CORS origins list (affects which frontends can call the API)
