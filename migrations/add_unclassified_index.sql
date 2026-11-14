-- Backs llm-classify's work-queue queries (the pending COUNT and the paged
-- SELECT over kept papers neither classified nor in a batch). Mirrors
-- idx_papers_unclassified in init_db(). Without it each query read the heap
-- of every stage-2-kept paper (~70k rows, ~24k pages) to find the few
-- pending ones.
--
-- CONCURRENTLY so the live API and pipeline keep writing; run outside a
-- transaction, with `psql -f` on the direct DSN (not the transaction-mode
-- pooler). See add_relevant_published_index.sql for why.
--
-- After running, check the index is valid:
--   SELECT indisvalid FROM pg_index
--   WHERE indexrelid = 'idx_papers_unclassified'::regclass;
-- If that returns false, drop it and run this file again:
--   DROP INDEX CONCURRENTLY idx_papers_unclassified;

SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_unclassified
    ON public.papers (id)
    WHERE ai_stage2_keep AND llm_classified_at IS NULL AND llm_batch_id IS NULL;
