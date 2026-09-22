from __future__ import annotations

import datetime as dt
import json
import random
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

from .config import (
    BLUE,
    DATA_DIR,
    GREEN,
    LLM_BATCH_MAX_ENQUEUED_TOKENS,
    LLM_MAX_RETRIES,
    LLM_MODEL,
    LLM_REQUEST_TIMEOUT_SEC,
    OPENAI_API_KEY,
    RESET,
    YELLOW,
)
from .taxonomy import TAXONOMY, TAXONOMY_DESCRIPTIONS

# Combined relevance + taxonomy-tag classification via a small LLM, run after
# stage-2 (filters.cmd_filter) instead of relying purely on cosine similarity
# to decide "is this actually AI safety/alignment" and "which topics apply".
# Output is written to new `papers` columns (llm_*), kept separate from
# `paper_tags` (owned by tagging.py's zero-shot BGE tagging) -- see
# db.py::_ensure_columns.
#
# Prompt caching: SYSTEM_PROMPT is a module-level constant, byte-identical
# across every call, sent first in the messages list -- this is all OpenAI's
# automatic prompt caching needs (no special params) to avoid re-billing the
# full taxonomy/instructions text on every paper.

_FEW_SHOT_EXAMPLES = [
    {
        "title": "Training Language Models to Accept Correction via Corrigibility-Aware RLHF",
        "abstract": (
            "We propose a reward-shaping technique for RLHF that penalizes a model "
            "for resisting shutdown or correction commands during training, and show "
            "it reduces reward hacking on a suite of held-out control tasks."
        ),
        "output": {
            "relevant": True,
            "confidence": 0.95,
            "reason": "Directly about training objectives for corrigibility and reducing reward hacking.",
            "tags": ["alignment and value specification"],
        },
    },
    {
        "title": "A Faster Radix Sort for GPU Clusters",
        "abstract": (
            "We present a work-efficient radix sort implementation for multi-GPU "
            "clusters, achieving a 3x speedup over prior work on sorting 10 billion "
            "keys."
        ),
        "output": {
            "relevant": False,
            "confidence": 0.98,
            "reason": "A systems/algorithms paper with no connection to AI safety or alignment.",
            "tags": [],
        },
    },
    {
        "title": "Jailbreaking Aligned LLMs with Adversarial Suffixes at Scale",
        "abstract": (
            "We introduce an automated method for finding adversarial suffixes that "
            "bypass safety fine-tuning in production chat models, and evaluate "
            "transferability across model families."
        ),
        "output": {
            "relevant": True,
            "confidence": 0.97,
            "reason": "An adversarial attack against safety-tuned LLMs (jailbreaking).",
            "tags": ["adversarial robustness and security", "large language model safety"],
        },
    },
]

_RESPONSE_JSON_SCHEMA = {
    "name": "paper_classification",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "relevant": {"type": "boolean"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"},
            "tags": {
                "type": "array",
                "items": {"type": "string", "enum": TAXONOMY},
            },
        },
        "required": ["relevant", "confidence", "reason", "tags"],
        "additionalProperties": False,
    },
}


def build_system_prompt(
    taxonomy: list[str] = TAXONOMY,
    descriptions: dict[str, str] = TAXONOMY_DESCRIPTIONS,
) -> str:
    """Build the fixed system prompt.

    Must stay byte-identical across calls (no per-paper data, no timestamps)
    -- this is the static prefix prompt caching relies on. Rebuilding it with
    the same taxonomy/descriptions always yields the same string.
    """
    lines = [
        "You are classifying arXiv papers for an AI safety / alignment research corpus.",
        "",
        "Task: given a paper's title and abstract, decide (1) whether the paper is "
        "actually about AI safety, AI alignment, or AI governance/policy as it relates "
        "to safety -- not just AI/ML in general -- and (2) which of the following "
        "taxonomy categories apply, if any.",
        "",
        "Categories:",
    ]
    for phrase in taxonomy:
        desc = descriptions.get(phrase, "")
        lines.append(f"- {phrase}: {desc}" if desc else f"- {phrase}")
    lines += [
        "",
        "Guidelines:",
        "- A paper can match zero, one, or several categories. Most relevant papers "
        "match one or two.",
        "- Judge relevance on the paper's actual contribution, not on the presence of "
        "AI-adjacent keywords -- a paper that merely uses a word like 'safety' or "
        "'alignment' in an unrelated sense (e.g. control-theoretic 'safe' robotics "
        "with no AI-safety framing) is not relevant.",
        "- Only use categories from the list above, exactly as written.",
        "- Give a short (one sentence) reason for your relevance judgment.",
        "- confidence is your confidence in the *relevance* judgment, from 0 to 1.",
        "",
        "Respond with a single JSON object matching the required schema: "
        '{"relevant": bool, "confidence": number, "reason": string, "tags": [string, ...]}.',
        "",
        "Examples:",
    ]
    for ex in _FEW_SHOT_EXAMPLES:
        lines.append(f"Title: {ex['title']}")
        lines.append(f"Abstract: {ex['abstract']}")
        lines.append(f"Output: {json.dumps(ex['output'], sort_keys=True)}")
        lines.append("")
    return "\n".join(lines)


SYSTEM_PROMPT = build_system_prompt()


def build_user_message(title: str, abstract: str) -> str:
    return f"Title: {title}\n\nAbstract: {abstract}"


