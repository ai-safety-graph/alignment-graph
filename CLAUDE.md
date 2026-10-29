# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Active Development Mode

This project runs in **API mode**. The static JSON artifact approach (`graph.json`, `summaries.json`) is legacy and no longer the development target.

When implementing any feature:

- Assume `VITE_API_URL` is always set — all data comes from the FastAPI backend
- Do **not** add static JSON fallback paths or load from `ui/public/graph.json` / `summaries.json`
- Do **not** reintroduce API-presence guards (the old `hasApi()` helper has been removed) — new features require the API
- Database is PostgreSQL + pgvector.
- Use functions in `ui/src/lib/api.ts` for all UI data fetching

## Architecture Overview

See the ARCHITECTURE.md files for full detail. Short version:

- **Pipeline** (`src/aisafety_pipeline/`) — harvests arXiv into PostgreSQL, filters (regex stage 1 + semantic stage 2), embeds (SPECTER2 + BGE topic), LLM-classifies/tags, and computes the graph layout
- **API** (`src/aisafety_pipeline/api/`) — FastAPI serving live data from PostgreSQL
- **UI** (`ui/`) — React/Vite frontend, fetches all data from the API

## Key Invariants

- All tag data served to the API/UI comes from the LLM classification stage (`src/aisafety_pipeline/llm_classify.py`, columns `llm_relevant`/`llm_tags` on `papers`). The older zero-shot `tagging.py` module and its `paper_tags` table have been removed from the codebase, and the table has been dropped from the database (`migrations/drop_paper_tags.sql`). See `src/aisafety_pipeline/api/ARCHITECTURE.md` for the authoritative statement.
- Paper identity key is the canonical arXiv abs URL (`aid`), not the numeric `id`. `id` is session-assigned by index: server-side only in graph responses (`/api/graph/subset`, `/api/graph/range`, via `_graph_from_rows` in `graph.py`); for `/api/papers`, `/api/search` and `/api/papers/related` results the UI assigns it client-side (`usePaperBrowser`, `GraphView` search, `useRelatedPapers`)
- Compact node fields are: `id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `tags` — do not rename without coordinating across API routes and the UI. Graph nodes additionally carry `x`/`y` (canvas) and `rx`/`ry` (raw layout coords); the single-paper endpoint adds `sm` (summary) and `lr` (LLM relevance reason), search adds `sim`, and related adds `sim`/`rx`/`ry`
- Two embedding columns with different jobs: `papers.embedding` (SPECTER2) powers related papers and stage-2 filtering; `papers.embedding_topic` (BGE) powers semantic search and the graph layout
- `GET /api/papers/related` must stay registered before `GET /api/papers/{arxiv_id:path}` in `papers.py`

## Safe Edit Zones

**Usually safe:**
- UI rendering, layout, and UX
- API response field additions (additive changes)
- Pagination defaults and filter behaviour
- Pipeline internal helpers and logging

**Be careful around:**
- SQL schema changes (`init_db()` in `db.py` is the schema source of truth; one-off migrations live in `migrations/`)
- Compact graph field names
- pgvector operator syntax (`<=>`)
- CORS origins (defined in `config.py` / `CORS_ORIGINS` env, applied in `main.py`)
- Route registration order in `papers.py`

## Code Review

PRs are reviewed with `/review-pr` (`.claude/skills/review-pr/SKILL.md`). The risk paths and invariants it escalates on live in `.claude/review-rules.md`; keep that file in sync when the invariants or safe-edit zones above change.
