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

- `fetchAllPapers()` — paginates `GET /api/papers` (200/page) and concatenates; assigns numeric `id` by index
- `fetchClusters()` → `GET /api/clusters` — cluster labels and sizes
- `fetchSubgraph(ids)` → `POST /api/graph/subset` — graph data for a specific set of paper IDs (desktop graph view)
- `fetchRelated(arxivId)` → `GET /api/papers/related` — on-demand nearest-neighbor lookup for paper details panel
- `fetchPaper(url)` → `GET /api/papers/{id}` — single paper detail including summary
- `searchPapers(query, opts)` → `POST /api/search` — semantic search

MobileView and StatsView require the API — they load all papers via `fetchAllPapers` and clusters via `fetchClusters` in parallel on mount.

### Static fallback mode (`VITE_API_URL` unset)

- `getSummaryByUrl()` in `lib/summaries.ts` falls back to fetching `/summaries.json` and caching in module scope
- The desktop graph view (`Graph.tsx`) requires `paperIds` to be passed; it renders nothing without them
- MobileView and StatsView will fail to load papers in static mode as they depend on the API

`hasApi()` from `api.ts` returns `Boolean(VITE_API_URL)` and is used throughout components to gate API-only features.

### Environment configuration

- `ui/.env.development`: `VITE_API_URL=http://localhost:8000`
- `ui/.env.production`: set to deployed API URL (Render/Railway); leave empty to use static files

---

## Top-Level Flow

```text
App.tsx
  -> media query split
     -> Graph.tsx        (desktop, /graph route)
     -> MobileView.tsx   (mobile, / route)
  -> StatsView.tsx       (/stats route, all screen sizes)
```

This is a **view router**, not shared responsive styling.

---

## Desktop Renderer (`Graph.tsx`)

Uses `react-force-graph-2d`.

Responsibilities:
- Fetch subset graph via `fetchSubgraph(paperIds)` — only renders when `paperIds` is provided
- Build adjacency from subset links for neighbor highlighting and side-panel
- Canvas rendering with hover/select/lock state
- Neighborhood-only edge visibility
- Client-side keyword search
- Cluster legend
- Side-panel paper details (`GraphPaperDetails`)

Related papers in the side panel come from the subset's adjacency (links pre-computed during subgraph build).

Optimized for **local neighborhood exploration**, not full persistent edge display.

---

## Mobile Renderer (`MobileView.tsx`)

Renders a paper list UX backed by the live API.

Responsibilities:
- Fetch all papers via `fetchAllPapers()` and clusters via `fetchClusters()` in parallel on mount
- Keyword search (client-side, weighted by title/authors/domain/summary)
- **Semantic search** (API mode only) — debounced `POST /api/search` (400ms), toggled by Sparkles button
- Cluster/year/domain chip filters via `usePaperFilters`
- Modal paper details with related papers via `useRelatedPapers`

`searchMode` state (`'keyword' | 'semantic'`) switches the active result set between keyword-scored nodes and API-returned `SearchResult[]`. Semantic results are cast to the same scored shape `{ n, score, deg }` via `semanticAsScored` for unified rendering in `PaperList`.

Semantic search toggle is only rendered when `hasApi()` is true.

Mobile is intentionally **list-first, search-first, detail-first**.

---

## Stats View (`StatsView.tsx`)

Desktop paper browser shown at `/stats`.

Responsibilities:
- Fetch all papers via `fetchAllPapers()` and clusters via `fetchClusters()` in parallel on mount
- Keyword search (client-side)
- Cluster/year/domain chip filters via `usePaperFilters`
- Split-pane layout: paper list left, detail panel right (modal on mobile)
- Related papers in detail panel via `useRelatedPapers`

---

## Shared Detail Surface

Three detail components share the same props interface (`paper`, `clusters`, `neighbors`, `onClose`, `onSelectPaper`):

