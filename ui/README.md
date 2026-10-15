# Alignment Graph UI

React + TypeScript + Vite frontend for [alignmentgraph.com](https://alignmentgraph.com/). It fetches everything from the FastAPI backend in `src/aisafety_pipeline/api/`. For components, data flow and invariants, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

```bash
npm install
npm run dev        # http://localhost:5173, expects the API on http://localhost:8000
```

Start the API from the repo root with `aisafety-pipeline serve --reload` (see the top-level [README](../README.md)).

## Scripts

| Script              | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Vite dev server with HMR                             |
| `npm run typecheck` | `tsc -p tsconfig.app.json --noEmit`                  |
| `npm run build`     | Runs typecheck, then `vite build` into `dist/`       |
| `npm run preview`   | Serves the production build (http://localhost:4173)  |
| `npm run lint`      | ESLint                                               |
| `npm run test`      | Vitest (jsdom, setup in `src/test/setup.ts`)         |

CI runs `lint`, `test` and `build` on Node 20.

## Environment variables

| Variable                | Where it is set                                                        | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `VITE_API_URL`          | `.env.development` (`http://localhost:8000`); Netlify env vars in prod | API base URL. Required in practice: unset means relative paths   |
| `VITE_UMAMI_WEBSITE_ID` | `.env.production`                                                      | Umami Cloud cookieless analytics; production builds only         |

## Deployment

Netlify builds from `ui/` using the root `netlify.toml`:

- Build: `npm ci && npm run build`, publish `dist`, Node 20.
- Caching: hashed `/assets/*` are cached immutably and `index.html` is `no-cache`. A missing asset returns 404 rather than the SPA shell, so stale tabs hit `vite:preloadError` and reload.
- Redirects: `alignment-graph.netlify.app` redirects with a 301 to `alignmentgraph.com`. Every other path falls back to `index.html`.
