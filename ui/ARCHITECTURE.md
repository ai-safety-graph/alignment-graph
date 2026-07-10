# `ui` Architecture

## Purpose

React/Vite frontend that renders AI safety paper data.

Two renderers share one compact data model:

- **`GraphView`** (desktop) → interactive force-graph canvas with semantic search
- **`StatsView`** (mobile + `/stats`) → server-filtered, paginated paper list/browser

All data comes from the **FastAPI backend** via `lib/api.ts`. This is **API mode** (see top-level `CLAUDE.md`): `VITE_API_URL` is assumed to be set. The only remaining static-file path is the legacy `summaries.json` fallback in `lib/summaries.ts`; new features do not add static paths.

---

## Data Sources

All data comes from the FastAPI backend via `lib/api.ts`:

- `fetchClusters()` → `GET /api/clusters` — cluster labels and sizes
- `fetchStats()` → `GET /api/stats` — aggregate counts (used by `useClusterCatalog` for available domains)
- `fetchPapers(params)` → `GET /api/papers` — paginated, server-side filtered listing (used by `StatsView` via `usePaperBrowser`)
- `fetchSubgraph(ids)` → `POST /api/graph/subset` — graph data for a specific set of paper IDs (desktop `GraphView`)
- `fetchRelated(arxivId)` → `GET /api/papers/related` — on-demand nearest-neighbor lookup for paper detail panels and graph ghost nodes
- `fetchPaper(url)` → `GET /api/papers/{id}` — single paper detail including summary
- `searchPapers(query, opts)` → `POST /api/search` — semantic search (used by `GraphView`)

There is **no** `fetchAllPapers` / full-graph load anymore — the desktop graph always works with a subset (`fetchSubgraph`), and the list views paginate (`fetchPapers`).

### Legacy static fallback (`VITE_API_URL` unset)

Only `lib/summaries.ts` retains a fallback: `getSummaryByUrl()` fetches `/summaries.json` and caches it in module scope when `hasApi()` is false. Everything else requires the API. `hasApi()` from `api.ts` returns `Boolean(BASE_URL)`.

### Environment configuration

- `ui/.env.development`: `VITE_API_URL=http://localhost:8000`
- `ui/.env.production`: set to deployed API URL (Render/Railway)

---

## Top-Level Flow

```text
App.tsx (Routes)
  / route
    -> GraphView   (desktop, > 768px)
    -> StatsView   (mobile,  <= 768px)
  /stats route
    -> StatsView   (all screen sizes)
```

Both views are `lazy`-loaded. `useMediaQuery('(max-width: 768px)')` decides which renderer serves `/`. This is a **view router**, not shared responsive styling. (`MobileView` was removed — mobile users now get `StatsView`, which adapts its layout to small screens and uses `MobilePaperDetails` as a modal.)

---

## Desktop Renderer (`GraphView.tsx`)

Uses `react-force-graph-2d`. (Exported as `ArxivGraph`; the file was renamed from `Graph.tsx`.)

Responsibilities:
- Fetch subset graph via `fetchSubgraph(paperIds)` — falls back to a built-in `DEMO_PAPER_IDS` set when no `paperIds` are provided (`isDemo` flag)
- Build adjacency from subset links for neighbor highlighting
- Canvas rendering with hover/select/lock state
- Neighborhood-only edge visibility
- Semantic search via `searchPapers` (debounced `POST /api/search`, 350ms)
- On-demand related papers per selection via `fetchRelated`
- Cluster legend (`ClusterLegendOverlay`)
- Side-panel paper details (`GraphPaperDetails`)

### Ghost nodes

Beyond the loaded subset, the graph renders two kinds of transient **ghost** nodes:

- **Search ghosts** — `searchPapers` results not already in the subset
- **Related ghosts** — the selected paper's `fetchRelated` results not already on the canvas

Both are positioned by `ghostCoord()` in `GraphView.tsx`, which re-applies the **main graph's** normalisation (`meta.coords.bounds` + `meta.coords.canvas`) to each paper's raw `rx`/`ry`. This places ghosts in the same coordinate space as the loaded nodes (e.g. related papers cluster near their source) rather than each fetch using its own min/max normalisation. Papers without raw coords, or when the main graph has no `bounds`, are skipped (related ghosts) or fall back to the fetched `x`/`y` (search ghosts). Search ghosts are fetched by re-querying `fetchSubgraph` with the result `aid`s not already on the canvas.

Related ghosts use **replace-each-time** semantics: selecting a new paper swaps the related-ghost set (retaining the selected node if it is itself a related ghost); clearing the selection removes them. Ghost ids are assigned past the max existing id, and the lookup maps (`aidToId`, `byId`, `simById`) merge subset + search + related ghosts so ghosts are selectable and reachable from the side-panel "Aligned Papers" links.

Optimized for **local neighborhood exploration**, not full persistent edge display.

---

## List Renderer (`StatsView.tsx`)

Server-filtered paper browser. Serves both the `/stats` route (all sizes) and the `/` route on mobile (≤768px). Layout adapts: split-pane (list left, `StatsPaperDetails` right) on desktop; single-column list with a `MobilePaperDetails` modal on small screens.

