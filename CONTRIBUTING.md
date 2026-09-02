# Contributing

## Setup

See [README.md](README.md) for installing dependencies and standing up a local Postgres + pgvector database.

## Branching

Branch off `main` using a `<type>/<short-description>` name, e.g. `fix/cluster-label-skeleton-loading`, `feature/local-subgraphs`, `perf/db-pooling-and-cluster-cache`, `refactor/ui-naming`. Common types: `feature`, `fix`, `perf`, `refactor`.

Commit messages are imperative and describe the change, not the process (e.g. "Pool DB connections and cache cluster sizes to fix slow /api/clusters", not "fix bug" or "WIP").

## Before opening a PR

Run the same checks CI runs:

```bash
# Python
uvx ruff check .

# UI
cd ui
npm run lint
npm run build   # also runs the TypeScript typecheck
```

CI (`.github/workflows/ci.yml`) runs both on every push and PR against `main`.

## Areas that need extra care

This project has a few invariants that aren't obvious from the code alone — see the "Key Invariants" and "Safe Edit Zones" sections of [CLAUDE.md](CLAUDE.md). In particular:

- The paper identity key is the arXiv abs URL (`aid`), not the numeric `id`, which is only assigned per-session.
- Compact graph node fields (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `cid`) are relied on by both the API and the UI — don't rename without updating both sides.
- `GET /api/papers/related` must stay registered before `GET /api/papers/{arxiv_id:path}` in `papers.py`, or the path parameter will shadow it.
- SQL schema changes, pgvector operator syntax (`<=>`), and CORS origins in `main.py` are easy to get subtly wrong — double-check these against existing usage before changing them.

## License

By contributing, you agree your contributions will be licensed under the project's [MIT License](LICENSE).
