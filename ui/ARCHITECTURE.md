# `ui` Architecture

## Purpose

React/Vite frontend that renders AI safety paper data.

Two renderers share one compact data model:

- **`GraphView`** (desktop) → interactive force-graph canvas with keyword/semantic search and ghost nodes
- **`BrowseView`** (mobile + `/browse`) → server-filtered, paginated paper list/browser

All data comes from the **FastAPI backend** via `lib/api.ts`. This is **API mode** (see top-level `CLAUDE.md`): `VITE_API_URL` is assumed to be set. There are no static-file data paths; new features must not add any.

---

## Data Sources

All data comes from the FastAPI backend via `lib/api.ts`:

- `fetchTags()` → `GET /api/tags`: tag labels, sizes and taxonomy descriptions
- `fetchLatestBatch()` → `GET /api/batch/latest`: latest pipeline batch for the header badge
- `fetchCoverage()` → `GET /api/batch/coverage`: collection size and date span for the About page
- `fetchHealth()` → `GET /health`: backend capabilities (whether semantic search is enabled), via `useCapabilities`
- `fetchPapers(params)` → `GET /api/papers`: paginated, server-side filtered listing (used by `BrowseView` via `usePaperBrowser`, by `GraphView`'s keyword search, and by `GenerateGraphModal`'s live match count with `limit: 1`)
- `fetchSubgraph(ids)` → `POST /api/graph/subset`: graph data for a specific set of paper IDs (`GraphView` saved graphs and search ghosts, `BrowseView` saved-graph view via `useSubgraphManager`)
- `fetchGraphRange({from, to, tags, domains})` → `GET /api/graph/range`: graph of the newest (≤500) relevant papers matching a filter recipe; `meta.total` is the full match count (desktop `GraphView`'s unsaved draft graphs)
- `fetchRelated(arxivId)` → `GET /api/papers/related`: on-demand nearest-neighbor lookup for paper detail panels and graph ghost nodes
- `fetchPaper(url)` → `GET /api/papers/{id}`: single paper detail including summary
- `searchPapers(query, opts)` → `POST /api/search`: semantic search (used by `GraphView` and `BrowseView` in semantic mode)

There is **no** full-graph load. The desktop graph works with either an ID subset (`fetchSubgraph`, saved graphs) or a filter recipe (`fetchGraphRange`, drafts), and the list views paginate (`fetchPapers`).

### Environment configuration

- `VITE_API_URL`: API base URL. `ui/.env.development` sets `http://localhost:8000`. `ui/.env.production` leaves it commented out, so production builds get it from Netlify's environment variables. If it is unset, `api.ts` falls back to same-origin relative paths, which only works behind a proxy (`netlify.toml` doesn't define one).
- `VITE_UMAMI_WEBSITE_ID`: Umami Cloud website id (set in `ui/.env.production`; not a secret). Remove it to disable analytics.

---

## Top-Level Flow

```text
main.tsx
  initAnalytics(); QueryClientProvider(queryClient) > BrowserRouter > App
App.tsx (Routes)
  / route
    -> GraphView   (desktop, > 768px)
    -> BrowseView  (mobile,  <= 768px)
  /browse route
    -> BrowseView  (all screen sizes)
  /about route
    -> AboutView   (coverage, latest batch, tag glossary, privacy note)
```

All three views are `lazy`-loaded. `useMediaQuery('(max-width: 768px)')` decides which renderer serves `/`, and `App` renders a blank screen until the query resolves. This is a **view router**, not shared responsive styling. (`MobileView` was removed. Mobile users now get `BrowseView`, which adapts its layout to small screens and uses `MobilePaperDetails` as a modal.)

`main.tsx` also listens for `vite:preloadError` (a stale tab requesting chunk hashes from a previous deploy) and reloads once, rate-limited via `sessionStorage`.

---

## Desktop Renderer (`GraphView.tsx`)

Uses `react-force-graph-2d`. (Exported as `ArxivGraph`; the file was renamed from `Graph.tsx`.)

