-- arXiv's peer-review signals on papers_raw, harvested from the OAI `arXiv`
-- record (journal-ref, doi, comments). Mirrors the _ensure_columns entries
-- in db.py; `aisafety-pipeline init-db` applies the same change.
--
-- No defaults, so ADD COLUMN is a catalog-only change and doesn't rewrite
-- the ~1.1M-row table. Existing rows stay NULL until the harvest sees them
-- again or scripts/backfill_arxiv_venue_fields.py fills them.

ALTER TABLE public.papers_raw ADD COLUMN IF NOT EXISTS journal_ref TEXT;
ALTER TABLE public.papers_raw ADD COLUMN IF NOT EXISTS doi TEXT;
ALTER TABLE public.papers_raw ADD COLUMN IF NOT EXISTS comments TEXT;
