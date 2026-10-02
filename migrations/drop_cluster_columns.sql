-- Legacy clustering stage outputs; clustering is no longer part of the pipeline.
-- No code, views, functions, indexes or policies reference them (verified 2026-10-02).
-- Applied to the Supabase project 2026-10-02.

SET lock_timeout = '5s';
ALTER TABLE public.papers DROP COLUMN IF EXISTS agg_cluster, DROP COLUMN IF EXISTS hdbscan_cluster;
