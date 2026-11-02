-- Backs /api/graph/range's keyset pages (ORDER BY published DESC, id DESC
-- over llm_relevant rows). Mirrors idx_papers_relevant_published in init_db().
-- CONCURRENTLY so the live API keeps reading and writing; run outside a
-- transaction.
--
-- Run with `psql -f` on the direct DSN (not the transaction-mode pooler).
-- The SQL editor or `psql -c` sends the file as one multi-statement query,
-- which runs in an implicit transaction where CONCURRENTLY fails, and the
-- pooler may run the SET and the CREATE on different backends.
--
-- No lock_timeout: the concurrent build only takes a lock that doesn't block
-- reads or writes, but it waits out open transactions, and if that wait is
-- cut short Postgres leaves an INVALID index behind. IF NOT EXISTS (here and
-- in init_db()) only checks the name, so a re-run would then skip it and
-- range pages would quietly go back to sorting every relevant row.
--
-- After running, check the index is valid:
--   SELECT indisvalid FROM pg_index
--   WHERE indexrelid = 'idx_papers_relevant_published'::regclass;
-- If that returns false, drop it and run this file again:
--   DROP INDEX CONCURRENTLY idx_papers_relevant_published;

SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_relevant_published
    ON public.papers (published DESC, id DESC) WHERE llm_relevant;
