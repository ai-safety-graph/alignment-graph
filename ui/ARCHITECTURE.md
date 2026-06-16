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

MobileView and StatsView require the API — they load papers via paginated `fetchPapers` (server-side filtered) and clusters via `fetchClusters` on mount.

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
- Fetch subset graph via `fetchSubgraph(paperIds)` — falls back to a built-in demo set when no `paperIds` are provided
- Build adjacency from subset links for neighbor highlighting
- Canvas rendering with hover/select/lock state
- Neighborhood-only edge visibility
- Semantic search via `searchPapers` (debounced `POST /api/search`)
- On-demand related papers per selection via `fetchRelated`
- Cluster legend
- Side-panel paper details (`GraphPaperDetails`)

### Ghost nodes

Beyond the loaded subset, the graph renders two kinds of transient **ghost** nodes:

- **Search ghosts** — `searchPapers` results not already in the subset
- **Related ghosts** — the selected paper's `fetchRelated` results not already on the canvas

Both are positioned by `ghostCoord()`, which re-applies the **main graph's** normalisation (`meta.coords.bounds` + `meta.coords.canvas`) to each paper's raw `rx`/`ry`. This places ghosts in the same coordinate space as the loaded nodes (e.g. related papers cluster near their source) rather than each fetch using its own min/max normalisation. Papers without raw coords, or when the main graph has no `bounds`, are skipped (related ghosts) or fall back to the fetched `x`/`y` (search ghosts).

Related ghosts use **replace-each-time** semantics: selecting a new paper swaps the related-ghost set (retaining the selected node if it is itself a related ghost); clearing the selection removes them. Ghost ids are assigned past the max existing id, and the lookup maps (`aidToId`, `byId`, `simById`) merge subset + search + related ghosts so ghosts are selectable and reachable from the side-panel "Aligned Papers" links.

Optimized for **local neighborhood exploration**, not full persistent edge display.

---

## Mobile Renderer (`MobileView.tsx`)

Renders a paper list UX backed by the live API.

Responsibilities:
- Paginated, server-side filtered keyword loading via the shared `usePaperBrowser` hook (`q`/`from`/`clusters`/`domains`; infinite scroll via its `loadMore`). `enabled: searchMode === 'keyword'` pauses it during semantic search.
- Cluster legend + domains via `useClusterCatalog`; query debounce via `useDebouncedValue`
- Filter state managed by `useApiFilters` hook — changing any filter triggers a fresh fetch inside `usePaperBrowser`
- **Semantic search** (API mode only) — debounced `POST /api/search` (400ms), toggled by Sparkles button; cluster/domain filters applied client-side on semantic results
- Modal paper details with related papers via `useRelatedPapers`

`searchMode` state (`'keyword' | 'semantic'`) switches the active result set. In keyword mode all filtering is server-side. In semantic mode, text search hits the API and cluster/domain filters are applied client-side on the returned results. Semantic results are cast to the same scored shape `{ n, score, deg }` via `semanticAsScored` for unified rendering in `PaperList`.

Semantic search toggle is only rendered when `hasApi()` is true.

Mobile is intentionally **list-first, search-first, detail-first**.

---

## Stats View (`StatsView.tsx`)

Desktop paper browser shown at `/stats`.

Responsibilities:
- Paginated, server-side filtered loading via the shared `usePaperBrowser` hook (keyword/date/cluster/domain filters; infinite scroll via its `loadMore`)
- Cluster legend + available domains via the shared `useClusterCatalog` hook (one mount fetch of `fetchClusters` + `fetchStats`)
- Query debounce via `useDebouncedValue`
- Filter state managed by `useApiFilters` hook
- Split-pane layout: paper list left, detail panel right (modal on mobile)
- Selected-paper detail via `usePaperDetail`; related papers via `useRelatedPapers`
- Breadcrumb navigation through related-paper links via `useNavHistory`

`StatsView` and `MobileView` share their entire keyword data layer through
`useClusterCatalog` / `useDebouncedValue` / `usePaperBrowser`; the views differ
only in layout and (for Mobile) the semantic-search overlay.

---

## Shared Detail Surface

Three detail components share a common core props interface (`paper`, `clusters`, `onClose`, `onSelectPaper`), with per-renderer differences in how related papers are supplied:

- `GraphPaperDetails.tsx` — fixed side panel for desktop graph view
- `StatsPaperDetails.tsx` — right pane for stats view (desktop), modal on mobile
- `MobilePaperDetails.tsx` — modal for mobile list view

`neighbors` is typed as `{ n: NodeCompact; w: number }[]`. In `MobileView` and `StatsView` it comes from `useRelatedPapers`.

