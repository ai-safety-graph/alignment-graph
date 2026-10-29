# Review rules

Source of truth for AI-first code review. Used by the `/review-pr` skill
(`.claude/skills/review-pr/SKILL.md`) and written so a CI review prompt can
include it unchanged. Every PR gets an AI review; a PR is **escalated** to
human verification when it trips any rule below.

## Risk paths (always escalate)

A PR that changes any of these needs a line-by-line human check, whatever
the AI review finds.

| Rule | Paths / pattern | What the human checks |
|---|---|---|
| `schema` | `src/aisafety_pipeline/db.py` (`init_db()`), `migrations/**` | Schema change is backward compatible with the live DB; a migration exists for anything `init_db()` won't apply to an existing table |
| `cors` | `src/aisafety_pipeline/config.py` (`API_CORS_ORIGINS`), `src/aisafety_pipeline/api/main.py` | Origins list and middleware order (rate limiter added before CORS so CORS stays outermost) |
| `route-order` | `src/aisafety_pipeline/api/routes/papers.py` | `GET /related` is still registered before `GET /{arxiv_id:path}` |
| `compact-fields` | Diff hunks adding, renaming or removing compact node fields (`id`, `aid`, `t`, `au`, `pd`, `dm`, `ln`, `tags`, `x`, `y`, `rx`, `ry`, `sm`, `lr`, `sim`) in `src/aisafety_pipeline/api/routes/*.py`, `ui/src/lib/types.ts`, `ui/src/lib/api.ts` | API and UI agree on every field name |
| `pgvector` | Any added or changed SQL using `<=>` | Operator, operand order and which embedding column (`embedding` vs `embedding_topic`) |
| `infra` | `.github/workflows/**`, `Dockerfile*`, `docker-compose.yml`, `netlify.toml`, `.env*` | Build/deploy still works; no secrets committed |
| `rate-limit` | `src/aisafety_pipeline/api/ratelimit.py` | Client IP still taken from the leftmost `X-Forwarded-For` (Railway's `X-Real-IP` is a shared edge IP) |

## Invariant checks (for the reviewer)

Report a violation of any of these as a finding:

- The paper identity key is `aid` (canonical arXiv abs URL), never the session-assigned numeric `id`.
- Tag data comes only from `papers.llm_relevant` / `papers.llm_tags`; nothing reads the removed `paper_tags` table or `tagging.py`.
- `papers.embedding` (SPECTER2) is for related papers and stage-2 filtering; `papers.embedding_topic` (BGE) is for semantic search and the graph layout. Don't mix them up.
- API mode only: no static JSON fallbacks (`graph.json`, `summaries.json`) and no `hasApi()`-style guards.
- UI data fetching goes through `ui/src/lib/api.ts`.
- Modules the API imports (directly or transitively) lazy-import numpy and other heavy pipeline deps; the API Docker image doesn't install them.
- DB-backed tests never point at a non-local database (see `tests/conftest.py`).

## Severity and confidence

Every finding gets a severity and a confidence:

- **Severity**: `high` (wrong data, crash, security, broken invariant), `medium` (bug in an edge case, a regression in UX), `low` (cleanup, naming, simplification).
- **Confidence**: `confirmed` (traced the code path and the failure is concrete), `plausible` (likely but not fully verified).

## Escalation rule

The verdict is **ESCALATE** if either is true:

1. The diff trips any risk-path rule.
2. Any finding is `high` severity, or any `medium`/`high` finding is only `plausible`.

Otherwise the verdict is **AI-CLEARED**: CI green plus a skim is enough to merge.

## Verdict comment template

Post one comment per PR and edit it in place on re-runs. The first line is a
marker used to find it.

```markdown
<!-- ai-review -->
## AI review: ESCALATE | AI-CLEARED

Reviewed `<head sha (short)>` against `<base>`.

### Findings
| # | Severity | Confidence | Location | Finding |
|---|---|---|---|---|
| 1 | high | confirmed | `path/to/file.py:42` | One-sentence defect and concrete failure scenario |

_(or: No findings.)_

### Human verification
_(ESCALATE only, one item per triggered rule or escalating finding)_
- [ ] **schema**: `migrations/add_x.sql`. Schema change is backward compatible with the live DB
- [ ] **Finding 1**: confirm or dismiss
```
