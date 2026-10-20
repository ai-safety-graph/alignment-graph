# `aisafety_pipeline.api` Architecture

## Purpose

FastAPI backend that serves live data from a PostgreSQL + pgvector database to the React frontend; it is the frontend's only data source.

Requires `DATABASE_URL` env var pointing to a PostgreSQL instance with pgvector (run `aisafety-pipeline init-db`, then the full pipeline, to populate it).

---

## Module Structure

```
src/aisafety_pipeline/api/
  __init__.py
  main.py          # FastAPI app, lifespan, CORS + rate-limit middleware, 429/503 handlers, GET /health
  deps.py          # connection pool (_BoundedPool), init_pool/close_pool, borrow_conn(), get_conn() dependency
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

`main.py`'s `lifespan` context manager:

1. Calls `init_pool()`, which raises `RuntimeError` if `DATABASE_URL` is unset — so the app fails at startup rather than per request.
2. If `ENABLE_SEMANTIC_SEARCH` is true, **warms the search embedding generator** (`_get_generator()`) so the first `/api/search` request isn't slowed by model load. Best-effort — failures are swallowed and the model loads lazily on first request instead.
3. Calls `close_pool()` on shutdown.

CORS origins come from `config.API_CORS_ORIGINS`, i.e. the comma-separated `CORS_ORIGINS` env var, defaulting to `https://alignmentgraph.com`, `https://alignment-graph.netlify.app`, `http://localhost:5173` (Vite dev) and `http://localhost:4173` (Vite preview). Credentials, all methods and all headers are allowed.

---

## Rate Limiting

Every route except `/health` is rate-limited per client IP by `slowapi` (`ratelimit.py`, wired in `main.py`):

| Limit | Default | Env var | Routes |
|---|---|---|---|
| Expensive | `30/minute` | `RATE_LIMIT_EXPENSIVE` | `/api/papers/related`, `/api/graph/subset`, `/api/graph/range`, `/api/search` |
| Default | `120/minute` | `RATE_LIMIT_DEFAULT` | everything else |

`RATE_LIMIT_ENABLED=false` turns it off (read once at import; the limit strings themselves are re-read per request). Over-limit requests get slowapi's 429 JSON response (`{"error": "Rate limit exceeded: ..."}`).

- **Client IP**: `client_ip()` uses the *leftmost* `X-Forwarded-For` entry, then the socket peer. Railway's edge (Fastly) overwrites XFF, so the leftmost entry is the real client and can't be spoofed. Do **not** use `X-Real-IP`: on Railway it holds a shared Fastly IP, which puts all users in a few shared buckets. The socket peer is Railway's proxy, so it's only a fallback for local runs. This relies on Railway's overwrite behaviour; behind a proxy that *appends* to XFF instead, the leftmost entry would be spoofable.
- **Single-process assumption**: counters are in process memory. That's accurate while the API runs as one uvicorn process in one replica. If you scale out, pass a Redis `storage_uri` to the `Limiter`, or each replica will enforce its own limit.
- **Middleware order**: `SlowAPIMiddleware` is added before `CORSMiddleware`, so CORS stays outermost and 429s carry CORS headers.
- Routes with a stricter limit use `@limiter.limit(expensive_limit)` and must take a `request: Request` parameter.

---

## Dependency