`GraphPaperDetails` diverges from the other two: it is **presentational**, receiving `related: RelatedPaper[]` and `relatedLoading: boolean` as props. `Graph.tsx` owns the `fetchRelated` call (so it can also build related ghost nodes from the result) and passes the list down. Its `onSelectPaper(aid: string)` is resolved to a numeric node id via the `aidToId` map in `Graph.tsx`; because that map includes related ghosts, clicking a related paper navigates to its on-canvas ghost.

`onSelectPaper` takes `aid: string` (the paper's canonical arXiv URL) in all three detail components.

Lazy summary hydration via `lib/summaries.ts` → `usePaperSummary` hook.
In API mode, `getSummaryByUrl()` calls `fetchPaper()` and adapts the result to the `Summary` shape.
In static mode, it fetches `/summaries.json` and caches in module scope.

---

## TypeScript Source of Truth

`lib/types.ts` defines the frontend data contract.

### `NodeCompact`

Required fields: `id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`
Optional: `sm`, `x`, `y` (canvas-normalised coords), `rx`, `ry` (raw stored `graph_x`/`graph_y`, nullable — used to place ghost nodes)

### `SearchResult` / `RelatedPaper` (from `api.ts`)

`SearchResult` extends `NodeCompact` with `sim: number` (cosine similarity, 0–1). `RelatedPaper` extends it further with `rx`/`ry` raw coords for ghost placement.

### `GraphDataCompact`

Top-level artifact shape: `{ meta, clusters, nodes: NodeCompact[], links: LinkCompact[] }`

`meta.coords` carries `included`, `method`, `canvas` (`w`/`h`/`pad`), and `bounds` (raw `x_min`/`x_max`/`y_min`/`y_max`, or `null`). `bounds` is what `ghostCoord()` uses to align ghost nodes to the loaded subset's coordinate space.

---

## `lib/api.ts`

Central API client. Key exports:

- `BASE_URL` — from `import.meta.env.VITE_API_URL`, trailing slash stripped
- `hasApi()` — `Boolean(BASE_URL)`
- `fetchAllPapers()` — paginates `GET /api/papers` at 200/page, assigns `id: i` by index, returns full `NodeCompact[]`; used by the desktop graph loader only
- `fetchClusters()` — hits `GET /api/clusters`, returns `ClustersLegend`
- `fetchSubgraph(ids)` — hits `POST /api/graph/subset`, returns `GraphDataCompact`
- `fetchRelated(arxivId, limit?)` — hits `GET /api/papers/related`, returns `RelatedPaper[]` (NodeCompact + `sim` + raw coords `rx`/`ry`)
- `fetchPaper(arxivUrl)` — hits `/api/papers/{id}`, returns `PaperDetail | null`
- `searchPapers(query, opts)` — hits `POST /api/search`, returns `SearchResponse`
- `fetchPapers(params)` — hits `GET /api/papers` with optional `q`, `from`, `clusters: number[]`, `domains: string[]`, `page`, `limit`; returns `PaginatedPapers`; used by MobileView and StatsView for server-side filtered pagination

---

## Critical Invariants

### Compact schema is the contract

Do not rename compact fields without updating `export_graph.py` and API route responses.

### `cid` means k-means cluster id

Inherited from the backend exporter. Changing this requires coordinated backend and frontend changes.

### `ghostCoord()` must mirror the backend subset normalisation

`ghostCoord()` in `Graph.tsx` replicates the canvas-mapping formula in `graph.py`'s `_build_subgraph` (`PAD + (raw - min) / range * (CANVAS - 2*PAD)`). If the backend changes how it normalises `graph_x/y`, or the meaning of `meta.coords.bounds` / `canvas`, this helper must change in lockstep or ghost nodes will be misplaced relative to the loaded subset.

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
- `useApiFilters` signature — takes `clusters: ClustersLegend`; returns `activeCids: Set<number>`, `activeDomains: Set<string>`, `fromDate`, and toggle/clear functions; changing any value triggers a server re-fetch in callers
- `GraphDataCompact` typing changes

---

## Recommended AI Mental Model

Four layers:

1. **API loading** (`lib/api.ts`, `lib/summaries.ts`)
2. **Shared data derivation** (`buildAdjacency`, `useApiFilters`, `usePaperSummary`, `useRelatedPapers`, `useClusterCatalog`, `useDebouncedValue`, `usePaperBrowser`, `usePaperDetail`, `useNavHistory`)
3. **View routing** (`App.tsx` media query split)
4. **Renderer-specific UX** (`Graph.tsx`, `MobileView.tsx`, `StatsView.tsx`)

Keep data assumptions shared. Keep renderer behavior separate.