def build_request_body(title: str, abstract: str, *, model: str) -> dict:
    """The `chat.completions` request body shared by the synchronous
    (`classify_paper`) and OpenAI Batch API (`build_batch_request_line`)
    paths -- keeping this in one place means both paths stay byte-identical
    on the system-prompt prefix that prompt caching depends on."""
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_message(title, abstract)},
        ],
        "response_format": {"type": "json_schema", "json_schema": _RESPONSE_JSON_SCHEMA},
    }


class LlmParseError(Exception):
    pass


@dataclass
class LlmClassification:
    relevant: bool
    confidence: float
    reason: str
    tags: list[str]
    raw_model_output: str
    dropped_tags: list[str] = field(default_factory=list)


@dataclass
class TokenUsage:
    prompt_tokens: int = 0
    cached_tokens: int = 0
    completion_tokens: int = 0


def parse_response(raw_json_text: str) -> LlmClassification:
    try:
        data = json.loads(raw_json_text)
    except json.JSONDecodeError as exc:
        raise LlmParseError(f"invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise LlmParseError("response is not a JSON object")

    missing = {"relevant", "confidence", "reason", "tags"} - data.keys()
    if missing:
        raise LlmParseError(f"missing required field(s): {sorted(missing)}")

    relevant = data["relevant"]
    if not isinstance(relevant, bool):
        raise LlmParseError(f"'relevant' must be a boolean, got {relevant!r}")

    confidence = data["confidence"]
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not (0.0 <= float(confidence) <= 1.0):
        raise LlmParseError(f"'confidence' must be a number in [0, 1], got {confidence!r}")

    reason = data["reason"]
    if not isinstance(reason, str):
        raise LlmParseError(f"'reason' must be a string, got {reason!r}")

    raw_tags = data["tags"]
    if not isinstance(raw_tags, list) or not all(isinstance(t, str) for t in raw_tags):
        raise LlmParseError(f"'tags' must be a list of strings, got {raw_tags!r}")

    # A hallucinated tag outside TAXONOMY is dropped, not fatal to the whole
    # record -- the relevance judgment (the more important signal for the
    # false-positive problem this stage exists to fix) is still usable.
    # Callers should count dropped_tags separately from parse errors to keep
    # prompt-drift visible without discarding otherwise-good classifications.
    valid_tags = [t for t in raw_tags if t in TAXONOMY]
    dropped_tags = [t for t in raw_tags if t not in TAXONOMY]

    # Defensive: an irrelevant paper should never carry taxonomy tags, even
    # if a future prompt/model change starts populating them despite the
    # guidelines and few-shot examples.
    if not relevant:
        valid_tags = []

    return LlmClassification(
        relevant=relevant,
        confidence=float(confidence),
        reason=reason,
        tags=valid_tags,
        raw_model_output=raw_json_text,
        dropped_tags=dropped_tags,
    )


_CLIENT = None


def _get_client():
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    import openai

    _CLIENT = openai.OpenAI(
        api_key=OPENAI_API_KEY,
        max_retries=LLM_MAX_RETRIES,
        timeout=LLM_REQUEST_TIMEOUT_SEC,
    )
    return _CLIENT


def _sleep_with_jitter(base: float) -> None:
    time.sleep(base * (1.0 + 0.3 * random.random()))


def classify_paper(
    title: str,
    abstract: str,
    *,
    model: str = LLM_MODEL,
    client=None,
) -> tuple[LlmClassification, TokenUsage]:
    """Classify one paper's relevance + taxonomy tags in a single LLM call.

    The OpenAI SDK client already retries connection errors internally
    (`max_retries=`); this adds one further jittered-backoff loop only for
    the case those retries are exhausted (e.g. sustained rate limiting), so
    a single stuck paper doesn't abort a large batch run.
    """
    client = client or _get_client()
    body = build_request_body(title, abstract, model=model)

    attempts = 4
    response = None
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            response = client.chat.completions.create(**body)
            break
        except Exception as exc:
            last_exc = exc
            if attempt == attempts - 1:
                raise
            _sleep_with_jitter(2.0 * (2**attempt))
    if response is None:  # pragma: no cover -- unreachable, loop always breaks or raises
        raise last_exc

    raw_text = response.choices[0].message.content
    classification = parse_response(raw_text)

    usage = response.usage
    cached = 0
    details = getattr(usage, "prompt_tokens_details", None) if usage else None
    if details is not None:
        cached = getattr(details, "cached_tokens", 0) or 0
    token_usage = TokenUsage(
        prompt_tokens=getattr(usage, "prompt_tokens", 0) if usage else 0,
        cached_tokens=cached,
        completion_tokens=getattr(usage, "completion_tokens", 0) if usage else 0,
    )
    return classification, token_usage


# $ per 1K tokens. Model name is a plain configurable string (see
# config.LLM_MODEL) -- add an entry here to get cost estimates for whatever
# model is actually configured; an unrecognized model just skips cost
# estimation rather than failing the run.
_MODEL_PRICING: dict[str, dict[str, float]] = {
    # Published rates: $0.20 / $0.02 (cached) / $1.20 per 1M tokens (input /
    # cached input / output).
    "gpt-5.6-luna": {"input": 0.0002, "cached_input": 0.00002, "output": 0.0012},
}


# OpenAI Batch API is billed at roughly half the synchronous per-token rate
# in exchange for up-to-24h turnaround instead of an immediate response.
_BATCH_DISCOUNT = 0.5


def estimate_cost(model: str, usage: TokenUsage, *, batch: bool = False) -> float | None:
    pricing = _MODEL_PRICING.get(model)
    if pricing is None:
        return None
    uncached = max(usage.prompt_tokens - usage.cached_tokens, 0)
    cost = (
        uncached / 1000 * pricing["input"]
        + usage.cached_tokens / 1000 * pricing["cached_input"]
        + usage.completion_tokens / 1000 * pricing["output"]
    )
    return cost * _BATCH_DISCOUNT if batch else cost


_LLM_READ_CHUNK = 200
_LLM_WRITE_BATCH = 50

_SELECT_UNCLASSIFIED = """
    SELECT id, title, summary FROM papers
    WHERE ai_stage2_keep = TRUE AND id > %s AND ({force_clause})
    ORDER BY id
    LIMIT %s
"""


def _eligibility_clause(force: bool) -> str:
    """WHERE-clause fragment selecting papers eligible for (re)classification.

    Shared by the synchronous path (classify_papers) and the batch path
    (submit_batch) so a paper currently in flight in a submitted-but-not-yet-
    collected batch (llm_batch_id set, llm_classified_at still NULL) isn't
    also picked up and reclassified by the other path.
    """
    return "TRUE" if force else "llm_classified_at IS NULL AND llm_batch_id IS NULL"


_UPDATE_LLM = """
    UPDATE papers AS p SET
      llm_relevant = v.relevant,
      llm_confidence = v.confidence,
      llm_tags = v.tags,
      llm_reason = v.reason,
      llm_model = v.model,
      llm_classified_at = v.classified_at,
      llm_batch_id = NULL
    FROM (VALUES %s) AS v(id, relevant, confidence, tags, reason, model, classified_at)
    WHERE p.id = v.id
"""


def _cost_str(model: str, usage: TokenUsage) -> str:
    cost = estimate_cost(model, usage)
    return f"${cost:.2f}" if cost is not None else "n/a"


def classify_papers(
    conn,
    *,
    model: str = LLM_MODEL,
    limit: int | None = None,
    dry_run: bool = False,
    force: bool = False,
) -> dict:
    """Classify unclassified (or, with force=True, all) stage-2-kept papers.

    Takes an already-open `conn` (mirrors tagging.py's `tag_papers_default`
    split from `cmd_tag`) so it can be exercised directly against a test
    fixture connection -- a CLI command that opens its own connection via
    `connect()` wouldn't see another connection's uncommitted fixture rows.
    """
    write_cur = conn.raw_cursor()
    scanned = classified = relevant_count = errors = bad_tags = 0
    total_usage = TokenUsage()
    write_batch: list[tuple] = []
    start = time.time()

    select_sql = _SELECT_UNCLASSIFIED.format(force_clause=_eligibility_clause(force))

    def flush_writes():
        nonlocal write_batch
        if not write_batch:
            return
        if not dry_run:
            execute_values(
                write_cur,
                _UPDATE_LLM,
                write_batch,
                template="(%s, %s::boolean, %s::real, %s::text[], %s::text, %s::text, %s::timestamptz)",
            )
            conn.commit()
        write_batch = []
        print(
            f"{BLUE}llm-classify progress:{RESET} scanned={scanned} classified={classified} "
            f"relevant={relevant_count} errors={errors} bad_tags={bad_tags} "
            f"tokens(prompt={total_usage.prompt_tokens} cached={total_usage.cached_tokens} "
            f"completion={total_usage.completion_tokens}) est_cost={_cost_str(model, total_usage)}"
        )

    try:
        last_id = ""
        reached_limit = False
        while not reached_limit:
            page = conn.execute(select_sql, (last_id, _LLM_READ_CHUNK)).fetchall()
            if not page:
                break

            for row in page:
                if limit is not None and scanned >= limit:
                    reached_limit = True
                    break
                scanned += 1
                pid, title, summary = row["id"], row["title"], row["summary"]

                try:
                    classification, usage = classify_paper(title, summary or "", model=model)
                except Exception as exc:
                    errors += 1
                    print(f"{YELLOW}llm-classify:{RESET} error classifying {pid}: {exc}")
                    continue

                total_usage.prompt_tokens += usage.prompt_tokens
                total_usage.cached_tokens += usage.cached_tokens
                total_usage.completion_tokens += usage.completion_tokens
                bad_tags += len(classification.dropped_tags)
                classified += 1
                relevant_count += int(classification.relevant)

                if dry_run:
                    print(
                        f"{'-' * 70}\n{pid}\n{title}\n"
                        f"relevant={classification.relevant} confidence={classification.confidence:.2f} "
                        f"tags={classification.tags}\nreason: {classification.reason}\n"
                    )
                else:
                    write_batch.append((
                        pid,
                        classification.relevant,
                        classification.confidence,
                        classification.tags,
                        classification.reason,
                        model,
                        dt.datetime.now(dt.UTC),
                    ))
                    if len(write_batch) >= _LLM_WRITE_BATCH:
                        flush_writes()

            last_id = page[-1]["id"]
        flush_writes()
    except Exception:
        conn.rollback()
        raise

    elapsed = time.time() - start
    stats = {
        "scanned": scanned,
        "classified": classified,
        "relevant": relevant_count,
        "errors": errors,
        "bad_tags": bad_tags,
        "usage": total_usage,
        "elapsed": elapsed,
    }
    print(
        f"{GREEN}llm-classify:{RESET} scanned={scanned} classified={classified} "
        f"relevant={relevant_count} errors={errors} bad_tags={bad_tags} "
        f"est_cost={_cost_str(model, total_usage)} elapsed={elapsed:.1f}s"
    )
    return stats


def cmd_llm_classify(args) -> None:
    from .db import connect

    conn = connect(args.db)
    try:
        classify_papers(
            conn,
            model=args.model,
            limit=args.limit,
            dry_run=args.dry_run,
            force=args.force,
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# OpenAI Batch API path
# ---------------------------------------------------------------------------
#
# The synchronous path above (classify_papers/cmd_llm_classify) is one HTTP
# round-trip per paper -- fine for a 20-paper dry-run smoke test, hopeless
# for a 60k+-paper corpus (tens of hours serialized). The Batch API instead
# takes one JSONL file of up to 50,000 requests, runs them server-side
# within a fixed window (currently only "24h" is offered), and bills at
# roughly half the synchronous per-token rate (_BATCH_DISCOUNT) -- the
# tradeoff being results aren't available immediately. This is a submit/
# collect pair rather than a single blocking call:
#   `llm-classify-submit` selects eligible papers, uploads the JSONL, creates
#   the batch job, and marks the selected papers' `llm_batch_id` so neither
#   this nor the synchronous path re-selects them meanwhile.
#   `llm-classify-collect` checks a submitted batch's status; once OpenAI
#   reports it "completed", downloads the output (and any per-request error)
#   file and writes results the same way the synchronous path does. A batch
#   that ends "failed"/"expired"/"cancelled" has its papers' `llm_batch_id`
#   cleared so a future submit can pick them up again.
#
# Tracked batches live in a small local JSON file (_BATCH_STATE_FILE) --
# there's no server-side "list batches I care about" scoped to this
# pipeline, so this is just enough bookkeeping for `llm-classify-collect`
# to know what to check without the caller re-supplying every batch id.

_BATCH_ENDPOINT = "/v1/chat/completions"
_BATCH_COMPLETION_WINDOW = "24h"
_BATCH_MAX_REQUESTS = 50_000  # OpenAI Batch API's per-batch request cap
# OpenAI also caps the input *file* at 200MB (209,715,200 bytes) regardless
# of request count -- SYSTEM_PROMPT is repeated in full in every line
# (~5.6KB), so at ~8KB/request observed in practice, 50,000 requests alone
# can exceed this (confirmed in production: a real 50k-paper batch was
# rejected with `maximum_input_file_size_exceeded` at ~405MB). Stop adding
# requests once within this margin of the real limit rather than trusting
# the request count alone; leftover eligible papers just get picked up by
# the next submit call, same as hitting _BATCH_MAX_REQUESTS.
_BATCH_MAX_FILE_BYTES = 190_000_000
_BATCH_STATE_FILE = DATA_DIR / "llm_batches.json"

# Rough chars-per-token used only to bound LLM_BATCH_MAX_ENQUEUED_TOKENS
# while streaming a batch file (no tokenizer dependency in this repo).
# Deliberately on the low side (over-estimates tokens, under-fills
# batches) so the real per-batch total stays safely under the org's actual
# enqueued-token cap rather than risking another token_limit_exceeded.
_CHARS_PER_TOKEN_ESTIMATE = 3.5


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / _CHARS_PER_TOKEN_ESTIMATE))

