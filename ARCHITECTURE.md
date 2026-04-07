# Repository Architecture

## Purpose

This repository builds an AI-safety literature exploration system with two major parts:

1. A **Python pipeline** that harvests arXiv metadata, stores it in SQLite, computes embeddings, filters papers, clusters them, labels clusters, and exports frontend-ready JSON artifacts.
2. A **React/Vite UI** that consumes those exported artifacts to render either a desktop graph view or a mobile-friendly paper view.

The overall system is a **producer → artifact → visualization** architecture.

---

## High-Level Data Flow

```text
arXiv OAI-PMH
  -> papers_raw (SQLite ingest table)
  -> papers (working set / pipeline state)
  -> embeddings (SPECTER2 vectors)
  -> stage-2 keep / reject decisions
  -> clustering assignments
  -> cluster labels
  -> export_graph.py      -> ui/public/graph.json
  -> export_summaries.py  -> ui/public/summaries.json
  -> Vite/Netlify frontend
```

Canonical CLI flow from the README:

```bash
aisafety-pipeline harvest
aisafety-pipeline stage1
aisafety-pipeline embed
aisafety-pipeline filter
aisafety-pipeline cluster
aisafety-pipeline label
aisafety-pipeline export-graph
aisafety-pipeline export-summaries
```

---

## Major Subsystems

### `src/aisafety_pipeline/`

Primary backend package. Owns:

- arXiv/OAI harvesting
- SQLite persistence
- embedding generation
- filtering
- clustering
- cluster labeling
- artifact export

See `src/aisafety_pipeline/ARCHITECTURE.md` for module-level details.

### `ui/`

Frontend application built with Vite/React. Owns:

- choosing desktop vs mobile rendering
- loading `graph.json`
- rendering graph/list interactions
- consuming exported artifact schema

See `ui/ARCHITECTURE.md` for frontend details.

### `data/`

Runtime state and local persistence:

- `arxiv_papers.db`: SQLite database
- `last_run.txt`: harvest state/checkpointing

### `archive/`

Historical and deprecated pipeline code. This directory should be treated as reference material, not active production code.

### Root generated/runtime artifacts

Examples visible in the tree:

- `specter2_embeddings.npy`
- `specter2_ids.txt`
- `embed.log`
- `filter.log`

These appear to be operational artifacts or historical outputs, not the primary contract consumed by the current UI.

---

## Supported Execution Model

The repo is organized as a **staged CLI pipeline** rather than a monolithic application server.

The public orchestration surface is defined in `src/aisafety_pipeline/utils.py` via these commands:

- `harvest`
- `stage1`
- `embed`
- `filter`
- `cluster`
- `label`
- `export-graph`
- `export-summaries`

The CLI contract should be treated as the supported workflow for both humans and coding agents.

---

## Data and Artifact Contracts

### Primary database

The main stateful backend store is SQLite.

Key tables:

- `papers_raw`: harvested source metadata
- `papers`: working set plus pipeline annotations
- `embeddings`: vector store keyed by paper id
- `cluster_meta`: per-method cluster labels and metadata

### Frontend artifacts

The UI currently depends on exported JSON files in `ui/public/`:

- `graph.json`
- `summaries.json`

#### `graph.json`

Primary UI bootstrap artifact. Contains:

- `meta`
- `clusters`
- `nodes`
- `links`

This artifact is built from **kept, clustered papers** and is currently **k-means-centered**.

#### `summaries.json`

Secondary lookup artifact for paper summaries and metadata. Contains:

- `meta`
- `summaries`

This artifact is keyed by canonical arXiv abs URLs.

---

## Important Current Assumptions

### Cluster namespace

Although the database stores multiple clustering outputs (`kmeans_cluster`, `agg_cluster`, `hdbscan_cluster`), the current export path for both graph and summaries uses **k-means as the production cluster id** (`cid`).

### Canonical paper identity

Paper ids are treated as canonical arXiv abs URLs, e.g.:

```text
https://arxiv.org/abs/2401.01234
```

This matters for joining data across tables and artifacts.

### Reproducibility of stage-2 filtering

`seeds.txt` is tied to a specific date window. To reproduce prior filtering behavior, the harvest window and seed set must match.

---

## Deployment Model

The pipeline is run offline or locally to produce static JSON artifacts.
The UI then serves those static files via the Vite app and Netlify deployment.

This means the current system is **not** a live API-backed application. It is a **static frontend over precomputed artifacts**.

---

## Active vs Inactive Code

### Active

- `src/aisafety_pipeline/*`
- `ui/*`
- `data/arxiv_papers.db`
- `ui/public/graph.json`
- `ui/public/summaries.json`

### Inactive or legacy

- `archive/*`
- `__pycache__/*`
- virtualenv contents under `venv/`

Coding agents should prefer active package code over archive or runtime-generated files.

---

## Safe Edit Zones

AI may usually safely modify:

- documentation
- UI rendering logic
- export formatting, when coordinated with UI
- non-schema-preserving pipeline internals
- CLI help text and ergonomics

AI should be careful around:

- SQLite schema changes
- paper id normalization
- graph compact-field names
- cluster id semantics
- seed-window assumptions for filtering reproducibility
- anything in `archive/` unless intentionally reviving old logic

---

## Cross-Subsystem Risks

### 1. Artifact schema drift

If `export_graph.py` or `export_summaries.py` changes field names or key shapes, the UI may silently break.

### 2. Cluster-method mismatch

The pipeline computes multiple cluster assignments, but the current UI contract assumes k-means ids.

### 3. Identifier mismatch

The graph artifact and summaries artifact rely on stable canonical paper ids. Changing id format breaks joins.

### 4. Static artifact staleness

Because the frontend is static, code changes to the pipeline do nothing for production until fresh JSON is exported and deployed.

---

## Recommended Mental Model for AI-Assisted Coding

When editing this repository, treat it as three layers:

1. **Ingest and analysis layer** (`src/aisafety_pipeline/`)
2. **Artifact contract layer** (`graph.json`, `summaries.json`)
3. **Presentation layer** (`ui/`)

Most safe changes stay within a layer.
Cross-layer changes should only be made intentionally and documented.