`deps.py` pools connections rather than opening one per request:
- `init_pool()` / `close_pool()` run in `main.py`'s `lifespan`, creating/closing a `ThreadedConnectionPool` (size from `config.API_DB_POOL_MIN`/`API_DB_POOL_MAX`) once for the process lifetime. `API_DB_POOL_MIN` defaults to `API_DB_POOL_MAX`, so every connection is opened at startup and kept. psycopg2's pool closes any returned connection beyond `minconn` and opens new ones while holding its lock. With `MIN=1`, concurrent requests each opened a fresh TLS connection to Supabase, one at a time (in production: p50 5.2s at 5 concurrent requests vs 0.7s with `MIN=MAX`). Don't lower it. `register_vector` is registered once per physical connection (in the pool's `_connect` override), not per request.
- Pooled connections are in **autocommit** mode (set in `_connect`, before `register_vector`). Every route only reads, so this saves the implicit `BEGIN` and the `ROLLBACK` on release, each a round trip to the database. Each statement commits on its own: a future route that needs several writes to be atomic must open a transaction explicitly.
- The pool is wrapped in `_BoundedPool`, a semaphore sized to `API_DB_POOL_MAX`. psycopg2's `ThreadedConnectionPool` raises `PoolError` immediately when every connection is borrowed, which turned bursts of more than 10 concurrent requests into 500s. With the wrapper, borrowers wait up to `config.API_DB_POOL_TIMEOUT` seconds (default 5). If none frees up they get `PoolTimeout`, which `main.py` maps to a `503` with `Retry-After: 1`.
- `borrow_conn()` (context manager) borrows a connection from the pool, wraps it via `PgConnection.from_raw()`, yields it, then rolls back (a safety net in case a request opened a transaction; with none open psycopg2 skips it without contacting the server) and returns it to the pool in `finally` — it never closes the underlying connection.
- Raises `RuntimeError` if `init_pool()` was never called (e.g. outside the app lifespan).
- Pooled connections use psycopg2's `DictCursor`, so rows support both index and key access (`meta.py` relies on `row["value"]`).

`get_conn()` is the FastAPI dependency wrapper around `borrow_conn()`. Route handlers declare `conn=Depends(get_conn)`.

---

## Search Analytics

`search_log.py` records one `search_log` row per search: normalized query text (whitespace-collapsed, lowercased, max 200 chars), `mode` (`keyword`/`semantic`), result `total`, and `has_filters`. No IPs or user identifiers.

- `GET /api/papers` logs when `q` is set **and `page == 1`** (later pages are infinite scroll of the same query). `POST /api/search` logs every call.
- Routes schedule `log_search` as a `BackgroundTasks` task, so it runs after the response is sent, on its **own** pooled connection via `borrow_conn()`, and commits (a no-op under autocommit, kept so it still works on a non-autocommit connection). It can't reuse the request's connection: in tests that is a shared connection that must never be committed.
- Failures (including `PoolTimeout`) are logged and swallowed. `SEARCH_LOG_ENABLED=false` turns it off.
- Search-as-you-type logs prefixes ("alig", "align"). `scripts/search_report.sql` filters these when reporting.
- The table is created by `init_db()`; `migrations/add_search_log.sql` is for databases created before that (and enables RLS).
- `has_filters` means any of tags/domain/from/to for keyword searches, and domain or tag for semantic searches.

Frontend product analytics (pageviews, custom events) use Umami Cloud; see `ui/src/lib/analytics.ts`.

---

## Endpoints

All endpoints gate on the LLM classification stage (`llm_classify.py`): a paper is served only if `papers.llm_relevant = TRUE`, and its tags come from `papers.llm_tags` (taxonomy names, LLM order, no scores). `ai_stage2_keep` is not read by the API; the legacy zero-shot tagger and its `paper_tags` table have been removed from the codebase and dropped from the database. Unclassified papers (`llm_relevant IS NULL`) are hidden until classified.

Response items carry no numeric `id` except graph nodes (`/subset`, `/range`); the UI assigns `id` by index for everything else.

### `POST /api/graph/subset`

Returns a compact graph for a specific list of paper IDs. See also `GET /api/graph/range` below; there is no full-graph endpoint.

Request body: `{ ids: string[] }` (1 to `_MAX_SUBSET` = 5000 IDs, sized for a month of relevant papers; otherwise 422). IDs that match no relevant paper are silently dropped; if none match, the response is an empty graph with `bounds: null`.

Response shape: `{ meta, tags, nodes: NodeCompact[], links: LinkCompact[] }`

