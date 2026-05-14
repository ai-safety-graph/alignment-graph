# AI Safety Pipeline & Visualisation

A staged pipeline for harvesting **arXiv** papers → storing in **SQLite or PostgreSQL** → generating **SPECTER2 embeddings** → applying filters → clustering → serving via **FastAPI** or exporting **JSON artifacts** for visualization.

[Live Web App](https://alignment-graph.netlify.app/)

## Features

- 🔄 OAI-PMH harvest from arXiv (`cs`, `stat`, `econ`)
- 🗄️ Dual-mode storage: **SQLite** (local dev) or **PostgreSQL + pgvector** (production)
- 🧠 Embeddings via [SPECTER2](https://huggingface.co/allenai/specter2)
- 🧹 Two-stage filtering: regex + semantic centroid/logreg
- 📊 Clustering (k-means, agglomerative, HDBSCAN)
- 🏷️ Automatic cluster labeling (TF–IDF + semantic refinement)
- 🔍 Semantic search via pgvector ANN (API mode)
- 🚀 FastAPI backend with live paper listing, detail, and semantic search endpoints
- 📤 Static export formats for Netlify deployment:
  - Force-directed graph JSON (`export-graph`)
  - Lazy-load summaries JSON (`export-summaries`)

---

## Installation

```bash
git clone https://github.com/yourname/aisafety-pipeline.git
cd aisafety-pipeline

uv venv
source .venv/bin/activate

uv pip install -e .

# Install PyTorch (choose your platform / CUDA build)
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
```

---

## CLI Usage

```bash
aisafety-pipeline --help
```

### Common workflow

**1. Harvest arXiv metadata**

```bash
aisafety-pipeline harvest --from 2024-01-01 --until 2024-12-31 --db data/arxiv_papers.db
```

**2. Regex / keyword stage-1 filter**

```bash
aisafety-pipeline stage1 --db data/arxiv_papers.db
```

**3. Generate SPECTER2 embeddings**

```bash
aisafety-pipeline embed --db data/arxiv_papers.db --device auto
```

**4. Stage-2 semantic filter**

```bash
aisafety-pipeline filter --db data/arxiv_papers.db --method centroid --seeds seeds.txt --tau 0.92
```

**5. Cluster**

```bash
aisafety-pipeline cluster --db data/arxiv_papers.db --kmeans 8 --agg 8 --hdbscan-min 5
```

**6. Auto-label clusters**

```bash
aisafety-pipeline label --db data/arxiv_papers.db
```

**7a. Export static artifacts (static / Netlify mode)**

```bash
aisafety-pipeline export-graph --db data/arxiv_papers.db --out ui/public/graph.json --coords fr
aisafety-pipeline export-summaries --db data/arxiv_papers.db --out ui/public/summaries.json
```

**7b. Start the API (PostgreSQL mode)**

```bash
DATABASE_URL=postgresql://... aisafety-pipeline serve --reload
```

---

## PostgreSQL + pgvector Setup (API mode)

### 1. Provision PostgreSQL with pgvector

Use [Supabase](https://supabase.com) (free tier, pgvector built-in) or a local Docker instance:

```bash
docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 pgvector/pgvector:pg16
```

### 2. Set environment variable

```bash
export DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Or add to `.env` in the project root (loaded automatically).

### 3. Migrate existing SQLite data

```bash
python migrations/sqlite_to_postgres.py --db data/arxiv_papers.db
```

The script migrates `papers_raw`, `papers`, `cluster_meta`, and converts embedding BLOBs to pgvector format. Prints a verification table comparing SQLite vs PostgreSQL row counts.

### 4. Start the API

```bash
aisafety-pipeline serve
# or with custom host/port:
aisafety-pipeline serve --host 0.0.0.0 --port 8000 --reload
```

API docs available at `http://localhost:8000/docs`.

### 5. Configure the frontend

Set `VITE_API_URL` in `ui/.env.development` (or Netlify env vars for production):

```
VITE_API_URL=http://localhost:8000
```

Without this, the frontend falls back to static `graph.json` / `summaries.json`.

---

## Development

- Pipeline code: `src/aisafety_pipeline/`
- FastAPI backend: `src/aisafety_pipeline/api/`
- CLI entrypoint: `utils.py`
- Run without install: `python -m aisafety_pipeline.utils --help`
- Frontend: `cd ui && npm install && npm run dev`

---

## Reproducing the results

`seeds.txt` contains arXiv papers from `2024-08-01 → 2025-08-01`.
To recreate the same stage-2 centroid filter behavior, harvest and embed papers from that exact window before running `filter`. Otherwise use seeds acquired from your own harvest window.
