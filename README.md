# AI Safety Pipeline & Visualisation

A staged pipeline for harvesting **arXiv** papers → storing in **PostgreSQL + pgvector** → generating **SPECTER2 embeddings** → applying filters → LLM topic tagging → peer-review detection (arXiv fields + **OpenAlex**) → BGE topic embeddings + 2-D layout → precomputed related papers → serving live via **FastAPI**.

[Live Web App](https://alignmentgraph.com/)

## Features

- 🔄 OAI-PMH harvest from arXiv (`cs`, `stat`, `econ`, `eess.SY`)
- 🗄️ Storage: **PostgreSQL + pgvector**
- 🧠 Embeddings via [SPECTER2](https://huggingface.co/allenai/specter2) (filtering, related papers) and [BGE](https://huggingface.co/BAAI/bge-base-en-v1.5) (semantic search, layout)
- 🧹 Two-stage filtering: regex + semantic seed-centroid filter
- 🏷️ LLM-based relevance + multi-label taxonomy tagging (OpenAI, sync or Batch API) — the live tag source served by the API
- 🎓 Peer-review status + venue, derived from arXiv journal-ref/DOI/comments and enriched via [OpenAlex](https://openalex.org)
- 🔗 Related papers precomputed from SPECTER2 nearest neighbours
- 🔍 Semantic search via pgvector ANN (self-hosted only; `ENABLE_SEMANTIC_SEARCH=true`)
- 🚀 FastAPI backend with live paper listing/detail, graph, related papers, authors, tags and semantic search endpoints
- 🗺️ 2D graph layout coordinates (UMAP/PCA, then incremental kNN placement) precomputed and served live from Postgres

---

## Installation

```bash
git clone https://github.com/ai-safety-graph/alignment-graph.git
cd alignment-graph

uv venv
source .venv/bin/activate

# API only (serving an already-populated database):
uv pip install -e .

# Full pipeline (harvesting, embeddings, self-hosted semantic search):
uv pip install -e ".[pipeline]"

# ...plus LLM classification (needs OPENAI_API_KEY):
uv pip install -e ".[pipeline,llm]"

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

Only scans papers harvested since the last successful `stage1` run (tracked in `pipeline_state`). Pass `--full` to rescan everything, e.g. after changing the stage-1 regexes.

**3. Generate SPECTER2 embeddings**

```bash
aisafety-pipeline embed --device auto
```

**4. Stage-2 semantic filter**

```bash
aisafety-pipeline filter --seeds seeds.txt
```

The centroid threshold defaults to 0.90 cosine similarity (`STAGE2_CENTROID_TAU` in `config.py`). It is deliberately loose, since the LLM classification stage makes the real relevance call.

Only scores papers that have no score yet (`ai_sem_sim IS NULL`). Pass `--full` to rescore everything after changing `seeds.txt` or `--tau`.

**5. Classify papers (relevance + topic tags) via LLM**

```bash
aisafety-pipeline llm-classify-run
```

This submits, waits for, and collects OpenAI Batch API jobs until every unclassified paper has `llm_relevant`/`llm_tags` set — this is what the API serves. (`llm-classify` runs synchronously instead; `llm-classify-submit` / `llm-classify-collect` split the batch flow into manual steps.)

**6. Derive peer-review status from arXiv fields**

```bash
aisafety-pipeline venue
```

Sets `peer_reviewed`, `venue` and `venue_type` for `llm_relevant` papers from their arXiv journal-ref, publisher DOI and comments (e.g. "accepted at ICLR 2026"). No signal means *unknown* (`NULL`), not "not reviewed". Incremental; pass `--full` to re-derive everything after changing the rules in `venue.py`.

**7. Enrich unknowns from OpenAlex**

```bash
aisafety-pipeline venue-enrich
```

Looks up papers `venue` left unknown in OpenAlex, which links many arXiv preprints to their published journal/conference version. Papers never checked go first; unknown papers from the last ~18 months are rechecked monthly, since acceptance often comes months after posting. Capped at `--limit` (default `OPENALEX_MAX_PER_RUN`, 5000) per run. `OPENALEX_MAILTO` and `OPENALEX_API_KEY` are optional (see `.env.example`). After changing the venue-naming rules, run `venue-enrich --refresh-names` once.

**8. Generate BGE topic embeddings for relevant papers**

```bash
aisafety-pipeline embed-topic --device auto
```

Only embeds `llm_relevant` rows — run this *after* `llm-classify-run`, not alongside `embed`. These are what `compute-layout` and semantic search use; skipping this step is why relevant papers can be missing graph coordinates.

**9. Compute graph layout**

```bash
aisafety-pipeline compute-layout --coords umap
```

By default this only places relevant papers that have no coordinates yet, each at the mean position of its nearest already-placed neighbours (`--knn-k`, default 10), so existing points don't move. Pass `--full` to refit the whole UMAP layout, e.g. monthly or after a large backfill, so new topics form their own clusters. With no layout at all yet it does a full fit automatically.

**10. Precompute related papers**

```bash
aisafety-pipeline compute-related
```

Stores the top 20 SPECTER2 neighbours of every relevant paper in `paper_related`, which `GET /api/papers/related` serves (falling back to a live pgvector search for papers not yet precomputed). Always a full recompute, but skipped entirely when the set of relevant embedded papers hasn't changed; pass `--force` after re-embedding papers in place.

**11. Start the API**

```bash
aisafety-pipeline serve --reload
# or with custom host/port:
aisafety-pipeline serve --host 0.0.0.0 --port 8000 --reload
```

API docs available at `http://localhost:8000/docs`.

### Automated/unattended runs

```bash
aisafety-pipeline run-all
```

Chains harvest → stage1 → embed → filter → llm-classify (`llm-classify-run`) → venue → venue-enrich → embed-topic → compute-layout → compute-related in that fixed order, stopping immediately on the first stage's failure. The exception is `venue-enrich`: OpenAlex is optional enrichment, so OpenAlex request errors never stop the run, but a permanent one (e.g. a bad API key) makes `run-all` exit non-zero after the last stage. This is what the scheduled Railway cron job (`Dockerfile.pipeline`) runs daily — see that file; the Railway service itself (Dockerfile path, cron schedule, restart policy) is configured in the Railway dashboard, not a config file. The harvest watermark and in-flight OpenAI batch tracking are stored in the `pipeline_state` table (not local files), so this is safe to run from a fresh container on every invocation. Pass `--skip <stage>` (repeatable, using the stage names above, e.g. `--skip llm-classify`) to omit a stage for manual recovery/debugging.

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
- Run without activating the venv: `uv run aisafety-pipeline --help`
- Architecture docs: [ARCHITECTURE.md](ARCHITECTURE.md), plus per-subsystem files in `src/aisafety_pipeline/`, `src/aisafety_pipeline/api/` and `ui/`
- Frontend: `cd ui && npm install && npm run dev`

See [CONTRIBUTING.md](CONTRIBUTING.md) for branching conventions and how to run the same checks CI runs.

---

## Reproducing the results

`seeds.txt` contains arXiv papers from `2024-08-01 → 2025-08-01`.
To recreate the same stage-2 centroid filter behavior, harvest and embed papers from that exact window before running `filter`. Otherwise use seeds acquired from your own harvest window.
