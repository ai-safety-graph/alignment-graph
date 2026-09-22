# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Active Development Mode

This project runs in **API mode**. The static JSON artifact approach (`graph.json`, `summaries.json`) is legacy and no longer the development target.

When implementing any feature:

- Assume `VITE_API_URL` is always set — all data comes from the FastAPI backend
- Do **not** add static JSON fallback paths or load from `ui/public/graph.json` / `summaries.json`
- Do **not** wrap new features in `hasApi()` guards — new features require the API
- Database is PostgreSQL + pgvector.
- Use functions in `ui/src/lib/api.ts` for all UI data fetching

## Architecture Overview

See the ARCHITECTURE.md files for full detail. Short version:

- **Pipeline** (`src/aisafety_pipeline/`) — harvests arXiv, stores in PostgreSQL, computes embeddings, tags papers
- **API** (`src/aisafety_pipeline/api/`) — FastAPI serving live data from PostgreSQL
- **UI** (`ui/`) — React/Vite frontend, fetches all data from the API

## Key Invariants

- All tag data served to the API/UI comes from the LLM classification stage (`src/aisafety_pipeline/llm_classify.py`, columns `llm_relevant`/`llm_tags` on `papers`). The older `tagging.py` zero-shot tagger (writes `paper_tags`) is legacy — still a registered CLI subcommand (`aisafety-pipeline tag`) but its output is not read by the API or UI. See `src/aisafety_pipeline/api/ARCHITECTURE.md` for the authoritative statement.
- Paper identity key is the canonical arXiv abs URL (`aid`), not the numeric `id` (which is session-assigned by index — `fetchAllPapers` for the graph, or inline in `fetchPapers` results for MobileView/StatsView)
- Compact node fields are: `id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `tags` — do not rename without coordinating across API routes and the UI
- `GET /api/papers/related` must stay registered before `GET /api/papers/{arxiv_id:path}` in `papers.py`

## Safe Edit Zones

**Usually safe:**
- UI rendering, layout, and UX
- API response field additions (additive changes)
- Pagination defaults and filter behaviour
- Pipeline internal helpers and logging

**Be careful around:**
- SQL schema changes (either backend)
- Compact graph field names
- pgvector operator syntax (`<=>`)
- CORS origins in `main.py`
- Route registration order in `papers.py`
