#!/usr/bin/env bash
# Retry wrapper for `aisafety-pipeline llm-classify-run`. The command itself
# is safely resumable (submit_batch/collect_batch track everything needed
# in the DB and data/llm_batches.json), but this session's Mac has been
# OOM-killing it repeatedly due to unrelated memory pressure from other
# apps -- this wrapper restarts it automatically on any non-zero exit
# instead of requiring a human/agent to notice and re-run it by hand.
set -uo pipefail
cd "$(dirname "$0")/.."

attempt=0
until uv run aisafety-pipeline llm-classify-run --poll-interval 60; do
    attempt=$((attempt + 1))
    echo "[run_llm_classify_resilient] attempt $attempt exited non-zero, retrying in 30s..." >&2
    sleep 30
done
echo "[run_llm_classify_resilient] llm-classify-run finished successfully after $attempt retr$([ "$attempt" = 1 ] && echo y || echo ies)."