Responsibilities:
- Track the **graph source**: `none` (nothing generated yet), `draft` (an unsaved graph built from a `GraphFilters` recipe, `lib/graphFilters.ts`, optionally `basedOn` the saved graph it was edited from) or `saved`. Returning visitors land on their most recently updated saved graph; first visitors get `none` with the Generate graph modal open
- Fetch the graph: drafts via `fetchGraphRange(toRangeParams(filters))` (`['graphRange', filters]`), saved graphs via `fetchSubgraph(paperIds)` (`['subgraph', ids]`). Both normalise coordinates against corpus bounds, so saving a draft seeds its data into the subset query and the layout doesn't move
- **Generate graph** header button opens `GenerateGraphModal` (`FilterBar` over the corpus-wide `useTagCatalog` legend, seeded `useServerFilters`, debounced live match count via `['graphCount', filters]`). Generating creates a draft. While the modal is open, the graph's own Esc handler and `useGraphShortcuts` are disabled
- `DraftGraphBar` (bottom centre) on a draft: Save (name prefilled by `defaultGraphName`), or Update "<name>" / Save as new when the draft was edited from a saved graph; Edit reopens the modal with the draft's filters; Discard returns to the saved graph it came from (or the last one shown), else to `none` with the modal open
- Saved-graph dropdown, plus Edit (reopens the modal with the saved recipe, empty for graphs saved before recipes existed) and Delete (inline confirm) for the active saved graph. Add/remove of the selected paper to/from the active saved graph (`lib/storage.ts`); not offered on drafts. Empty states for `none` (Generate graph call to action) and an empty saved graph
- Build adjacency from subset links for neighbor highlighting
- Canvas rendering with hover/select/lock state. Overlapping nodes are spread apart with `separatePoints()` (`lib/graph.ts`)
- Neighborhood-only edge visibility
- Search, debounced 350ms, in two modes:
  - **keyword** (default): `fetchPapers({ q, limit: 50 })`
  - **semantic**: `searchPapers`. The toggle is shown only when `useCapabilities().semanticSearch` is true (`GET /health`)
- On-demand related papers per selection via `fetchRelated`
- Keyboard shortcuts via `useGraphShortcuts` (Ctrl/Cmd+K or `/` focuses search; Esc or Ctrl/Cmd+Backspace clears it). Force parameters via `useForceConfig`
- Side-panel paper details (`GraphPaperDetails`). Search results list in `SearchResultsOverlay`. Header has the `LatestBatchBadge` and an About link

### Ghost nodes

Beyond the loaded subset, the graph renders two kinds of transient **ghost** nodes:

- **Search ghosts**: search results not already in the subset
- **Related ghosts**: the selected paper's `fetchRelated` results not already on the canvas

Both are positioned by `ghostCoord()` in `GraphView.tsx`, which re-applies the **main graph's** normalisation (`meta.coords.bounds` + `meta.coords.canvas`) to each paper's raw `rx`/`ry`. This puts ghosts in the same coordinate space as the loaded nodes (e.g. related papers cluster near their source), instead of each fetch using its own min/max normalisation. If a paper has no raw coords, or the main graph has no `bounds`, related ghosts are skipped and search ghosts fall back to the fetched `x`/`y`. Ghost positions then go through `separatePoints()` against the existing nodes when coords are included. Search ghosts are fetched by re-querying `fetchSubgraph` with the result `aid`s not already on the canvas.

Related ghosts use **replace-each-time** semantics: selecting a new paper swaps the related-ghost set (keeping the selected node if it is itself a related ghost), and clearing the selection removes them. Ghost ids are assigned past the max existing id. The lookup maps (`aidToId`, `byId`, `simById`) merge subset + search + related ghosts, so ghosts are selectable and reachable from the side-panel "Aligned Papers" links.

Optimized for **local neighborhood exploration**, not full persistent edge display.

---

## List Renderer (`BrowseView.tsx`)

Server-filtered paper browser. Serves both the `/browse` route (all sizes) and the `/` route on mobile (≤768px). The layout adapts: split-pane on desktop (list left, `BrowsePaperDetails` right), and a single-column list with a `MobilePaperDetails` modal on small screens.

