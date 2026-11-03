-- Last OpenAlex lookup per paper, written by the venue-enrich stage
-- (src/aisafety_pipeline/venue.py). Mirrors the _ensure_columns entry in
-- db.py; `aisafety-pipeline init-db` applies the same change.

ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS openalex_checked_at TIMESTAMPTZ;
