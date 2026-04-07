# `aisafety_pipeline` Architecture

## Purpose

`src/aisafety_pipeline/` is the backend package that turns raw arXiv metadata into filtered, clustered, labeled artifacts for the frontend.

Its core job is to manage a staged literature-processing pipeline:

```text
harvest -> stage1 -> embed -> filter -> cluster -> label -> export
```

This package is CLI-driven and SQLite-backed.

---

## Module Map

### `config.py`

Central configuration constants such as:

- database path
- state-file path
- embedding model metadata
- color/logging constants

This module is the shared configuration anchor for the package.

### `db.py`

Owns SQLite connection setup and schema initialization.

Current tables:

- `papers_raw`
- `papers`
- `embeddings`
- `cluster_meta`

This module defines the persistence contract for the rest of the backend.

### `oai.py`

Harvests metadata from arXiv via OAI-PMH into `papers_raw`.

### `filters.py`

Implements filtering stages:

- **stage 1**: regex/keyword gating into `papers`
- **stage 2**: semantic filtering using centroid or logistic regression

### `embeddings.py`

Ensures SPECTER2 embeddings exist for candidate papers and provides vector encode/decode helpers.

### `clustering.py`

Assigns clusters to kept papers. The schema indicates support for:

- k-means
- agglomerative
- HDBSCAN

### `labeling.py`

Assigns cluster labels and confidence/terms into `cluster_meta`.

### `export_graph.py`

Exports frontend graph JSON from filtered + clustered papers.
This is the main producer of `ui/public/graph.json`.

### `export_summaries.py`

Exports summary lookup JSON from filtered papers.
This is the main producer of `ui/public/summaries.json`.

### `utils.py`

Defines the CLI parser and public command surface.
This is the package entrypoint for user-facing orchestration.

---

## Execution Model

The package is organized as a sequence of explicit CLI stages rather than one automatic pipeline runner.

### Canonical commands

- `harvest`
- `stage1`
- `embed`
- `filter`
- `cluster`
- `label`
- `export-graph`
- `export-summaries`

### Typical order

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

Each stage persists its outputs back into SQLite or emitted JSON artifacts.

---

## Database Architecture

## Connection model

`db.connect()` opens SQLite with foreign keys enabled:

- `PRAGMA foreign_keys = ON`

`db.init_db()` is responsible for creating all tables and indexes.

## Tables

### `papers_raw`

Source ingest table for harvested metadata.

Columns:

- `id` (primary key)
- `title`
- `authors`
- `published`
- `summary`
- `link`
- `categories`
- `updated`
- `pdf_url`

Interpretation:

- this is the raw upstream record layer
- records come from the OAI/arXiv harvest stage
- downstream stages should treat this as the raw source of truth

### `papers`

Main working-set table and pipeline state table.

Columns include:

- copied content metadata (`title`, `authors`, `published`, `summary`, `link`)
- clustering outputs:
  - `kmeans_cluster`
  - `agg_cluster`
  - `hdbscan_cluster`

- filtering outputs:
  - `ai_regex_hit`
  - `ai_sem_sim`
  - `ai_stage2_keep`
  - `ai_stage2_reason`

- semantic/domain annotation:
  - `domain_tag`

Interpretation:

- this table is not only content storage
- it is the central checkpoint for pipeline decisions and annotations

This is the most important persistence table for downstream logic.

### `embeddings`

Stores one embedding per paper.

Columns:

- `paper_id` (primary key)
- `model`
- `dim`
- `vector` (BLOB)
- `created_at`

Interpretation:

- embeddings are versioned by model name in the row metadata
- vectors are stored serialized in SQLite
- export and clustering logic rely on this table for semantic similarity

### `cluster_meta`

Stores cluster labels and related metadata.

Columns:

- `method`
- `cluster_id`
- `label`
- `confidence`
- `terms`
- `created_at`

Primary key:

- `(method, cluster_id)`

Interpretation:

- labels are method-specific, not globally attached to a cluster id number
- the same numeric cluster id under different methods may represent unrelated groups

## Current indexes

- `idx_embeddings_model`
- `idx_papers_domain_tag`

---

## Data Lifecycle

### 1. Harvest

`oai.py` writes raw upstream records into `papers_raw`.

### 2. Stage 1

`filters.py` copies or gates records into `papers` and records `ai_regex_hit`.

### 3. Embedding generation

`embeddings.py` computes SPECTER2 vectors and stores them in `embeddings`.

### 4. Stage 2 semantic filter

`filters.py` writes:

- `ai_sem_sim`
- `ai_stage2_keep`
- `ai_stage2_reason`

### 5. Clustering