_TERMINAL_BATCH_STATUSES = {"completed", "failed", "expired", "cancelled"}
_FAILED_BATCH_STATUSES = {"failed", "expired", "cancelled"}


def build_batch_request_line(pid: str, title: str, abstract: str, *, model: str) -> dict:
    """One line of the JSONL file submitted to the Batch API.

    `custom_id` is the paper's `id` (the canonical arXiv abs URL) -- unique
    within a batch, which is all the Batch API requires, and lets
    `parse_batch_output_line` map a result straight back to a paper with no
    extra bookkeeping.
    """
    return {
        "custom_id": pid,
        "method": "POST",
        "url": _BATCH_ENDPOINT,
        "body": build_request_body(title, abstract, model=model),
    }


def parse_batch_output_line(line: dict) -> tuple[str, LlmClassification | None, TokenUsage | None, str | None]:
    """Parse one decoded line of a Batch API output (or error) file.

    Returns (custom_id, classification, usage, error_message) -- exactly one
    of (classification, error_message) is non-None. A malformed/missing
    response is reported as an error rather than raising, since one bad line
    in a 50,000-line file shouldn't abort collecting the other 49,999.
    """
    custom_id = line.get("custom_id", "")

    error = line.get("error")
    if error:
        return custom_id, None, None, str(error.get("message", error)) if isinstance(error, dict) else str(error)

    response = line.get("response") or {}
    if response.get("status_code") != 200:
        return custom_id, None, None, f"HTTP {response.get('status_code')}"

    body = response.get("body") or {}
    try:
        raw_text = body["choices"][0]["message"]["content"]
        classification = parse_response(raw_text)
    except (KeyError, IndexError, TypeError, LlmParseError) as exc:
        return custom_id, None, None, str(exc)

    usage_obj = body.get("usage") or {}
    details = usage_obj.get("prompt_tokens_details") or {}
    usage = TokenUsage(
        prompt_tokens=usage_obj.get("prompt_tokens", 0) or 0,
        cached_tokens=details.get("cached_tokens", 0) or 0,
        completion_tokens=usage_obj.get("completion_tokens", 0) or 0,
    )
    return custom_id, classification, usage, None


