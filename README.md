# AI Safety Pipeline & Visualisation

A staged pipeline for harvesting **arXiv** papers → storing in **PostgreSQL + pgvector** → generating **SPECTER2 embeddings** → applying filters → clustering → serving live via **FastAPI**.

[Live Web App](https://alignment-graph.netlify.app/)

## Features

- 🔄 OAI-PMH harvest from arXiv (`cs`, `stat`, `econ`)
- 🗄️ Storage: **PostgreSQL + pgvector**
- 🧠 Embeddings via [SPECTER2](https://huggingface.co/allenai/specter2)
- 🧹 Two-stage filtering: regex + semantic centroid/logreg
- 📊 Clustering (k-means, agglomerative, HDBSCAN)
- 🏷️ Automatic cluster labeling (TF–IDF + semantic refinement)
- 🔍 Semantic search via pgvector ANN (API mode)
- 🚀 FastAPI backend with live paper listing, detail, and semantic search endpoints
- 🗺️ 2D graph layout coordinates (UMAP/PCA) precomputed and served live from Postgres

---

## Installation

```bash
git clone https://github.com/ai-safety-graph/alignment-graph.git
cd alignment-graph

uv venv
source .venv/bin/activate

# API only (serving an already-populated database):
uv pip install -e .

# Full pipeline (harvesting, embeddings, clustering, self-hosted semantic search):
uv pip install -e ".[pipeline]"

# Install PyTorch (choose your platform / CUDA build) -- only needed for the pipeline extra
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
```

---

## Database Setup (PostgreSQL + pgvector — required)

Every pipeline command and the API require a PostgreSQL + pgvector database. Pick one:

**Option A — local, via Docker Compose (recommended for self-hosting):**

```bash
cp .env.example .env       # DATABASE_URL already points at the compose service
docker compose up -d       # starts pgvector/pgvector:pg16 on localhost:5432
```

**Option B — hosted (e.g. [Supabase](https://supabase.com), free tier, pgvector built-in):**

```bash
export DATABASE_URL=postgresql://user:password@host:5432/dbname
# or add DATABASE_URL to .env in the project root (loaded automatically)
```

Then, either way, create the schema:

```bash
aisafety-pipeline init-db
```

---

## CLI Usage

```bash
aisafety-pipeline --help
```

All commands read `DATABASE_URL` from the environment/`.env` by default; pass `--db postgresql://...` to point at a different database.

### Common workflow

**1. Harvest arXiv metadata**

```bash
aisafety-pipeline harvest --from 2024-01-01 --until 2024-12-31
```

**2. Regex / keyword stage-1 filter**

```bash
aisafety-pipeline stage1
```

**3. Generate SPECTER2 embeddings**

```bash
aisafety-pipeline embed --device auto
```

**4. Stage-2 semantic filter**

```bash
aisafety-pipeline filter --method centroid --seeds seeds.txt --tau 0.92
```

**5. Cluster**

```bash
aisafety-pipeline cluster --kmeans 8
```

**6. Auto-label clusters**

```bash
aisafety-pipeline label
```

**7a. Compute graph layout**

```bash
aisafety-pipeline compute-layout --coords umap
```

**7b. Start the API**

```bash
aisafety-pipeline serve --reload
# or with custom host/port:
aisafety-pipeline serve --host 0.0.0.0 --port 8000 --reload
```

API docs available at `http://localhost:8000/docs`.

### Configure the frontend

Set `VITE_API_URL` in `ui/.env.development` (or Netlify env vars for production):

```
VITE_API_URL=http://localhost:8000
```

---

## Development

- Pipeline code: `src/aisafety_pipeline/`
- FastAPI backend: `src/aisafety_pipeline/api/`
- CLI entrypoint: `utils.py`
- Run without install: `python -m aisafety_pipeline.utils --help`
- Frontend: `cd ui && npm install && npm run dev`

See [CONTRIBUTING.md](CONTRIBUTING.md) for branching conventions and how to run the same checks CI runs.

---

## Reproducing the results

`seeds.txt` contains arXiv papers from `2024-08-01 → 2025-08-01`.
To recreate the same stage-2 centroid filter behavior, harvest and embed papers from that exact window before running `filter`. Otherwise use seeds acquired from your own harvest window.