`clustering.py` writes cluster assignments back into `papers`.

### 6. Labeling

`labeling.py` writes cluster labels into `cluster_meta`.

### 7. Export

Export modules read from the database and emit static JSON artifacts.

---

## Export Contract

## `export_graph.py`

This module exports the main frontend graph artifact.

### Current selection logic

It exports only rows where:

- `ai_stage2_keep = 1`
- `kmeans_cluster IS NOT NULL`

So the graph is based on **kept and clustered papers**, not the entire database.

### Current clustering assumption

Although the pipeline stores multiple cluster outputs, graph export currently uses:

- `kmeans_cluster AS cid`

This is a major architectural constraint. The exported graph is currently **k-means-specific**.

### Edge semantics

Edges are built from embedding cosine similarity using:

- top-k neighbors
- `min_sim` threshold
- optional same-cluster restriction
- optional per-cluster MST edges for connectivity

So this is a **semantic-neighbor graph**, not a citation graph.

### Compact graph schema

The compact payload contains:

- `meta`
- `clusters`
- `nodes`
- `links`

Compact node fields:

- `id`: integer graph-local node id
- `aid`: canonical paper id / arXiv abs URL
- `t`: title
- `au`: authors
- `pd`: published date
- `dm`: domain tag
- `ln`: link
- `cid`: k-means cluster id
- optional `sm`, `x`, `y`

Compact link fields:

- `s`: source integer node id
- `t`: target integer node id
- `w`: similarity weight

### Coordinates

The exporter may precompute positions using:

- FR
- UMAP
- PCA
- optional none

The CLI currently exposes `fr`, `umap`, `pca`, and `none`.

## `export_summaries.py`

This module exports a lookup-oriented summaries artifact.

### Key shape

The artifact is keyed by canonical arXiv abs URLs.

### Current default selection

By default it includes all:

- `ai_stage2_keep = 1`

It may optionally require `kmeans_cluster IS NOT NULL`, but does not require that by default.

### Record shape

Each summary record contains:

- `sm`
- optional `t`, `au`, `pd`, `ln`, `dm`, `cid`

### Relationship to graph export

- `graph.json` is optimized for rendering and graph traversal
- `summaries.json` is optimized for lazy lookup and detail display

---

## CLI Surface

`utils.py` is the supported entrypoint.

### Notable defaults

- stage-2 filter method defaults to `centroid`
- graph export defaults to `coords=fr`
- graph export defaults to compact output unless `--verbose`
- summaries export defaults to including all kept papers unless `--only-ids`

### Shared labeling helper logic

`utils.py` also contains generic-label filtering helpers such as `is_generic_phrase()`, which indicates some label post-processing is intentionally lightweight and heuristic.

---

## Invariants and Assumptions

### Canonical paper id format

Paper ids should be treated as canonical arXiv abs URLs.

### `papers` is the state table

Any change to `papers` semantics affects filtering, clustering, labeling, and export.

### Cluster labels are method-scoped

Do not assume `cluster_id=3` means the same thing across clustering methods.

### Exported `cid` currently means k-means id

Changing this requires coordinated backend and frontend changes.

### Embedding compatibility matters

`export_graph.py` expects embeddings for exported papers under the configured embedding model.
Missing embeddings are considered an error state.

---

## Safe Edit Zones

AI may usually safely modify:

- CLI help text and parser ergonomics
- internal helper functions
- export metadata fields, if UI is updated accordingly
- labeling heuristics
- logging and diagnostics

AI should be careful around:

- SQL schema changes
- foreign-key relationships
- embedding serialization format
- canonical paper id normalization
- compact graph field names
- meaning of `ai_stage2_keep`
- switching export from k-means to another cluster namespace

---

## Known Architecture Weak Points

### 1. Multi-method clustering vs single-method export

The backend stores several clustering outputs, but the frontend contract only consumes k-means-centered exports.

### 2. SQLite schema migrations are implicit

There is schema initialization but no explicit migration framework visible in the current files.

### 3. Artifact duplication is intentional but easy to misuse

Both graph and summaries exports include overlapping metadata. Changes must stay consistent across both.

### 4. Export failures occur late

Some invalid states, especially missing embeddings, are only caught at export time.

---

## Recommended Mental Model

Treat this package as four layers:

1. **Ingest** (`oai.py`, `papers_raw`)
2. **Stateful analysis** (`papers`, `embeddings`, filters, clustering, labeling)
3. **Artifact shaping** (`export_graph.py`, `export_summaries.py`)
4. **CLI orchestration** (`utils.py`)

Most changes should stay within one layer unless there is a deliberate cross-layer refactor.