def _load_batch_state() -> list[dict]:
    if _BATCH_STATE_FILE.exists():
        return json.loads(_BATCH_STATE_FILE.read_text())
    return []


def _save_batch_state(records: list[dict]) -> None:
    _BATCH_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _BATCH_STATE_FILE.write_text(json.dumps(records, indent=2))


def _record_batch_state(**fields) -> None:
    records = _load_batch_state()
    records.append(fields)
    _save_batch_state(records)


def _update_batch_state(batch_id: str, **updates) -> None:
    records = _load_batch_state()
    for r in records:
        if r.get("batch_id") == batch_id:
            r.update(updates)
    _save_batch_state(records)


def _uncollected_batch_ids() -> list[str]:
    """Locally tracked batches not yet resolved to a terminal outcome
    (collected, or released after failed/expired/cancelled) -- purely from
    local state, no API call. Used to resume a run that was interrupted
    after submitting a batch but before it got waited on/collected; unlike
    _pending_batch_ids, this includes a batch that already finished on
    OpenAI's side while this process was down; collect_batch resolves
    those immediately on the first check rather than needing a wait.
    """
    return [r["batch_id"] for r in _load_batch_state() if r.get("status") == "submitted"]


def _pending_batch_ids(client) -> list[str]:
    """Tracked batches that are still consuming the org's enqueued-token
    quota for their model right now (checked live via the API, since the
    local state file's "submitted" status doesn't update on its own until
    something calls collect_batch) -- used only to gate new submissions;
    see _uncollected_batch_ids for resuming an interrupted run instead.
    """
    pending = []
    for batch_id in _uncollected_batch_ids():
        try:
            b = client.batches.retrieve(batch_id)
        except Exception:
            continue
        if b.status not in _TERMINAL_BATCH_STATUSES:
            pending.append(batch_id)
    return pending


