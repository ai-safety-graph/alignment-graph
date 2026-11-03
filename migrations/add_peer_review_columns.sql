-- Peer-review status on `papers`, written by the `venue` pipeline stage
-- (src/aisafety_pipeline/venue.py) from papers_raw.journal_ref/doi/comments
-- (see add_arxiv_venue_fields.sql). Mirrors the _ensure_columns entries and
-- indexes in db.py; `aisafety-pipeline init-db` applies the same change.
--
-- peer_reviewed is NULL when there is no signal (unknown, not "not reviewed").

ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS peer_reviewed BOOLEAN;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS venue TEXT;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS venue_type TEXT;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS venue_source TEXT;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS venue_derived_at TIMESTAMPTZ;

-- Keyset order for the "peer-reviewed only" filter (same shape as
-- idx_papers_relevant_published).
CREATE INDEX IF NOT EXISTS idx_papers_reviewed_published ON public.papers
    (published DESC, id DESC) WHERE llm_relevant AND peer_reviewed;

-- venue stage work queue: relevant papers never derived.
CREATE INDEX IF NOT EXISTS idx_papers_venue_pending ON public.papers (id)
    WHERE llm_relevant AND venue_derived_at IS NULL;
