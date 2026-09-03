# Contributing

## Setup

See [README.md](README.md) for installing dependencies and standing up a local Postgres + pgvector database.

## Branching

Branch off `main` using a `<type>/<short-description>` name, e.g. `fix/cluster-label-skeleton-loading`, `feature/local-subgraphs`, `perf/db-pooling-and-cluster-cache`, `refactor/ui-naming`. Common types: `feature`, `fix`, `perf`, `refactor`.

Commit messages are imperative and describe the change, not the process (e.g. "Pool DB connections and cache cluster sizes to fix slow /api/clusters", not "fix bug" or "WIP").

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

The API tests exercise real routes against a real Postgres/pgvector database (no mocking — the routes rely on raw SQL and pgvector's `<=>` operator). Each test runs inside a transaction that's rolled back afterward, so nothing is ever committed — but they still read whatever rows already exist in the database within that transaction, so **don't point them at your working dev database** if it has real harvested papers in it; use a separate, empty database instead:

```bash
docker compose up -d   # starts the bundled Postgres+pgvector container
docker exec -it $(docker compose ps -q postgres) psql -U postgres -c "CREATE DATABASE aisafety_test;"

TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisafety_test uv run pytest
```

`TEST_DATABASE_URL` falls back to `DATABASE_URL` if unset — fine in CI, where the Postgres service container always starts empty, but not for local runs against a populated `aisafety` DB.

## Areas that need extra care

This project has a few invariants that aren't obvious from the code alone — see the "Key Invariants" and "Safe Edit Zones" sections of [CLAUDE.md](CLAUDE.md). In particular:

- The paper identity key is the arXiv abs URL (`aid`), not the numeric `id`, which is only assigned per-session.
- Compact graph node fields (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`) are relied on by both the API and the UI — don't rename without updating both sides.
- `GET /api/papers/related` must stay registered before `GET /api/papers/{arxiv_id:path}` in `papers.py`, or the path parameter will shadow it.
- SQL schema changes, pgvector operator syntax (`<=>`), and CORS origins in `main.py` are easy to get subtly wrong — double-check these against existing usage before changing them.

## License

By contributing, you agree your contributions will be licensed under the project's [MIT License](LICENSE).