Implementation:
- Fetches only the requested papers (must be `llm_relevant = TRUE`), newest first
- Builds a `tags` legend (`{tag: {size}}`) from each node's `llm_tags`
- Re-normalises stored `graph_x/y` coordinates to fit the 1000×700 canvas (24 px padding) for the subset — only when **every** node has stored coords; otherwise all nodes get `x = y = 0` and `meta.coords.method = "none"`
- Assigns each node's numeric `id` by index (`_graph_from_rows`)
- Returns no links (`links: []`); related papers are fetched on demand via `GET /api/papers/related`

`meta` shape: `{ model, embedding_dim, generated_at, neighbors: null, coords: { included, method: "stored-subset" | "none", canvas: {w, h, pad}, bounds }, compact: true }`.

Coordinate fields (used by the UI to align ghost nodes — see `ui/ARCHITECTURE.md`):
- Each node carries both the canvas-normalised `x`/`y` **and** the raw stored `rx`/`ry` (= `graph_x`/`graph_y`, nullable)
- `meta.coords.bounds` carries the subset's raw min/max (`x_min`, `x_max`, `y_min`, `y_max`) when every node has coords, else `null`. This lets the frontend re-apply *this* subset's normalisation to papers fetched in later calls (search / related), so they land in the same coordinate space rather than each call's own normalisation

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
- `page` (default 1, ≥ 1), `limit` (default 50, 1–200)
- `tags` — repeatable; papers matching any given tag are included (`llm_tags && %s`, array overlap)
- `domain` — repeatable; multiple values are OR-ed (`domain_tag IN (...)`)
- `from` / `to` — `published` date bounds (plain strings compared against the TEXT column; not validated, unlike `/range`)
- `q` — keyword substring match on `title`/`authors` (`ILIKE`)

Ordered by `published DESC, id` (stable across pages). `total` comes from `count(*) OVER ()` on the page query (one round trip); only a page past the end, which has no row to carry it, runs a separate `COUNT(*)`. Returns: `{ total, page, limit, items }` where items have `aid, t, au, pd, ln, dm, tags` — no `id`, coords or `sm` (summary); fetch a single paper for the summary.

### `GET /api/papers/related`

On-demand related papers for a selected paper using pgvector HNSW nearest-neighbor lookup. Registered before the catch-all `/{arxiv_id:path}` route.

Query params: `id` (arxiv ID or full URL, required), `limit` (default 10, 1–50)

Implementation:
- Reads the paper's stored SPECTER2 `embedding` vector (single row lookup); 404 `"Paper not found or has no embedding"` if missing
- SQL: `WHERE id != <self> AND llm_relevant = TRUE ... ORDER BY embedding <=> %s LIMIT %s` — served by the partial HNSW index `idx_papers_embedding_llm` in ~1–5ms
- No embedding inference at query time

Returns: an array of `{ aid, t, au, pd, ln, dm, tags, sim, rx, ry }` — `sim` is cosine similarity (0–1), `rx`/`ry` the raw stored coords (= `graph_x`/`graph_y`, nullable); no `id`. The UI uses `rx`/`ry` together with the main graph's `meta.coords.bounds` to place related papers as ghost nodes in the correct position.

### `GET /api/papers/{arxiv_id:path}`

Single paper detail. The `:path` type handles both bare IDs (`2503.01694`) and full URLs (`https://arxiv.org/abs/2503.01694`).

Returns `{ aid, t, au, pd, sm, ln, dm, tags }` (`sm` = summary), or 404 if no such paper.

### `POST /api/search`

Semantic search using pgvector ANN over the BGE topic embeddings (`embedding_topic`).

**Disabled by default**: returns 503 unless `ENABLE_SEMANTIC_SEARCH=true`. It loads a transformer model into the API process, so only self-hosted deployments that install the pipeline extras enable it; the Railway API image doesn't. `GET /health` reports the flag so the UI can hide the semantic toggle.

Request body: `{ query: str (1–1000 chars), limit: int = 20 (max 100), domain?: str, tag?: str }` — `domain` is a single exact match on `domain_tag`; `tag` matches via `= ANY(llm_tags)`.

