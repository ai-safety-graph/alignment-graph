# Contributing

## Setup

See [README.md](README.md) for installing dependencies and standing up a local Postgres + pgvector database.

## Branching

Branch off `main` using a `<type>/<short-description>` name, e.g. `fix/oai-base-url`, `feature/local-subgraphs`, `perf/db-pooling`, `refactor/ui-naming`, `docs/architecture-sweep`. Common types: `feature`, `fix`, `perf`, `refactor`, `docs`.

Commit messages are imperative and describe the change, not the process (e.g. "Point OAI_BASE at arXiv's current OAI-PMH endpoint", not "fix bug" or "WIP").

## Before opening a PR

Run the same checks CI runs:

```bash
# Python lint
uvx ruff check .

# Python tests (needs Postgres — see below)
uv sync --extra test
uv run pytest

# UI
cd ui
npm run lint
npm run test
npm run build   # also runs the TypeScript typecheck
```

CI (`.github/workflows/ci.yml`) runs all of these on every push and PR against `main`.

### Running the Python tests locally

The API tests and the pipeline `tests/pipeline/*_db.py` tests exercise real code against a real Postgres/pgvector database (no mocking — the code relies on raw SQL and pgvector's `<=>` operator). Most run inside a transaction that's rolled back afterward; a few pipeline tests (e.g. `test_incremental_stages_db.py`) need real commits and clean up their own rows instead. Either way they read whatever rows already exist in the database, so **don't point them at your working dev database** if it has real harvested papers in it; use a separate, empty database instead:

```bash
docker compose up -d   # starts the bundled Postgres+pgvector container
docker exec -it $(docker compose ps -q postgres) psql -U postgres -c "CREATE DATABASE aisafety_test;"

TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisafety_test uv run pytest
```

If `TEST_DATABASE_URL` is unset, the tests fall back to `DATABASE_URL` **only** when it points at `localhost`/`127.0.0.1`; otherwise DB-backed tests are skipped (so they can never touch a hosted production database). The fallback is fine in CI, where the Postgres service container always starts empty, but not for local runs against a populated `aisafety` DB.

## Areas that need extra care

This project has a few invariants that aren't obvious from the code alone — see the "Key Invariants" and "Safe Edit Zones" sections of [CLAUDE.md](CLAUDE.md). In particular:

- The paper identity key is the arXiv abs URL (`aid`), not the numeric `id`, which is only assigned per-session.
- Compact graph node fields (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `tags`) are relied on by both the API and the UI — don't rename without updating both sides.
- `GET /api/papers/related` must stay registered before `GET /api/papers/{arxiv_id:path}` in `papers.py`, or the path parameter will shadow it.
- SQL schema changes, pgvector operator syntax (`<=>`), and CORS origins (`config.py` / `CORS_ORIGINS`) are easy to get subtly wrong — double-check these against existing usage before changing them.

## License

By contributing, you agree your contributions will be licensed under the project's [MIT License](LICENSE).
