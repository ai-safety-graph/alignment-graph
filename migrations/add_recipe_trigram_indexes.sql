-- Backs the graph-recipe keyword / author filters (`~*` regexes built in
-- api/recipe.py) on /api/graph/range and /api/papers. Mirrors
-- idx_papers_text_trgm / idx_papers_authors_trgm in init_db(); the text
-- index's expression must stay identical to db.PAPER_TEXT_EXPR or the
-- planner won't use it.
--
-- Without them each filtered query scans the whole papers heap (wide rows,
-- embeddings inline): 3-11s on prod for a two-keyword count. With them, a
-- local copy of the 35k relevant papers answers in 1-15ms. Sizes there:
-- ~50 MB (text) and ~8 MB (authors).
--
-- Run with `psql -f` on the direct DSN (not the transaction-mode pooler):
-- CONCURRENTLY fails inside the implicit transaction the SQL editor or
-- `psql -c` wraps a multi-statement query in. See
-- add_relevant_published_index.sql for why there's no lock_timeout.
--
-- pg_trgm goes in the `extensions` schema like vector; it's on the
-- search_path, so `gin_trgm_ops` resolves unqualified.
--
-- After running, check both are valid:
--   SELECT indexrelid::regclass, indisvalid FROM pg_index
--   WHERE indexrelid IN ('idx_papers_text_trgm'::regclass,
--                        'idx_papers_authors_trgm'::regclass);
-- If one is false, DROP INDEX CONCURRENTLY it and run this file again.

SET statement_timeout = 0;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_text_trgm
    ON public.papers
    USING gin ((coalesce(title, '') || ' ' || coalesce(summary, '')) gin_trgm_ops)
    WHERE llm_relevant = TRUE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_authors_trgm
    ON public.papers USING gin (authors gin_trgm_ops)
    WHERE llm_relevant = TRUE;