_SELECT_FOR_BATCH = """
    SELECT id, title, summary FROM papers
    WHERE ai_stage2_keep = TRUE AND id > %s AND ({force_clause})
    ORDER BY id
    LIMIT %s
"""

_COUNT_FOR_BATCH = """
    SELECT COUNT(*) AS n FROM papers
    WHERE ai_stage2_keep = TRUE AND ({force_clause})
"""

# Starting chunk size for the `UPDATE ... WHERE id = ANY(%s)` marking/
# release passes below -- just an array of short id strings, so this can be
# fairly large without bloating memory or a single query's payload. Actual
# per-statement cost isn't reliably a function of chunk size alone, though:
# `papers` carries large HNSW vector indexes under fillfactor=100 (see
# filters.py's comments), so *any* bulk UPDATE -- even to unrelated columns
# like llm_batch_id -- can force expensive index-page churn that scales with
# table bloat, not just row count. In practice this chunk size has both
# succeeded outright and hit this DB's 2-minute statement_timeout depending
# on the table's state at the time, so `_update_ids_with_retry` treats it as
# a starting point to halve on timeout, not a guaranteed-safe fixed size.
_BATCH_MARK_CHUNK = 1000
_BATCH_MARK_MIN_CHUNK = 25


def _update_ids_with_retry(conn, sql: str, ids: list[str], *, prefix_params: tuple = ()) -> None:
    """Run `sql` (ending in an `id = ANY(%s)`-style array param) over `ids`
    in chunks, committing each; on a statement timeout, roll back, halve the
    chunk size, and retry that portion instead of failing the whole call --
    see _BATCH_MARK_CHUNK for why a fixed chunk size isn't reliable here.
    Gives up (re-raising) only once the chunk size can't be halved further.
    """
    i = 0
    size = _BATCH_MARK_CHUNK
    while i < len(ids):
        chunk = ids[i : i + size]
        try:
            conn.execute(sql, (*prefix_params, chunk))
            conn.commit()
            i += len(chunk)
        except psycopg2.errors.QueryCanceled:
            conn.rollback()
            if size <= _BATCH_MARK_MIN_CHUNK:
                raise
            size = max(_BATCH_MARK_MIN_CHUNK, size // 2)


def submit_batch(
    conn,
    *,
    model: str = LLM_MODEL,
    limit: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    allow_concurrent: bool = False,
    client=None,
) -> dict | None:
    """Select eligible papers, submit them as one OpenAI Batch API job, and
    mark them `llm_batch_id` so they aren't also picked up elsewhere. Takes
    an open `conn` for the same reason `classify_papers` does -- testable
    against a fixture connection.

    Writes the JSONL request file to disk instead of building it as a list
    of Python dicts (each carrying a copy of the ~5-6KB system prompt) that
    then gets joined into one big string -- at 50,000 requests that
    in-memory approach held several redundant multi-hundred-MB copies at
    once (the dict list, the per-line JSON strings, the joined string, its
    UTF-8 encoding) and was enough to get the process OOM-killed in
    practice; streaming keeps peak memory to about one request's worth.
    """
    cap = min(limit, _BATCH_MAX_REQUESTS) if limit is not None else _BATCH_MAX_REQUESTS
    eligibility = _eligibility_clause(force)

    if dry_run:
        count_row = conn.execute(_COUNT_FOR_BATCH.format(force_clause=eligibility)).fetchone()
        n_eligible = min(count_row["n"], cap)
        if n_eligible == 0:
            print(f"{YELLOW}llm-classify-submit:{RESET} no eligible papers found.")
            return None
        preview_page = conn.execute(
            _SELECT_FOR_BATCH.format(force_clause=eligibility), ("", 1)
        ).fetchall()
        first_line = build_batch_request_line(
            preview_page[0]["id"], preview_page[0]["title"], preview_page[0]["summary"] or "", model=model
        )
        print(
            f"{BLUE}llm-classify-submit (dry-run):{RESET} would submit {n_eligible} papers "
            f"as one batch job (model={model}). First request:\n{json.dumps(first_line, indent=2)}"
        )
        return None

    if not allow_concurrent:
        pending = _pending_batch_ids(client or _get_client())
        if pending:
            print(
                f"{YELLOW}llm-classify-submit:{RESET} {len(pending)} batch(es) still processing "
                f"({', '.join(pending)}) -- OpenAI enforces an org-wide enqueued-token cap per "
                "model, and submitting more now risks a token_limit_exceeded failure like the one "
                "seen in practice. Run `llm-classify-collect` until they finish, or pass "
                "allow_concurrent=True (--allow-concurrent) if you've confirmed there's headroom."
            )
            return None

    select_sql = _SELECT_FOR_BATCH.format(force_clause=eligibility)
    ids: list[str] = []
    bytes_written = 0
    tokens_written = 0
    capped_reason = None
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False, encoding="utf-8")
    tmp_path = Path(tmp.name)
    try:
        with tmp:
            last_id = ""
            while len(ids) < cap and capped_reason is None:
                page = conn.execute(select_sql, (last_id, min(_LLM_READ_CHUNK, cap - len(ids)))).fetchall()
                if not page:
                    break
                for row in page:
                    line = build_batch_request_line(row["id"], row["title"], row["summary"] or "", model=model)
                    line_str = json.dumps(line) + "\n"
                    line_bytes = len(line_str.encode("utf-8"))
                    line_tokens = _estimate_tokens(line_str)
                    if bytes_written + line_bytes > _BATCH_MAX_FILE_BYTES:
                        capped_reason = "the file-size cap"
                        break
                    if tokens_written + line_tokens > LLM_BATCH_MAX_ENQUEUED_TOKENS:
                        capped_reason = "the enqueued-token cap"
                        break
                    tmp.write(line_str)
                    bytes_written += line_bytes
                    tokens_written += line_tokens
                    ids.append(row["id"])
                last_id = page[-1]["id"]

        if not ids:
            print(f"{YELLOW}llm-classify-submit:{RESET} no eligible papers found.")
            return None

        client = client or _get_client()
        with open(tmp_path, "rb") as f:
            file_obj = client.files.create(file=f, purpose="batch")
    finally:
        tmp_path.unlink(missing_ok=True)

    batch = client.batches.create(
        input_file_id=file_obj.id,
        endpoint=_BATCH_ENDPOINT,
        completion_window=_BATCH_COMPLETION_WINDOW,
        metadata={"model": model, "n_requests": str(len(ids))},
    )

    # Record the batch locally *before* the marking pass below: collect_batch
    # only ever needs the batch id (everything else comes from OpenAI), so a
    # marking failure shouldn't be able to leave a real, billable batch with
    # no local record of it -- that happened in practice (a statement
    # timeout mid-marking crashed the whole call before this line ran).
    _record_batch_state(
        batch_id=batch.id,
        input_file_id=file_obj.id,
        model=model,
        submitted_at=dt.datetime.now(dt.UTC).isoformat(),
        n_requests=len(ids),
        status="submitted",
    )

    try:
        _update_ids_with_retry(
            conn, "UPDATE papers SET llm_batch_id = %s WHERE id = ANY(%s)", ids, prefix_params=(batch.id,)
        )
    except Exception as exc:
        conn.rollback()
        print(
            f"{YELLOW}llm-classify-submit:{RESET} batch {batch.id} was submitted, but marking its "
            f"{len(ids)} papers' llm_batch_id failed ({exc}) -- they could be re-selected by a "
            "future submit before this batch is collected. The batch itself is tracked and safe; "
            "run `llm-classify-collect` for it as usual."
        )

    print(
        f"{GREEN}llm-classify-submit:{RESET} submitted batch {batch.id} with {len(ids)} papers "
        f"(model={model}, {bytes_written / 1e6:.1f}MB, ~{tokens_written} est. tokens"
        + (f", stopped early at {capped_reason}" if capped_reason else "")
        + "). Run `llm-classify-collect` later to check status and write results."
    )
    return {"batch_id": batch.id, "n_requests": len(ids)}


