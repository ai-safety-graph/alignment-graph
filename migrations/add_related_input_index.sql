-- Backs compute-related's input query (SELECT id FROM papers WHERE
-- llm_relevant AND embedding IS NOT NULL ORDER BY id), which now runs every
-- day to check whether the input changed. Mirrors idx_papers_related_input
-- in init_db(). Without it the query visits the heap of every relevant paper
-- (~23k pages).
--
-- CONCURRENTLY so the live API and pipeline keep writing; run outside a
-- transaction, with `psql -f` on the direct DSN (not the transaction-mode
-- pooler). See add_relevant_published_index.sql for why.
--
-- After running, check the index is valid:
--   SELECT indisvalid FROM pg_index
--   WHERE indexrelid = 'idx_papers_related_input'::regclass;
-- If that returns false, drop it and run this file again:
--   DROP INDEX CONCURRENTLY idx_papers_related_input;

SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_related_input
    ON public.papers (id)
    WHERE llm_relevant AND embedding IS NOT NULL;
