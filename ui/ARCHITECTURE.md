# `ui` Architecture

## Purpose

React/Vite frontend that renders AI safety paper data.

Two renderers share one compact data model:

- **desktop** → interactive graph canvas
- **mobile** → searchable ranked paper list with semantic search

Data is loaded from the **FastAPI backend** when `VITE_API_URL` is set, or from **static JSON artifacts** as a fallback.

---

## Data Sources

### API mode (`VITE_API_URL` is set)

All data comes from the FastAPI backend via `lib/api.ts`:

- `fetchGraph()` → `GET /api/graph` — bootstrap graph data for both renderers
- `fetchPaper(url)` → `GET /api/papers/{id}` — paper detail on demand
- `searchPapers(query, opts)` → `POST /api/search` — semantic search

### Static fallback mode (`VITE_API_URL` unset)

- `fetchGraph()` falls back to `fetch('/graph.json')`
- `getSummaryByUrl()` in `lib/summaries.ts` falls back to fetching `/summaries.json` and caching in module scope

`hasApi()` from `api.ts` returns `Boolean(VITE_API_URL)` and is used throughout components to gate API-only features.

### Environment configuration

- `ui/.env.development`: `VITE_API_URL=http://localhost:8000`
- `ui/.env.production`: set to deployed API URL (Render/Railway); leave empty to use static files

---

## Top-Level Flow

```text
App.tsx
  -> media query split
     -> Graph.tsx        (desktop)
     -> MobileView.tsx   (mobile)
```

This is a **view router**, not shared responsive styling.

---

## Desktop Renderer (`Graph.tsx`)

Uses `react-force-graph-2d`.

Responsibilities:
- Fetch compact graph via `fetchGraph()`
- Build adjacency
- Canvas rendering
- Hover/select/lock state
- Neighborhood-only edge visibility
- Client-side keyword search
- Cluster legend
- Side-panel paper details

Optimized for **local neighborhood exploration**, not full persistent edge display.

---

## Mobile Renderer (`MobileView.tsx`)

Renders a graph-informed list UX.

Responsibilities:
- Fetch compact graph via `fetchGraph()`
- Build adjacency for degree-based default ranking and neighbor display
- Keyword search (client-side, weighted by title/authors/domain/summary)
- **Semantic search** (API mode only) — debounced `POST /api/search` (400ms), toggled by Sparkles button
- Cluster/year/domain chip filters via `usePaperFilters`
- Modal paper details

`searchMode` state (`'keyword' | 'semantic'`) switches the active result set between keyword-scored nodes and API-returned `SearchResult[]`. Semantic results are cast to the same scored shape `{ n, score, deg }` via `semanticAsScored` for unified rendering in `PaperList`.

Semantic search toggle is only rendered when `hasApi()` is true.

Mobile is intentionally **list-first, search-first, detail-first**.

---

## Shared Detail Surface

`MobilePaperDetails.tsx` (and `PaperDetails.tsx` on desktop) render the detail panel/modal.

Lazy summary hydration via `lib/summaries.ts` → `usePaperSummary` hook.
In API mode, `getSummaryByUrl()` calls `fetchPaper()` and adapts the result to the `Summary` shape.
In static mode, it fetches `/summaries.json` and caches in module scope.

---

## TypeScript Source of Truth

`lib/types.ts` defines the frontend data contract.

### `NodeCompact`

Required fields: `id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`
Optional: `sm`, `x`, `y`

### `SearchResult` (from `api.ts`)

Extends the `NodeCompact`-compatible shape with `sim: number` (cosine similarity, 0–1).

### `GraphDataCompact`

Top-level artifact shape: `{ meta, clusters, nodes: NodeCompact[], links: LinkCompact[] }`

---

## `lib/api.ts`

Central API client. Key exports:

- `BASE_URL` — from `import.meta.env.VITE_API_URL`, trailing slash stripped
- `hasApi()` — `Boolean(BASE_URL)`
- `fetchGraph()` — hits `/api/graph` or falls back to `/graph.json`
- `fetchPaper(arxivUrl)` — hits `/api/papers/{id}`, returns `PaperDetail | null`
- `searchPapers(query, opts)` — hits `POST /api/search`, returns `SearchResponse`
- `fetchPapers(params)` — hits `GET /api/papers`, returns `PaginatedPapers`

---

## Critical Invariants

### Compact schema is the contract

Do not rename compact fields without updating `export_graph.py` and API route responses.

### `cid` means k-means cluster id

Inherited from the backend exporter. Changing this requires coordinated backend and frontend changes.

### Search quality depends on `sm`

Both renderers use `sm` (summary) when present. Graph exports without summaries reduce keyword search quality.

### Summary lookup depends on canonical URLs

`lib/summaries.ts` strips hashes/query strings and indexes by both JSON key and `ln` field.

### `hasApi()` gates API-only features

Semantic search, live paper detail, and paginated listing are no-ops in static mode. Components must degrade gracefully when `hasApi()` returns false.

---

## Safe Edit Rules

Usually safe:
- Renderer UX and layout
- Overlay composition
- Search ranking heuristics (keyword mode)
- Mobile pagination and filter behavior
- Detail panel presentation

High-risk:
- Compact graph field names (`t`, `au`, `pd`, etc.)
- Summary URL canonicalization in `lib/summaries.ts`
- `hasApi()` guard logic
- `semanticAsScored` cast in `MobileView.tsx` — must produce `{ n: NodeCompact, score: number, deg: number }`
- Desktop/mobile data-shaping divergence
- `GraphDataCompact` typing changes

---

## Recommended AI Mental Model

Four layers:

1. **Artifact / API loading** (`lib/api.ts`, `lib/summaries.ts`, `fetchGraph`)
2. **Shared data derivation** (`buildAdjacency`, `usePaperFilters`, `usePaperSummary`)
3. **View routing** (`App.tsx` media query split)
4. **Renderer-specific UX** (`Graph.tsx`, `MobileView.tsx`)

Keep data assumptions shared. Keep renderer behavior separate.
