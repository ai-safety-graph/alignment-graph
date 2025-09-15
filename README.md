# AI Safety Pipeline

A staged pipeline for harvesting **arXiv** papers → storing in **SQLite** → generating **SPECTER2 embeddings** → applying **filters** → **clustering** → exporting **JSON** for downstream visualization.

## Features

- 🔄 OAI-PMH harvest from arXiv (`cs`, `stat`, `econ`)
- 🗄️ SQLite-backed storage (`papers_raw`, `papers`, `embeddings`, `cluster_meta`)
- 🧠 Embeddings via [SPECTER2](https://huggingface.co/allenai/specter2)
- 🧹 Two-stage filtering: regex + semantic centroid/logreg
- 📊 Clustering (k-means, agglomerative, HDBSCAN)
- 🏷️ Automatic cluster labeling (TF–IDF + semantic refinement)
- 📤 Multiple export formats:
  - Force-directed graph JSON (`export-graph`)
  - Lazy-load summaries JSON (`export-summaries`)

---

## Installation

Clone this repo and install into a virtual environment.

```bash
git clone https://github.com/yourname/aisafety-pipeline.git
cd aisafety-pipeline

# create a venv (uv or python -m venv both work)
uv venv
source .venv/bin/activate

# install dependencies
uv pip install -e .

# install PyTorch separately (choose your platform / CUDA build)
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
```

## CLI Usage

After installation, the CLI is available as:
`aisafety-pipeline --help`

### Common workflow

**1. Harvest arXiv metadata into SQLite**
`aisafety-pipeline harvest --from 2024-01-01 --until 2024-12-31 --db data/arxiv_papers.db`

**2. Regex / keyword stage-1 filter**
`aisafety-pipeline stage1 --db data/arxiv_papers.db`

**3. Generate embeddings (SPECTER2)**
`aisafety-pipeline embed --db data/arxiv_papers.db --device auto`

**4. Stage-2 semantic filter (centroid with seeds)**
`aisafety-pipeline filter --db data/arxiv_papers.db --method centroid --seeds seeds.txt --tau 0.92`

**5. Cluster the kept Papers**
`aisafety-pipeline cluster --db data/arxiv_papers.db --kmeans 8 --agg 8 --hdbscan-min 5`

**6. Auto-label clusters**
`aisafety-pipeline label --db data/arxiv_papers.db`

**7. Export**

- Force-directed graph JSON (for react-force-graph):
  `aisafety-pipeline export-graph --db data/arxiv_papers.db --out ui/public/graph.json --coords fr`

- Lazy-load paper summaries JSON:
  `isafety-pipeline export-summaries --db data/arxiv_papers.db --out ui/public/summaries.json`

## Development

- Code is organized in a package under src/aisafety_pipeline/

- CLI entry point lives in utils.py

- Run without installation via:
  `python -m aisafety_pipeline.utils --help`

## Reproducing the results (date window & seeds)

This repo’s seeds.txt contains arXiv papers from 2024-08-01 → 2025-08-01.
To recreate the same behavior of the stage-2 centroid filter (using those seeds), you need to harvest and embed papers from that exact window before running `filter`. Otherwise make sure to use seeds which are definitely acquired from your harvest.