def _release_batch_papers(conn, batch_id: str) -> int:
    """Clear llm_batch_id for every paper still marked with a batch that
    ended failed/expired/cancelled, so a future submit can pick them up.

    Selects matching ids by keyset pagination (backed by the partial index
    on llm_batch_id, db.py's idx_papers_llm_batch_id -- without it, an
    unrestricted `WHERE llm_batch_id = %s` was a full sequential scan of
    `papers` and hit this DB's statement_timeout in practice), then clears
    them via `_update_ids_with_retry` on the primary key.
    """
    ids: list[str] = []
    last_id = ""
    while True:
        page = conn.execute(
            "SELECT id FROM papers WHERE llm_batch_id = %s AND id > %s ORDER BY id LIMIT %s",
            (batch_id, last_id, _LLM_READ_CHUNK),
        ).fetchall()
        if not page:
            break
        ids.extend(r["id"] for r in page)
        last_id = page[-1]["id"]

    _update_ids_with_retry(conn, "UPDATE papers SET llm_batch_id = NULL WHERE id = ANY(%s)", ids)
    return len(ids)


_WRITE_RETRIES = 5


def _write_results_committed(conn, rows: list[tuple]) -> None:
    """Write classification rows in chunks, committing after each one and
    reconnecting after a dropped connection.

    Previously all chunks went into one transaction committed at the end.
    Updates to `papers` are slow (~17s per 50 rows: every non-HOT update also
    rewrites the large HNSW vector indexes), so a big batch took minutes in
    one open transaction, Supabase dropped the connection partway, and the
    rollback meant every retry restarted from zero -- 10+ hours with no
    progress in practice. Per-chunk commits make progress durable; the
    UPDATE is idempotent, so retrying a chunk after a reconnect is safe.
    """
    write_cur = conn.raw_cursor()
    for i in range(0, len(rows), _LLM_WRITE_BATCH):
        chunk = rows[i : i + _LLM_WRITE_BATCH]
        for attempt in range(_WRITE_RETRIES):
            try:
                execute_values(
                    write_cur,
                    _UPDATE_LLM,
                    chunk,
                    template="(%s, %s::boolean, %s::real, %s::text[], %s::text, %s::text, %s::timestamptz)",
                )
                conn.commit()
                break
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                if attempt == _WRITE_RETRIES - 1:
                    raise
                print(f"{YELLOW}llm-classify:{RESET} DB connection lost writing results; reconnecting and retrying chunk...")
                time.sleep(2 * (attempt + 1))
                conn.reconnect()
                write_cur = conn.raw_cursor()


