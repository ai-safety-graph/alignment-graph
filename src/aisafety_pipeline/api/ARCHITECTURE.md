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
  ratelimit.py     # slowapi Limiter + client_ip() key function
  search_log.py    # log_search(): anonymous search analytics (search_log table)
  routes/
    graph.py       # POST /api/graph/subset, GET /api/graph/range
    papers.py      # GET /api/papers, GET /api/papers/related, GET /api/papers/{arxiv_id:path}
    search.py      # POST /api/search
    tags.py        # GET /api/tags
    meta.py        # GET /api/batch/latest, GET /api/batch/coverage
```

---

## Startup / Lifespan

`main.py` uses FastAPI's `lifespan` context manager to **warm the search embedding generator** on startup (calls `_get_generator()`), so the first `/api/search` request isn't slowed by model load. The warm-up is best-effort — failures are swallowed and the model loads lazily on first request instead. The lifespan does **not** validate `DATABASE_URL`; that check happens per-request in `get_conn()`.

CORS origins are configured from `config.API_CORS_ORIGINS` (includes `https://alignmentgraph.com`, `https://alignment-graph.netlify.app` and `http://localhost:5173`).

---

## Rate Limiting

Every route except `/health` is rate-limited per client IP by `slowapi` (`ratelimit.py`, wired in `main.py`):

| Limit | Default | Env var | Routes |
|---|---|---|---|
| Expensive | `30/minute` | `RATE_LIMIT_EXPENSIVE` | `/api/papers/related`, `/api/graph/subset`, `/api/graph/range`, `/api/search` |
| Default | `120/minute` | `RATE_LIMIT_DEFAULT` | everything else |

`RATE_LIMIT_ENABLED=false` turns it off. Over-limit requests get a 429 JSON response.

- **Client IP**: `client_ip()` uses the *leftmost* `X-Forwarded-For` entry, then the socket peer. Railway's edge (Fastly) overwrites XFF, so the leftmost entry is the real client and can't be spoofed. Do **not** use `X-Real-IP`: on Railway it holds a shared Fastly IP, which puts all users in a few shared buckets. The socket peer is Railway's proxy, so it's only a fallback for local runs. This relies on Railway's overwrite behaviour; behind a proxy that *appends* to XFF instead, the leftmost entry would be spoofable.
- **Single-process assumption**: counters are in process memory. That's accurate while the API runs as one uvicorn process in one replica. If you scale out, pass a Redis `storage_uri` to the `Limiter`, or each replica will enforce its own limit.
- **Middleware order**: `SlowAPIMiddleware` is added before `CORSMiddleware`, so CORS stays outermost and 429s carry CORS headers.
- Routes with a stricter limit use `@limiter.limit(expensive_limit)` and must take a `request: Request` parameter.

---

## Dependency

`deps.py` pools connections rather than opening one per request:
- `init_pool()` / `close_pool()` run in `main.py`'s `lifespan`, creating/closing a `ThreadedConnectionPool` (size from `config.API_DB_POOL_MIN`/`API_DB_POOL_MAX`) once for the process lifetime. `API_DB_POOL_MIN` defaults to `API_DB_POOL_MAX`, so every connection is opened at startup and kept. psycopg2's pool closes any returned connection beyond `minconn` and opens new ones while holding its lock. With `MIN=1`, concurrent requests each opened a fresh TLS connection to Supabase, one at a time (in production: p50 5.2s at 5 concurrent requests vs 0.7s with `MIN=MAX`). Don't lower it. `register_vector` is registered once per physical connection (in the pool's `_connect` override), not per request.
- The pool is wrapped in `_BoundedPool`, a semaphore sized to `API_DB_POOL_MAX`. psycopg2's `ThreadedConnectionPool` raises `PoolError` immediately when every connection is borrowed, which turned bursts of more than 10 concurrent requests into 500s. With the wrapper, borrowers wait up to `config.API_DB_POOL_TIMEOUT` seconds (default 5). If none frees up they get `PoolTimeout`, which `main.py` maps to a `503` with `Retry-After: 1`.
- `borrow_conn()` (context manager) borrows a connection from the pool, wraps it via `PgConnection.from_raw()`, yields it, then rolls back (in case a request left an open transaction) and returns it to the pool in `finally` — it never closes the underlying connection.
- Raises `RuntimeError` if the pool wasn't initialized (`DATABASE_URL` unset at startup).

`get_conn()` is the FastAPI dependency wrapper around `borrow_conn()`. Route handlers declare `conn=Depends(get_conn)`.

---

## Search Analytics

`search_log.py` records one `search_log` row per search: normalized query text (whitespace-collapsed, lowercased, max 200 chars), `mode` (`keyword`/`semantic`), result `total`, and `has_filters`. No IPs or user identifiers.

- `GET /api/papers` logs when `q` is set **and `page == 1`** (later pages are infinite scroll of the same query). `POST /api/search` logs every call.
- Routes schedule `log_search` as a `BackgroundTasks` task, so it runs after the response is sent, on its **own** pooled connection via `borrow_conn()`, and commits. It can't reuse the request's connection: `get_conn()` rolls that back on release, and in tests the shared connection must never be committed.
- Failures (including `PoolTimeout`) are logged and swallowed. `SEARCH_LOG_ENABLED=false` turns it off.
- Search-as-you-type logs prefixes ("alig", "align"). `scripts/search_report.sql` filters these when reporting.
- Prod table: `migrations/add_search_log.sql`.

