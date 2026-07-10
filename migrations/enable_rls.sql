-- Enable RLS on public tables so Supabase's auto-generated PostgREST API
-- (used by anon/authenticated keys) cannot read or write them.
--
-- The FastAPI backend connects with the `postgres` role via DATABASE_URL,
-- which bypasses RLS by default -- this does not affect app behavior.
-- No policies are added: these tables are only meant to be reached through
-- the FastAPI backend, not Supabase's REST API, so default-deny is correct.
--
-- Run once against the Supabase project (SQL editor or psql).

ALTER TABLE public.papers_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cluster_meta ENABLE ROW LEVEL SECURITY;