- `GraphPaperDetails.tsx` — fixed side panel for desktop graph view
- `StatsPaperDetails.tsx` — right pane for stats view (desktop), modal on mobile
- `MobilePaperDetails.tsx` — modal for mobile list view

`neighbors` is typed as `{ n: NodeCompact; w: number }[]`. In `Graph.tsx` it comes from the subgraph adjacency. In `MobileView` and `StatsView` it comes from `useRelatedPapers`.

`onSelectPaper` takes `aid: string` in `StatsPaperDetails` and `MobilePaperDetails` (the paper's canonical arXiv URL). `GraphPaperDetails` still uses `onSelectPaper(id: number)` because the graph view selects by numeric node id.

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
- `fetchAllPapers()` — paginates `GET /api/papers` at 200/page, assigns `id: i` to each item, returns `NodeCompact[]`
- `fetchClusters()` — hits `GET /api/clusters`, returns `ClustersLegend`
- `fetchSubgraph(ids)` — hits `POST /api/graph/subset`, returns `GraphDataCompact`
- `fetchRelated(arxivId, limit?)` — hits `GET /api/papers/related`, returns `RelatedPaper[]` (NodeCompact + `sim`)
- `fetchPaper(arxivUrl)` — hits `/api/papers/{id}`, returns `PaperDetail | null`
- `searchPapers(query, opts)` — hits `POST /api/search`, returns `SearchResponse`
- `fetchPapers(params)` — hits `GET /api/papers`, returns `PaginatedPapers`

---

## Critical Invariants

### Compact schema is the contract

Do not rename compact fields without updating `export_graph.py` and API route responses.

### `cid` means k-means cluster id

Inherited from the backend exporter. Changing this requires coordinated backend and frontend changes.

### Numeric `id` is assigned by index, not the database

`fetchAllPapers()` assigns `id: i` (array index) to each paper. This value is only stable within a session and is used as a React `key` in some list renders. The persistent identifier is `aid` (the canonical arXiv abs URL).

`MobileView` and `StatsView` select papers by `aid` (`selectedId: string | null`), not by numeric `id`. `useRelatedPapers` returns results keyed by `aid` directly from the API — no `aidToId` map is needed. Clicking a related paper always works regardless of whether it is in the currently-loaded page.

### Search quality depends on `sm`

Both renderers use `sm` (summary) when present. Graph exports without summaries reduce keyword search quality.

### Summary lookup depends on canonical URLs

`lib/summaries.ts` strips hashes/query strings and indexes by both JSON key and `ln` field.

### `hasApi()` gates API-only features

Semantic search, live paper detail, and related papers are unavailable in static mode. MobileView and StatsView require the API and will fail to load without it.

---

## Safe Edit Rules

Usually safe:
- Renderer UX and layout
- Overlay composition
- Search ranking heuristics (keyword mode)
- Mobile pagination and filter behavior
- Detail panel presentation
- `fetchRelated` limit default

High-risk:
- Compact graph field names (`t`, `au`, `pd`, etc.)
- Summary URL canonicalization in `lib/summaries.ts`
- `hasApi()` guard logic
- `semanticAsScored` cast in `MobileView.tsx` — must produce `{ n: NodeCompact, score: number, deg: number }`
- `usePaperFilters` signature — takes `nodes: NodeCompact[] | null` and `clusters: ClustersLegend` separately (not `GraphDataCompact`)
- `GraphDataCompact` typing changes

---

## Recommended AI Mental Model

Four layers:

1. **API loading** (`lib/api.ts`, `lib/summaries.ts`)
2. **Shared data derivation** (`buildAdjacency`, `usePaperFilters`, `usePaperSummary`, `useRelatedPapers`)
3. **View routing** (`App.tsx` media query split)
4. **Renderer-specific UX** (`Graph.tsx`, `MobileView.tsx`, `StatsView.tsx`)

Keep data assumptions shared. Keep renderer behavior separate.