Frontend product analytics (pageviews, custom events) use Umami Cloud; see `ui/src/lib/analytics.ts`.

---

## Endpoints

All endpoints gate on the LLM classification stage (`llm_classify.py`): a paper is served only if `papers.llm_relevant = TRUE`, and its tags come from `papers.llm_tags` (taxonomy names, LLM order, no scores). `ai_stage2_keep` is not read by the API; the legacy zero-shot tagger and its `paper_tags` table have been removed from the codebase and dropped from the database. Unclassified papers (`llm_relevant IS NULL`) are hidden until classified.

### `POST /api/graph/subset`

Returns a compact graph for a specific list of paper IDs. See also `GET /api/graph/range` below; there is no full-graph endpoint.

Request body: `{ ids: string[] }` (1 to `_MAX_SUBSET` = 5000 IDs, sized for a month of relevant papers; otherwise 422)

Response shape: `{ meta, tags, nodes: NodeCompact[], links: LinkCompact[] }`

Implementation:
- Fetches only the requested papers (must be `llm_relevant = TRUE`)
- Builds a `tags` legend (`{tag: {size}}`) from each node's `llm_tags`
- Re-normalises stored `graph_x/y` coordinates to fit the canvas bounds for the subset
- Returns no links (`links: []`); related papers are fetched on demand via `GET /api/papers/related`

Coordinate fields (used by the UI to align ghost nodes — see `ui/ARCHITECTURE.md`):
- Each node carries both the canvas-normalised `x`/`y` **and** the raw stored `rx`/`ry` (= `graph_x`/`graph_y`, nullable)
- `meta.coords.bounds` carries the subset's raw min/max (`x_min`, `x_max`, `y_min`, `y_max`) when coords are present, else `null`. This lets the frontend re-apply *this* subset's normalisation to papers fetched in later calls (search / related), so they land in the same coordinate space rather than each call's own normalisation

### `GET /api/graph/range`

Returns a compact graph (same shape and coordinate semantics as `/subset`) for every relevant paper published in a date range. Used by the desktop UI's default "recent papers" graph so it loads in one request instead of paginating `/api/papers` and re-posting the IDs to `/subset`.

Query params:
- `from` (required, `YYYY-MM-DD`), `to` (optional, inclusive; open-ended if omitted). Malformed dates return 422.

Implementation:
- `published` is TEXT (`YYYY-MM-DD`), so bounds are compared as ISO strings
- Newest first (`ORDER BY published DESC, id`), capped at `_MAX_SUBSET` papers
- Node/legend/coordinate building is shared with `/subset` (`_graph_from_rows`)

### `GET /api/papers`

Paginated paper listing with server-side filtering.

Query params:
- `page` (default 1), `limit` (default 50, max 200)
- `tags` — repeatable; papers matching any given tag are included (`llm_tags && %s`, array overlap)
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

Request body: `{ query: str, limit: int = 20 (max 100), domain?: str, tag?: str }`

Implementation:
- Embeds `query` using a lazily-initialized `EmbeddingGenerator` singleton (`_generator`)
- SQL: `SELECT ..., 1 - (embedding <=> %s::vector) AS sim FROM papers WHERE ... ORDER BY embedding <=> %s::vector LIMIT %s`
- Parameters: `[query_vec] + filter_params + [query_vec, limit]` — `query_vec` is passed twice, once for the SELECT similarity value and once for ORDER BY

Returns: `{ query: str, results: SearchResult[] }` where each result includes `sim` (cosine similarity, 0–1).

### `GET /api/tags`

All tag metadata, computed live from `papers.llm_tags` of `llm_relevant` papers (not precomputed/cached). `size` counts every paper holding the tag at any rank; `primary_size` counts only papers where it's the first-listed, i.e. `llm_tags[1]`) tag — used so pie-chart percentages sum to 100% instead of being inflated by multi-tag overlap.

`description` is the tag's entry in `taxonomy.TAXONOMY_DESCRIPTIONS` (the text the LLM classifier is given), or `null` for a tag no longer in the taxonomy; the UI's About page renders it as a glossary.

Returns: `{ [tag]: { size, primary_size, description } }`.

### `GET /api/batch/latest`

The most recent `run-all` that added papers, read from the `latest_batch` key in `pipeline_state` (written by `utils.record_latest_batch`). `added` counts papers newly classified `llm_relevant` during that run; runs that add nothing don't overwrite it. Drives the "+N papers · date" badge in the UI headers.

Returns: `{ date: "YYYY-MM-DD", added: int }`, or `null` before the first such run.

### `GET /api/batch/coverage`

Size and publication-date span of the collection (`llm_relevant` papers only), for the UI's About page.

Returns: `{ total: int, earliest: "YYYY-MM-DD" | null, latest: "YYYY-MM-DD" | null }`.

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
