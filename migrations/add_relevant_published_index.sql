-- Backs /api/graph/range's keyset pages (ORDER BY published DESC, id DESC
-- over llm_relevant rows). Mirrors idx_papers_relevant_published in init_db().
-- CONCURRENTLY so the live API keeps reading; run outside a transaction.

SET lock_timeout = '5s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_papers_relevant_published
    ON public.papers (published DESC, id DESC) WHERE llm_relevant;