Implementation:
- Embeds `query` with a lazily-initialized `TopicEmbeddingGenerator(batch_size=1)` singleton (`_generator`, model `config.TOPIC_EMB_MODEL` = `BAAI/bge-base-en-v1.5`) via `encode_queries`
- SQL: `SELECT ..., 1 - (embedding_topic <=> %s::vector) AS similarity FROM papers WHERE llm_relevant = TRUE AND embedding_topic IS NOT NULL ... ORDER BY embedding_topic <=> %s::vector LIMIT %s` — served by `idx_papers_embedding_topic_llm`
- Parameters: `[query_vec] + filter_params + [query_vec, limit]` — `query_vec` is passed twice, once for the SELECT similarity value and once for ORDER BY

Returns: `{ query: str, results: [{ aid, t, au, pd, ln, dm, sim, tags }] }` — `sim` is cosine similarity rounded to 4 decimals (nullable); no `id` or coords.

### `GET /api/tags`

All tag metadata, computed live from `papers.llm_tags` of `llm_relevant` papers with at least one tag (not precomputed/cached). `size` counts every paper holding the tag at any rank; `primary_size` counts only papers where it's the first-listed (i.e. `llm_tags[1]`) tag — used so pie-chart percentages sum to 100% instead of being inflated by multi-tag overlap.

`description` is the tag's entry in `taxonomy.TAXONOMY_DESCRIPTIONS` (the text the LLM classifier is given), or `null` for a tag no longer in the taxonomy; the UI's About page renders it as a glossary.

Returns: `{ [tag]: { size, primary_size, description } }`.

### `GET /api/batch/latest`

The most recent `run-all` that added papers, read from the `latest_batch` key in `pipeline_state` (written by `utils.record_latest_batch`). `added` counts papers newly classified `llm_relevant` during that run; runs that add nothing don't overwrite it. Drives the "+N papers · date" badge in the UI headers.

Returns: `{ date: "YYYY-MM-DD", added: int }`, or `null` before the first such run.

### `GET /api/batch/coverage`

Size and publication-date span of the collection (`llm_relevant` papers only), for the UI's About page.

Returns: `{ total: int, earliest: "YYYY-MM-DD" | null, latest: "YYYY-MM-DD" | null }`.

### `GET /health`

Liveness check, exempt from rate limiting. Returns `{ status: "ok", semantic_search: bool }` — the UI's `useCapabilities` reads `semantic_search` to decide whether to offer semantic search.

---

## Running the API

```bash
# Development (with auto-reload)
DATABASE_URL=postgresql://... aisafety-pipeline serve --reload

# Production-like local run
DATABASE_URL=postgresql://... aisafety-pipeline serve --host 0.0.0.0 --port 8000
```

The `serve` command is registered in `utils.py` and delegates to `uvicorn.run("aisafety_pipeline.api.main:app", ...)`; `--host`/`--port` default to `API_HOST`/`API_PORT`. The deployed Railway service doesn't use `serve`: the root `Dockerfile` runs `uvicorn aisafety_pipeline.api.main:app` directly on Railway's `$PORT`, and installs only the base dependencies (no pipeline extras), so `ENABLE_SEMANTIC_SEARCH` must stay off there.

Other env vars read by the API: `CORS_ORIGINS`, `API_DB_POOL_MAX`/`MIN`/`TIMEOUT`, `RATE_LIMIT_*`, `ENABLE_SEMANTIC_SEARCH`, `SEARCH_LOG_ENABLED` (see `config.py` and `src/aisafety_pipeline/ARCHITECTURE.md`). Booleans are true only for `1`/`true`/`yes`.

API docs: `http://localhost:8000/docs`

---

## Invariants

- All routes require PostgreSQL — there is no SQLite fallback in the API
- There is no full-graph endpoint; the frontend always works with subsets or paginated paper lists
- Related papers require `embedding` (SPECTER2) and semantic search requires `embedding_topic` (BGE); papers missing the relevant column are excluded
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
- `get_conn()` / the pool in `deps.py` — keep `API_DB_POOL_MIN` = MAX, keep pooled connections in autocommit, and keep the rollback before a connection is returned to the pool
- CORS origins list (`config.py` / `CORS_ORIGINS`; affects which frontends can call the API)
