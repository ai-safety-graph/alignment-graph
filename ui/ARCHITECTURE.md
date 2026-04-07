# `ui` Architecture

## Purpose

Static React/Vite frontend that renders exported pipeline artifacts.

Two renderers share one compact data model:

- **desktop** → interactive graph canvas
- **mobile** → searchable ranked paper list

---

## Data Sources

### `graph.json`

Primary bootstrap artifact.
Loaded by both desktop and mobile.

Typed by `GraphDataCompact`.

Key structures:

- `nodes: NodeCompact[]`
- `links: LinkCompact[]`
- `clusters`
- `meta`

### `summaries.json`

Secondary lazy lookup artifact.
Used only for detail hydration.

Loaded through:

```text
PaperDetails
  -> usePaperSummary
  -> lib/summaries
  -> /summaries.json
```

`lib/summaries.ts` caches this in module scope and canonicalizes URLs.

---

## Top-Level Flow

```text
App.tsx
  -> media query split
     -> Graph.tsx
     -> MobileView.tsx
```

This is a **view router**, not shared responsive styling.

---

## Desktop Renderer

`Graph.tsx` uses `react-force-graph-2d`.

Responsibilities:

- fetch compact graph
- build adjacency
- canvas rendering
- hover/select/lock state
- neighborhood-only edge visibility
- client-side search
- cluster legend
- side-panel details

The desktop graph is optimized for:

> local neighborhood exploration

not full persistent edge display.

---

## Mobile Renderer

`MobileView.tsx` renders a graph-informed list UX.

Responsibilities:

- fetch compact graph
- build adjacency
- degree-ranked default ordering
- weighted search
- cluster chip filters
- infinite-scroll style pagination
- modal details

Mobile is intentionally:

> list-first, search-first, detail-first

---

## Shared Detail Surface

`PaperDetails.tsx` is shared by desktop and mobile.

Supports:

- `panel` variant
- `modal` variant
- lazy summary hydration
- neighbor navigation
- cluster/domain metadata

This is the shared paper-level UX contract.

---

## TypeScript Source of Truth

`lib/types.ts` defines the frontend contract.

### `NodeCompact`

Required stable fields:

- `id`
- `aid`
- `t`
- `au`
- `pd`
- `dm`
- `ln`
- `cid`

Optional:

- `sm`
- `x`
- `y`

### Important drift warning

Frontend typing for `meta.coords.method` currently omits `fr`, while backend export supports and defaults to it.

This should be fixed carefully.

---

## Critical Invariants

### Compact schema is the contract

Do not rename compact fields without updating backend export.

### `cid` means k-means cluster id

This is inherited from the backend exporter.

### Search quality depends on `sm`

Both renderers use `sm` when present.
Graph exports without summaries reduce search quality.

### Summary lookup depends on canonical URLs

`lib/summaries` strips hashes/query strings and indexes by both JSON key and `ln`.

---

## Safe Edit Rules

### Usually safe

- renderer UX
- overlay composition
- search ranking heuristics
- mobile pagination behavior
- detail presentation

### High-risk

- compact graph field names
- summary URL canonicalization
- duplicated search logic drift
- desktop/mobile data-shaping divergence
- `GraphDataCompact` typing changes

---

## Recommended AI Mental Model

Think in 4 layers:

1. artifact loading
2. shared data derivation
3. view routing
4. renderer-specific UX

Keep data assumptions shared.
Keep renderer behavior separate.