def collect_batch(conn, batch_id: str, *, dry_run: bool = False, client=None) -> dict:
    """Check one batch's status; if complete, write its results to `papers`.

    Returns {"status": ..., "collected": bool, "classified": int, "relevant":
    int, "errors": int}. `status` reaching a terminal value (see
    _TERMINAL_BATCH_STATUSES) -- not `collected` -- is what callers should
    poll for: `collected` is only ever True for a "completed" batch, and a
    "failed"/"expired"/"cancelled" batch is just as done, permanently, after
    its papers are released. (An earlier version of the --wait loop checked
    `collected` alone and would have polled a failed batch forever.)
    """
    client = client or _get_client()
    batch = client.batches.retrieve(batch_id)
    counts = batch.request_counts

    print(
        f"{BLUE}llm-classify-collect:{RESET} batch {batch_id} status={batch.status}"
        + (f" ({counts.completed}/{counts.total} completed, {counts.failed} failed)" if counts else "")
    )

    if batch.status not in _TERMINAL_BATCH_STATUSES:
        return {"status": batch.status, "collected": False, "classified": 0, "relevant": 0, "errors": 0}

    if batch.status in _FAILED_BATCH_STATUSES:
        print(
            f"{YELLOW}llm-classify-collect:{RESET} batch {batch_id} ended as {batch.status}; "
            "releasing its papers for resubmission."
        )
        if not dry_run:
            _release_batch_papers(conn, batch_id)
            _update_batch_state(batch_id, status=batch.status)
        return {"status": batch.status, "collected": False, "classified": 0, "relevant": 0, "errors": 0}

    # status == "completed"
    output_text = client.files.content(batch.output_file_id).text if batch.output_file_id else ""
    error_text = client.files.content(batch.error_file_id).text if batch.error_file_id else ""

    classified = relevant_count = errors = bad_tags = 0
    write_batch: list[tuple] = []
    model = batch.model or ""

    for raw_line in output_text.splitlines():
        if not raw_line.strip():
            continue
        pid, classification, _usage, error = parse_batch_output_line(json.loads(raw_line))
        if error or classification is None:
            errors += 1
            print(f"{YELLOW}llm-classify-collect:{RESET} error for {pid}: {error}")
            continue
        classified += 1
        relevant_count += int(classification.relevant)
        bad_tags += len(classification.dropped_tags)
        write_batch.append((
            pid,
            classification.relevant,
            classification.confidence,
            classification.tags,
            classification.reason,
            model,
            dt.datetime.now(dt.UTC),
        ))

    for raw_line in error_text.splitlines():
        if not raw_line.strip():
            continue
        line = json.loads(raw_line)
        errors += 1
        print(f"{YELLOW}llm-classify-collect:{RESET} request error for {line.get('custom_id')}: {line.get('error')}")

    if not dry_run:
        _write_results_committed(conn, write_batch)
        # _write_results_committed clears llm_batch_id for the papers it
        # wrote (_UPDATE_LLM sets it to NULL alongside the classification).
        # Anything left still marked with this batch_id is a per-request
        # error (see the output_text/error_text loops above) that was never
        # written -- release those too so a future submit can retry them,
        # rather than leaving them permanently ineligible (_eligibility_clause
        # requires llm_batch_id IS NULL).
        _release_batch_papers(conn, batch_id)
        _update_batch_state(batch_id, status="collected")

    cost_str = "n/a"
    if batch.usage is not None:
        usage = TokenUsage(
            prompt_tokens=batch.usage.input_tokens,
            cached_tokens=batch.usage.input_tokens_details.cached_tokens,
            completion_tokens=batch.usage.output_tokens,
        )
        cost = estimate_cost(model, usage, batch=True)
        cost_str = f"${cost:.2f}" if cost is not None else "n/a"

    print(
        f"{GREEN}llm-classify-collect:{RESET} batch {batch_id} collected: classified={classified} "
        f"relevant={relevant_count} errors={errors} bad_tags={bad_tags} est_cost={cost_str}"
    )
    return {"status": batch.status, "collected": True, "classified": classified, "relevant": relevant_count, "errors": errors}


