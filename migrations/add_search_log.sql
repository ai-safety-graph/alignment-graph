-- Anonymous search analytics table written by the API (api/search_log.py).
-- Stores normalized query text, mode and result count only -- no IPs or
-- user identifiers. RLS on with no policies, like the other public tables
-- (see enable_rls.sql): only the FastAPI backend (postgres role) touches it.
--
-- Run once against the Supabase project before deploying the API change.

CREATE TABLE IF NOT EXISTS public.search_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    query TEXT NOT NULL,
    mode TEXT NOT NULL,
    total INTEGER NOT NULL,
    has_filters BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_search_log_ts ON public.search_log (ts);

ALTER TABLE public.search_log ENABLE ROW LEVEL SECURITY;