Responsibilities:
- Paginated, server-side filtered loading via the shared `usePaperBrowser` hook (keyword `q` / `from` date / `clusters` / `domains`; infinite scroll via its `loadMore`)
- Cluster legend + available domains via the shared `useClusterCatalog` hook (one mount fetch of `fetchClusters` + `fetchStats`)
- Query debounce via `useDebouncedValue` (300ms)
- Filter state managed by the `useServerFilters` hook — changing any filter triggers a fresh fetch inside `usePaperBrowser`
- Filter UI via `FilterBar`; results rendered by `PaperList`
- Selected-paper detail via `usePaperDetail`; related papers via `useRelatedPapers`
- Breadcrumb navigation through related-paper links via `useNavHistory`
- Auto-selects the first result into the side pane on desktop only (skipped ≤768px so the modal doesn't pop open unprompted)

All filtering in this view is **server-side**. There is no semantic search here — semantic search lives only in the desktop `GraphView`.

---

## Shared Detail Surface

Three detail components share a common core props interface (`paper`, `clusters`, `onClose`, `onSelectPaper`), with per-renderer differences in how related papers are supplied:

- `GraphPaperDetails.tsx` — fixed side panel for the desktop graph view
- `StatsPaperDetails.tsx` — right pane for the stats view (desktop)
- `MobilePaperDetails.tsx` — modal used by `StatsView` on small screens

`neighbors` is typed as `{ n: NodeCompact; w: number }[]`. In `StatsView` (both its desktop and mobile detail surfaces) it comes from `useRelatedPapers`.

`GraphPaperDetails` diverges from the other two: it is **presentational**, receiving `related: RelatedPaper[]` and `relatedLoading: boolean` as props. `GraphView.tsx` owns the `fetchRelated` call (so it can also build related ghost nodes from the result) and passes the list down. Its `onSelectPaper(aid: string)` is resolved to a numeric node id via the `aidToId` map in `GraphView.tsx`; because that map includes related ghosts, clicking a related paper navigates to its on-canvas ghost.

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
- `fetchClusters()` — hits `GET /api/clusters`, returns `ClustersLegend`
- `fetchStats()` — hits `GET /api/stats`, returns `StatsResponse`
- `fetchSubgraph(ids)` — hits `POST /api/graph/subset`, returns `GraphDataCompact`
- `fetchRelated(arxivId, limit?)` — hits `GET /api/papers/related`, returns `RelatedPaper[]` (NodeCompact + `sim` + raw coords `rx`/`ry`)
- `fetchPaper(arxivUrl)` — hits `/api/papers/{id}`, returns `PaperDetail | null` (module-level `paperCache` memoises by id)
- `searchPapers(query, opts)` — hits `POST /api/search`, returns `SearchResponse` (`sim` may be `null`)
- `fetchPapers(params)` — hits `GET /api/papers` with optional `q`, `from`, `to`, `clusters: number[]`, `domains: string[]`, `page`, `limit`; returns `PaginatedPapers`; used by `StatsView` (via `usePaperBrowser`) for server-side filtered pagination

---

## Critical Invariants

### Compact schema is the contract

Do not rename compact fields without updating `export_graph.py` and API route responses.

### `cid` means k-means cluster id

Inherited from the backend exporter. Changing this requires coordinated backend and frontend changes.

### `ghostCoord()` must mirror the backend subset normalisation

`ghostCoord()` in `GraphView.tsx` replicates the canvas-mapping formula in `graph.py`'s `_build_subgraph` (`PAD + (raw - min) / range * (CANVAS - 2*PAD)`). If the backend changes how it normalises `graph_x/y`, or the meaning of `meta.coords.bounds` / `canvas`, this helper must change in lockstep or ghost nodes will be misplaced relative to the loaded subset.

### Numeric `id` is graph-local; `aid` is the durable key

In `GraphView`, numeric `id` is assigned by `_build_subgraph` (subset index) and extended for ghost nodes past the max existing id. It is only meaningful within a single graph session; selection, adjacency and the `aidToId`/`byId`/`simById` maps run on it.

`StatsView` selects papers by `aid` (`selectedId: string | null`), not by numeric `id`. `useRelatedPapers` returns results keyed by `aid` directly from the API — no `aidToId` map is needed. Clicking a related paper always works regardless of whether it is in the currently-loaded page. `aid` (the canonical arXiv abs URL) is the persistent identifier across the whole app.

### Search quality depends on `sm`

Both renderers use `sm` (summary) when present. Graph exports without summaries reduce keyword search quality.

### Summary lookup depends on canonical URLs

`lib/summaries.ts` strips hashes/query strings and indexes by both JSON key and `ln` field.

### `hasApi()` gates the legacy summary fallback only

The app runs in API mode. `hasApi()` now only switches `lib/summaries.ts` between the live `fetchPaper()` path and the legacy `/summaries.json` fallback. The graph and list views require the API and will fail to load without it.

---

## Safe Edit Rules

Usually safe:
- Renderer UX and layout
- Overlay composition
- Pagination and filter behavior in `StatsView`
- Detail panel presentation
- `fetchRelated` limit default

High-risk:
- Compact graph field names (`t`, `au`, `pd`, etc.)
- Summary URL canonicalization in `lib/summaries.ts`
- `hasApi()` guard logic
- `useServerFilters` signature — takes `clusters: ClustersLegend`; returns `activeCids: Set<number>`, `activeDomains: Set<string>`, `fromDate`, `datePreset`/`setDatePreset`, `clusterEntries`, `hasActiveFilters`, and toggle/clear functions; changing any value triggers a server re-fetch in `usePaperBrowser` callers
- `GraphDataCompact` typing changes

---

## Recommended AI Mental Model

Four layers:

1. **API loading** (`lib/api.ts`, `lib/summaries.ts`)
2. **Shared data derivation** (`buildAdjacency`, `useServerFilters`, `usePaperSummary`, `useRelatedPapers`, `useClusterCatalog`, `useDebouncedValue`, `usePaperBrowser`, `usePaperDetail`, `useNavHistory`)
3. **View routing** (`App.tsx` media query split)
4. **Renderer-specific UX** (`GraphView.tsx`, `StatsView.tsx`)

Keep data assumptions shared. Keep renderer behavior separate.