def cmd_llm_classify_submit(args) -> None:
    from .db import connect

    conn = connect(args.db)
    try:
        submit_batch(
            conn,
            model=args.model,
            limit=args.limit,
            force=args.force,
            dry_run=args.dry_run,
            allow_concurrent=args.allow_concurrent,
        )
    finally:
        conn.close()


def cmd_llm_classify_collect(args) -> None:
    from .db import connect

    conn = connect(args.db)
    try:
        if args.batch_id:
            batch_ids = [args.batch_id]
        else:
            batch_ids = [
                r["batch_id"] for r in _load_batch_state()
                if r.get("status") not in ("collected", *_FAILED_BATCH_STATUSES)
            ]
        if not batch_ids:
            print(f"{YELLOW}llm-classify-collect:{RESET} no pending batches tracked.")
            return

        for batch_id in batch_ids:
            while True:
                result = collect_batch(conn, batch_id, dry_run=args.dry_run)
                if result["status"] in _TERMINAL_BATCH_STATUSES or not args.wait:
                    break
                time.sleep(args.poll_interval)
    finally:
        conn.close()


def run_until_done(
    conn,
    *,
    model: str = LLM_MODEL,
    force: bool = False,
    poll_interval: int = 60,
    client=None,
) -> dict:
    """Submit a batch, wait for it to reach a terminal status, repeat --
    until no eligible papers remain. This is the intended way to work
    through a corpus much larger than one batch's enqueued-token cap: each
    round only starts once the previous one is fully resolved, which is
    what OpenAI's org-wide per-model enqueued-token limit requires (see
    LLM_BATCH_MAX_ENQUEUED_TOKENS) -- submitting several batches back to
    back, as an earlier version of this rollout did, failed all of them
    with token_limit_exceeded.

    Resumable: if a previous call was interrupted (e.g. killed) while a
    batch was in flight, that batch is still tracked and safe on OpenAI's
    side -- this waits it out first, before ever trying to submit a new
    one, rather than immediately declining because submit_batch sees it as
    still-pending (confirmed in practice: restarting after an OOM kill mid-
    poll otherwise just prints "stopping" and exits with the corpus
    untouched).
    """
    client = client or _get_client()
    eligibility = _eligibility_clause(force)
    rounds = 0
    total_classified = total_relevant = total_errors = 0
    stopped_early = False

    def _wait_for(batch_id: str) -> None:
        nonlocal total_classified, total_relevant, total_errors
        while True:
            status = collect_batch(conn, batch_id, client=client)
            if status["status"] in _TERMINAL_BATCH_STATUSES:
                break
            time.sleep(poll_interval)
        total_classified += status["classified"]
        total_relevant += status["relevant"]
        total_errors += status["errors"]

    for batch_id in _uncollected_batch_ids():
        print(f"{BLUE}llm-classify-run:{RESET} resuming: resolving already-submitted batch {batch_id}...")
        _wait_for(batch_id)

    while True:
        count_row = conn.execute(_COUNT_FOR_BATCH.format(force_clause=eligibility)).fetchone()
        if count_row["n"] == 0:
            break

        result = submit_batch(conn, model=model, force=force, client=client)
        if result is None:
            print(
                f"{YELLOW}llm-classify-run:{RESET} submit declined despite {count_row['n']} eligible "
                "papers (likely a stale in-flight batch not accounted for) -- stopping."
            )
            stopped_early = True
            break

        rounds += 1
        batch_id = result["batch_id"]
        print(
            f"{BLUE}llm-classify-run:{RESET} round {rounds}: submitted {batch_id} with "
            f"{result['n_requests']} papers, waiting for it to finish..."
        )
        _wait_for(batch_id)

    if stopped_early:
        print(
            f"{YELLOW}llm-classify-run:{RESET} stopped early after {rounds} batch(es) -- "
            f"classified={total_classified} relevant={total_relevant} errors={total_errors}."
        )
    else:
        print(
            f"{GREEN}llm-classify-run:{RESET} done -- {rounds} batch(es), classified={total_classified} "
            f"relevant={total_relevant} errors={total_errors}, no eligible papers remain."
        )
    return {
        "rounds": rounds,
        "classified": total_classified,
        "relevant": total_relevant,
        "errors": total_errors,
        "stopped_early": stopped_early,
    }


def cmd_llm_classify_run(args) -> None:
    from .db import connect

    conn = connect(args.db)
    try:
        run_until_done(conn, model=args.model, force=args.force, poll_interval=args.poll_interval)
    finally:
        conn.close()