Responsibilities:
- Paginated, server-side filtered loading via the shared `usePaperBrowser` hook: keyword `q` / `from` date / `tags` / `domains`, infinite scroll via its `loadMore`, `useInfiniteQuery` keyed `['papers', ...]`
- Keyword / semantic search toggle. Semantic mode (offered only when `useCapabilities().semanticSearch`) calls `searchPapers(q, { limit: 50 })` and pauses `usePaperBrowser` (`enabled: false`)
- Saved graphs via `useSubgraphManager`: create, select and delete saved graphs, add/remove papers, and switch between browsing and a saved graph's papers (loaded with `fetchSubgraph`)
- Tags legend + available domains via the shared `useTagCatalog` hook (one fetch of `fetchTags`; domains are a hardcoded fixed set, see `useTagCatalog.ts`)
- Query debounce via `useDebouncedValue` (300ms)
- Filter state managed by the `useServerFilters` hook. Changing any filter triggers a fresh fetch inside `usePaperBrowser`
- Filter UI via `FilterBar`. Results are rendered by `PaperList`
- Selected-paper detail via `usePaperDetail`; related papers via `useRelatedPapers`
- Breadcrumb navigation through related-paper links via `useNavHistory`
- Auto-selects the first result into the side pane on desktop only (skipped ≤768px so the modal doesn't pop open unprompted)

Filtering is **server-side** when browsing. When viewing a saved graph, `useSubgraphManager` filters the already-loaded nodes client-side (query on title/authors, tags, domains).

---

## About Page (`AboutView.tsx`)

Static copy plus live data: collection coverage (`fetchCoverage`, `['coverage']`), latest batch (`useLatestBatch`), and a tag glossary from `useTagCatalog` (each tag's taxonomy `description`). Also contains the privacy note about cookieless Umami analytics.

---

## Shared Detail Surface

Three detail components share a common core props interface (`paper`, `onSelectPaper`). They differ in how related papers are supplied:

- `GraphPaperDetails.tsx`: fixed side panel for the desktop graph view
- `BrowsePaperDetails.tsx`: right pane for the browse view (desktop)
- `MobilePaperDetails.tsx`: modal used by `BrowseView` on small screens

`neighbors` is typed as `{ n: NodeCompact; w: number }[]`. In `BrowseView` (both its desktop and mobile detail surfaces) it comes from `useRelatedPapers`.

`GraphPaperDetails` differs from the other two in that it is **presentational**: it receives `related: RelatedPaper[]` and `relatedLoading: boolean` as props. `GraphView.tsx` owns the `fetchRelated` call (so it can also build related ghost nodes from the result) and passes the list down. Its `onSelectPaper(aid: string)` is resolved to a numeric node id via the `aidToId` map in `GraphView.tsx`. Because that map includes related ghosts, clicking a related paper navigates to its on-canvas ghost.

`onSelectPaper` takes `aid: string` (the paper's canonical arXiv URL) in all three detail components.

Summaries: graph nodes carry no `sm`, so `GraphPaperDetails` loads it lazily via the `usePaperSummary` hook → `lib/summaries.ts` `getSummaryByUrl()` → `fetchPaper()` (adapted to the `Summary` shape). `BrowsePaperDetails`/`MobilePaperDetails` read `sm` from the `PaperDetail` that `usePaperDetail` fetches.

---

## Client State and Caching

- **React Query** (`lib/queryClient.ts`): a single `QueryClient` with `staleTime: Infinity`. Data only changes when the pipeline runs, so a page reload is the only refresh. Query keys: `['graphRange', filters]`, `['graphCount', filters]`, `['subgraph', ids]`, `['papers', q, from, tags, domains]`, `['paper', aid]`, `['related', aid]`, `['tag-catalog']`, `['health']`, `['latest-batch']`, `['coverage']`.
- **Saved graphs** (`lib/storage.ts`): stored in `localStorage` with an id index under `ais_graphs` and each graph under `ais_graph_<id>`. Limits: 50 graphs, 500 papers per graph (≥ the backend's `_MAX_RANGE`, so a full generated graph fits), 40-character names. Graphs generated in `GraphView` also store their `filters` recipe (`GraphFilters`: tags, domains, relative `datePreset`); it's optional, so older graphs still load. Shared by `GraphView` and `useSubgraphManager`.
- **Analytics** (`lib/analytics.ts`): `initAnalytics()` injects the Umami Cloud script only in production builds with `VITE_UMAMI_WEBSITE_ID` set (`data-domains=alignmentgraph.com`). `track(event, data)` is a no-throw wrapper around `window.umami.track`. Events: `paper_open` (`view`, `source`), `search_mode` (`mode`), `filter_change` (`kind`, `value`), `graph_generate` (`tags`, `domains` counts, `date`, `mode`), `graph_save` (`kind`: `new` | `update`), `graph_edit`, `graph_discard`. Server-side search logging is separate (see `api/ARCHITECTURE.md`).

---

## TypeScript Source of Truth

`lib/types.ts` defines the frontend data contract.

### `NodeCompact`

Required fields: `id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `tags`
Optional: `sm`, `x`, `y` (canvas-normalised coords), `rx`, `ry` (raw stored `graph_x`/`graph_y`, nullable; used to place ghost nodes)

Only graph responses include `id` from the server. For `fetchPapers`, `searchPapers` and `fetchRelated` results, the UI assigns `id` by index.

### `api.ts` types

- `SearchResult` = `NodeCompact & { sim: number | null }` (cosine similarity, 0–1)
- `RelatedPaper` = `NodeCompact & { sim: number; rx; ry }` (raw coords for ghost placement)
- `PaperDetail` = `NodeCompact & { sm: string }`
- `PaginatedPapers`, `SearchResponse`, `HealthResponse`, `LatestBatch`, `Coverage`

### `GraphDataCompact`

Graph response shape: `{ meta, tags, nodes: NodeCompact[], links: LinkCompact[] }`

`meta.coords` carries `included`, `method`, `canvas` (`w`/`h`/`pad`), and `bounds` (raw `x_min`/`x_max`/`y_min`/`y_max`, or `null`). `ghostCoord()` uses `bounds` to align ghost nodes to the loaded subset's coordinate space.

---

## `lib/api.ts`

Central API client. All UI data fetching goes through it. Internals:

- `BASE_URL` (not exported): `import.meta.env.VITE_API_URL` with the trailing slash stripped. When it's empty, paths are relative
- `apiFetch()`: throws a friendly error on 429 and `API <status>` on other non-OK responses
- `withTags()`: normalises a missing `tags` field to `[]`

Exports:

- `fetchTags()`: `GET /api/tags`, returns `TagsLegend`
- `fetchSubgraph(ids)`: `POST /api/graph/subset`, returns `GraphDataCompact`
- `fetchGraphRange({ from, to? })`: `GET /api/graph/range`, returns `GraphDataCompact`
- `fetchRelated(arxivId, limit?)`: `GET /api/papers/related`, returns `RelatedPaper[]`
- `fetchPaper(arxivUrl)`: `GET /api/papers/{id}` (the id is taken from the URL's `/abs/` pathname, which drops any hash/query), returns `PaperDetail | null`. No module-level cache; caching comes from React Query in `usePaperDetail`
- `searchPapers(query, opts)`: `POST /api/search`, returns `SearchResponse` (`sim` may be `null`)
- `fetchPapers(params)`: `GET /api/papers` with optional `q`, `from`, `to`, `tags: string[]`, `domains: string[]` (sent as repeated `domain` params), `page`, `limit`; returns `PaginatedPapers`
- `fetchHealth()`, `fetchLatestBatch()`, `fetchCoverage()`

Other `lib/` modules: `graph.ts` (`buildAdjacency`, `separatePoints`, `stepAlpha`, `clamp`, `lc`), `graphFilters.ts` (`GraphFilters`, `toRangeParams`, `defaultGraphName`), `tags.ts` (`tagIcon()`, lucide icons keyed by taxonomy names, which must match `taxonomy.py`), `domain.ts` (`domainLabel()`), `summaries.ts`, `storage.ts`, `analytics.ts`, `queryClient.ts`.

---

## Critical Invariants

### Compact schema is the contract

Do not rename compact fields without updating the API route responses (`api/routes/graph.py`, `api/routes/papers.py`, `api/routes/search.py`).

### `ghostCoord()` must mirror the backend subset normalisation

`ghostCoord()` in `GraphView.tsx` reproduces the canvas-mapping formula in `graph.py`'s `_graph_from_rows` (`PAD + (raw - min) / range * (CANVAS - 2*PAD)`), which is shared by `/subset` and `/range`. One deliberate difference: for a degenerate range (≤ 1e-6) `ghostCoord` uses a scale of 1, while the backend floors the range at 1e-9. If the backend changes how it normalises `graph_x/y`, or what `meta.coords.bounds` / `canvas` mean, this helper must change at the same time or ghost nodes will be misplaced relative to the loaded subset.

### Numeric `id` is graph-local; `aid` is the durable key

In `GraphView`, the numeric `id` of loaded nodes is assigned server-side by `_graph_from_rows` (subset index). Ghost nodes get ids past the max existing id. The `id` only means something within a single graph session; selection, adjacency and the `aidToId`/`byId`/`simById` maps all use it.

`BrowseView` selects papers by `aid` (`selectedId: string | null`), not by numeric `id`. `useRelatedPapers` returns `{ n, w }` entries whose `n.id` is just the result index; identity is carried by `n.aid`, so no `aidToId` map is needed. Clicking a related paper always works, whether or not it is in the currently-loaded page. `aid` (the canonical arXiv abs URL) is the persistent identifier across the whole app.

### Keyword search is server-side

Keyword search in both views is `GET /api/papers?q=`, an `ILIKE` match on title/authors. Summaries are not searched.

---

## Safe Edit Rules

Usually safe:
- Renderer UX and layout
- Overlay composition
- Pagination and filter behavior in `BrowseView`
- Detail panel presentation
- `fetchRelated` limit default

High-risk:
- Compact graph field names (`t`, `au`, `pd`, etc.)
- The arXiv URL → id extraction in `fetchPaper` (`lib/api.ts`)
- `ghostCoord()` / `separatePoints()` coordinate handling
- `lib/storage.ts` key names (changing them orphans users' saved graphs)
- `useServerFilters` signature: takes `tags: TagsLegend` and returns `activeTags: Set<string>`, `activeDomains: Set<string>`, `fromDate`, `datePreset`/`setDatePreset`, `tagEntries`, `hasActiveFilters`, and toggle/clear functions. In `usePaperBrowser` callers (BrowseView), changing any value triggers a server re-fetch; GraphView uses it for client-side filtering only
- `GraphDataCompact` typing changes

---

## Recommended AI Mental Model

Four layers:

1. **API loading** (`lib/api.ts`, `lib/summaries.ts`, `lib/queryClient.ts`)
2. **Shared data derivation and state** (`buildAdjacency`, `useServerFilters`, `usePaperSummary`, `useRelatedPapers`, `useTagCatalog`, `useDebouncedValue`, `usePaperBrowser`, `usePaperDetail`, `useNavHistory`, `useCapabilities`, `useLatestBatch`, `useSubgraphManager`, `lib/storage.ts`)
3. **View routing** (`App.tsx` media query split via `useMediaQuery`)
4. **Renderer-specific UX** (`GraphView.tsx` + `useForceConfig`/`useGraphShortcuts`, `BrowseView.tsx`, `AboutView.tsx`, and shared components: `FilterBar`, `PaperList`, `TagChips`, `Dropdown`, `LoadingIndicator`, `LatestBatchBadge`, `SearchResultsOverlay`, `icons/`)

Keep data assumptions shared. Keep renderer behavior separate.
