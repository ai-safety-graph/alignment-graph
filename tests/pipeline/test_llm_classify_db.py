from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

import pytest

from aisafety_pipeline import llm_classify
from aisafety_pipeline.llm_classify import (
    LlmClassification,
    TokenUsage,
    classify_papers,
    collect_batch,
    submit_batch,
)


def _stub_classify_paper(title, abstract, *, model, client=None):
    return (
        LlmClassification(
            relevant=True,
            confidence=0.9,
            reason="stub",
            tags=["alignment and value specification"],
            raw_model_output="{}",
        ),
        TokenUsage(prompt_tokens=100, cached_tokens=80, completion_tokens=10),
    )


@pytest.fixture(autouse=True)
def _patch_classify_paper(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(llm_classify, "classify_paper", _stub_classify_paper)


@pytest.fixture
def cleanup_ids(conn):
    """classify_papers commits real writes when not in dry-run mode (unlike
    the pure read-only code paths the rest of the suite exercises through
    `conn`), and `conn.commit()` flushes every prior statement on that
    connection -- including this test's `make_paper` inserts -- not just the
    classification write. That means the `conn` fixture's rollback-on-
    teardown can't undo them. Explicitly delete each test's own rows
    (cascades papers -> paper_tags) so the local test DB doesn't accumulate
    permanent rows across runs; safe to call even when nothing was actually
    committed (the delete/commit pair is then a no-op)."""
    ids: list[str] = []
    yield ids
    if ids:
        conn.execute("DELETE FROM papers_raw WHERE id = ANY(%s)", (ids,))
        conn.commit()


def _row(conn, pid):
    return conn.execute(
        "SELECT llm_relevant, llm_confidence, llm_tags, llm_reason, llm_model, llm_classified_at "
        "FROM papers WHERE id = %s",
        (pid,),
    ).fetchone()


def test_classify_papers_only_writes_eligible_unclassified_rows(conn, make_paper, cleanup_ids):
    kept = make_paper("2401.10001", ai_stage2_keep=True)
    not_kept = make_paper("2401.10002", ai_stage2_keep=False)
    cleanup_ids += [kept, not_kept]

    classify_papers(conn, model="test-model")

    row = _row(conn, kept)
    assert row["llm_relevant"] is True
    assert row["llm_confidence"] == pytest.approx(0.9)
    assert list(row["llm_tags"]) == ["alignment and value specification"]
    assert row["llm_reason"] == "stub"
    assert row["llm_model"] == "test-model"
    assert row["llm_classified_at"] is not None

    assert _row(conn, not_kept)["llm_classified_at"] is None


def test_classify_papers_skips_already_classified_unless_forced(conn, make_paper, cleanup_ids):
    pid = make_paper("2401.10003", ai_stage2_keep=True)
    cleanup_ids.append(pid)
    conn.execute(
        "UPDATE papers SET llm_classified_at = %s WHERE id = %s",
        (dt.datetime.now(dt.UTC), pid),
    )

    classify_papers(conn, model="test-model")
    assert _row(conn, pid)["llm_model"] is None  # not reclassified -- stub model never written

    classify_papers(conn, model="test-model", force=True)
    assert _row(conn, pid)["llm_model"] == "test-model"


def test_classify_papers_dry_run_writes_nothing(conn, make_paper, cleanup_ids):
    pid = make_paper("2401.10004", ai_stage2_keep=True)
    cleanup_ids.append(pid)

    classify_papers(conn, model="test-model", dry_run=True)

    assert _row(conn, pid)["llm_classified_at"] is None


def test_classify_papers_respects_limit(conn, make_paper, cleanup_ids):
    a = make_paper("2401.10005", ai_stage2_keep=True)
    b = make_paper("2401.10006", ai_stage2_keep=True)
    cleanup_ids += [a, b]

    stats = classify_papers(conn, model="test-model", limit=1)
    assert stats["scanned"] == 1
    assert stats["classified"] == 1


class _FakeClient:
    """Minimal stand-in for openai.OpenAI covering only the files/batches
    methods submit_batch/collect_batch call, so batch tests don't need
    network access or a real API key."""

    def __init__(self, *, batch=None, file_contents: dict[str, str] | None = None):
        self._next_file_id = 0
        self.uploaded_files: list[tuple[str, bytes, str]] = []
        self._batch = batch
        self._file_contents = file_contents or {}
        self.files = SimpleNamespace(create=self._files_create, content=self._files_content)
        self.batches = SimpleNamespace(create=self._batches_create, retrieve=self._batches_retrieve)

    def _files_create(self, *, file, purpose):
        self._next_file_id += 1
        fid = f"file_{self._next_file_id}"
        self.uploaded_files.append((fid, file.read(), purpose))
        return SimpleNamespace(id=fid)

    def _files_content(self, file_id):
        return SimpleNamespace(text=self._file_contents.get(file_id, ""))

    def _batches_create(self, **kwargs):
        return self._batch

    def _batches_retrieve(self, batch_id):
        return self._batch


@pytest.fixture
def batch_state_file(tmp_path, monkeypatch):
    """Point llm_classify's batch-tracking state file at a scratch path so
    tests never read/write the real data/llm_batches.json used by actual
    submit/collect runs."""
    path = tmp_path / "llm_batches.json"
    monkeypatch.setattr(llm_classify, "_BATCH_STATE_FILE", path)
    return path


def test_submit_batch_marks_papers_and_records_state(conn, make_paper, cleanup_ids, batch_state_file):
    a = make_paper("2401.20001", ai_stage2_keep=True)
    b = make_paper("2401.20002", ai_stage2_keep=True)
    cleanup_ids += [a, b]

    fake_batch = SimpleNamespace(id="batch_abc", model="test-model")
    client = _FakeClient(batch=fake_batch)

    result = submit_batch(conn, model="test-model", client=client)

    assert result == {"batch_id": "batch_abc", "n_requests": 2}
    assert len(client.uploaded_files) == 1
    submitted_ids = {json.loads(line)["custom_id"] for line in client.uploaded_files[0][1].decode().splitlines()}
    assert submitted_ids == {a, b}

    row = conn.execute("SELECT llm_batch_id FROM papers WHERE id = %s", (a,)).fetchone()
    assert row["llm_batch_id"] == "batch_abc"

    state = json.loads(batch_state_file.read_text())
    assert state[0]["batch_id"] == "batch_abc"
    assert state[0]["status"] == "submitted"


def test_submit_batch_dry_run_never_touches_client_or_db(conn, make_paper, cleanup_ids):
    pid = make_paper("2401.20003", ai_stage2_keep=True)
    cleanup_ids.append(pid)

    class _ExplodingClient:
        def __getattr__(self, name):
            raise AssertionError("dry-run must not touch the API client")

    result = submit_batch(conn, model="test-model", dry_run=True, client=_ExplodingClient())
    assert result is None

    row = conn.execute("SELECT llm_batch_id FROM papers WHERE id = %s", (pid,)).fetchone()
    assert row["llm_batch_id"] is None


def test_submit_batch_excludes_papers_already_in_flight(conn, make_paper, cleanup_ids, batch_state_file):
    pid = make_paper("2401.20004", ai_stage2_keep=True)
    cleanup_ids.append(pid)
    conn.execute("UPDATE papers SET llm_batch_id = %s WHERE id = %s", ("other_batch", pid))

    fake_batch = SimpleNamespace(id="batch_xyz", model="test-model")
    client = _FakeClient(batch=fake_batch)

    result = submit_batch(conn, model="test-model", client=client)
    assert result is None  # nothing eligible -- pid is already in flight


def test_submit_batch_blocks_when_another_batch_is_still_processing(conn, make_paper, cleanup_ids, batch_state_file):
    pid = make_paper("2401.20007", ai_stage2_keep=True)
    cleanup_ids.append(pid)
    llm_classify._record_batch_state(batch_id="batch_pending", status="submitted")

    # The pending batch is still "in_progress" when checked live -- this is
    # the exact scenario that caused a real token_limit_exceeded failure
    # (three ~20k-request batches submitted back to back).
    client = _FakeClient(batch=SimpleNamespace(id="batch_pending", status="in_progress"))

    result = submit_batch(conn, model="test-model", client=client)
    assert result is None
    assert client.uploaded_files == []  # never even tried to build/upload a new batch

    row = conn.execute("SELECT llm_batch_id FROM papers WHERE id = %s", (pid,)).fetchone()
    assert row["llm_batch_id"] is None  # untouched -- submission never proceeded


def test_submit_batch_allow_concurrent_bypasses_the_pending_check(conn, make_paper, cleanup_ids, batch_state_file):
    pid = make_paper("2401.20008", ai_stage2_keep=True)
    cleanup_ids.append(pid)
    llm_classify._record_batch_state(batch_id="batch_pending2", status="submitted")

    # allow_concurrent=True skips the pending-batches check entirely, so it
    # never calls batches.retrieve -- only batches.create, for the new batch.
    client = _FakeClient(batch=SimpleNamespace(id="batch_new", model="test-model"))

    result = submit_batch(conn, model="test-model", client=client, allow_concurrent=True)
    assert result == {"batch_id": "batch_new", "n_requests": 1}


def test_submit_batch_stops_at_enqueued_token_cap(conn, make_paper, cleanup_ids, batch_state_file, monkeypatch):
    a = make_paper("2401.20009", ai_stage2_keep=True)
    b = make_paper("2401.20010", ai_stage2_keep=True)
    cleanup_ids += [a, b]

    # Both papers use insert_paper's default title/summary, so their request
    # lines are (near-)identical in size -- compute that size directly
    # rather than guessing, and set the cap to comfortably admit exactly one.
    one_line = llm_classify.build_batch_request_line(a, "Example Paper", "An example abstract.", model="test-model")
    one_line_tokens = llm_classify._estimate_tokens(json.dumps(one_line) + "\n")
    monkeypatch.setattr(llm_classify, "LLM_BATCH_MAX_ENQUEUED_TOKENS", int(one_line_tokens * 1.5))

    fake_batch = SimpleNamespace(id="batch_capped", model="test-model")
    client = _FakeClient(batch=fake_batch)

    result = submit_batch(conn, model="test-model", client=client)
    assert result == {"batch_id": "batch_capped", "n_requests": 1}


class _AutoCompletingFakeClient:
    """Simulates the Batch API completing every submitted batch instantly
    (status="completed" on the very first retrieve), echoing back a fixed
    "not relevant" judgment for every custom_id actually uploaded -- lets
    run_until_done be exercised end-to-end across multiple real submit/
    collect rounds without network calls or sleeping."""

    def __init__(self):
        self._next_id = 0
        self._file_contents: dict[str, str] = {}
        self._batches: dict[str, SimpleNamespace] = {}
        self.files = SimpleNamespace(create=self._files_create, content=self._files_content)
        self.batches = SimpleNamespace(create=self._batches_create, retrieve=self._batches_retrieve)

    def _new_id(self, prefix: str) -> str:
        self._next_id += 1
        return f"{prefix}_{self._next_id}"

    def _files_create(self, *, file, purpose):
        fid = self._new_id("file")
        self._file_contents[fid] = file.read().decode("utf-8")
        return SimpleNamespace(id=fid)

    def _files_content(self, file_id):
        return SimpleNamespace(text=self._file_contents.get(file_id, ""))

    def _batches_create(self, *, input_file_id, endpoint, completion_window, metadata):
        lines = [json.loads(line) for line in self._file_contents[input_file_id].splitlines() if line.strip()]
        output_lines = [
            json.dumps({
                "custom_id": line["custom_id"],
                "response": {
                    "status_code": 200,
                    "body": {
                        "choices": [{"message": {"content": json.dumps({
                            "relevant": False, "confidence": 0.9, "reason": "stub", "tags": [],
                        })}}],
                        "usage": {
                            "prompt_tokens": 100, "completion_tokens": 10,
                            "prompt_tokens_details": {"cached_tokens": 80},
                        },
                    },
                },
                "error": None,
            })
            for line in lines
        ]
        output_fid = self._new_id("outfile")
        self._file_contents[output_fid] = "\n".join(output_lines)

        n = len(lines)
        batch_id = self._new_id("batch")
        batch = SimpleNamespace(
            id=batch_id, status="completed", output_file_id=output_fid, error_file_id=None,
            model=metadata["model"], request_counts=SimpleNamespace(completed=n, total=n, failed=0),
            usage=SimpleNamespace(
                input_tokens=100 * n, output_tokens=10 * n,
                input_tokens_details=SimpleNamespace(cached_tokens=80 * n),
            ),
        )
        self._batches[batch_id] = batch
        return batch

    def _batches_retrieve(self, batch_id):
        return self._batches[batch_id]


def test_run_until_done_processes_all_eligible_papers_across_rounds(
    conn, make_paper, cleanup_ids, batch_state_file, monkeypatch
):
    # Force multiple rounds even for a handful of papers, so this actually
    # exercises the loop-until-nothing-eligible-remains behavior rather than
    # finishing in one submit/collect pass.
    monkeypatch.setattr(llm_classify, "_BATCH_MAX_REQUESTS", 2)

    ids = [make_paper(f"2401.300{i:02d}", ai_stage2_keep=True) for i in range(5)]
    cleanup_ids.extend(ids)

    client = _AutoCompletingFakeClient()
    result = llm_classify.run_until_done(conn, model="test-model", poll_interval=0, client=client)

    assert result["rounds"] == 3  # 2 + 2 + 1
    assert result["classified"] == 5

    row = conn.execute(
        "SELECT count(*) AS n FROM papers WHERE id = ANY(%s) AND llm_classified_at IS NOT NULL", (ids,)
    ).fetchone()
    assert row["n"] == 5


def test_run_until_done_resumes_an_already_pending_batch_first(conn, make_paper, cleanup_ids, batch_state_file):
    # Simulate a previous run that submitted a batch and was then killed
    # before it could wait for/collect it (confirmed in practice: an OOM
    # kill mid-poll left exactly this state).
    already_submitted = make_paper("2401.30100", ai_stage2_keep=True)
    fresh = make_paper("2401.30101", ai_stage2_keep=True)
    cleanup_ids += [already_submitted, fresh]

    conn.execute("UPDATE papers SET llm_batch_id = %s WHERE id = %s", ("batch_pending", already_submitted))
    llm_classify._record_batch_state(batch_id="batch_pending", status="submitted")

    client = _AutoCompletingFakeClient()
    # Register the pending batch directly (bypassing _batches_create, which
    # would normally have produced it on the earlier, now-interrupted run)
    # so retrieve() finds it already resolved.
    client._batches["batch_pending"] = SimpleNamespace(
        id="batch_pending", status="completed", output_file_id="preexisting_output",
        error_file_id=None, model="test-model",
        request_counts=SimpleNamespace(completed=1, total=1, failed=0),
        usage=SimpleNamespace(
            input_tokens=100, output_tokens=10, input_tokens_details=SimpleNamespace(cached_tokens=80)
        ),
    )
    client._file_contents["preexisting_output"] = json.dumps({
        "custom_id": already_submitted,
        "response": {
            "status_code": 200,
            "body": {
                "choices": [{"message": {"content": json.dumps({
                    "relevant": False, "confidence": 0.9, "reason": "stub", "tags": [],
                })}}],
                "usage": {
                    "prompt_tokens": 100, "completion_tokens": 10,
                    "prompt_tokens_details": {"cached_tokens": 80},
                },
            },
        },
        "error": None,
    })

    result = llm_classify.run_until_done(conn, model="test-model", poll_interval=0, client=client)

    assert conn.execute(
        "SELECT llm_classified_at FROM papers WHERE id = %s", (already_submitted,)
    ).fetchone()["llm_classified_at"] is not None
    assert conn.execute(
        "SELECT llm_classified_at FROM papers WHERE id = %s", (fresh,)
    ).fetchone()["llm_classified_at"] is not None
    assert result["rounds"] == 1  # only `fresh` needed a brand-new submission
    assert result["stopped_early"] is False


def test_collect_batch_in_progress_does_not_write(conn):
    fake_batch = SimpleNamespace(
        id="batch_1", status="in_progress", output_file_id=None, error_file_id=None,
        model=None, request_counts=SimpleNamespace(completed=0, total=2, failed=0), usage=None,
    )
    client = _FakeClient(batch=fake_batch)

    result = collect_batch(conn, "batch_1", client=client)
    assert result == {"status": "in_progress", "collected": False, "classified": 0, "relevant": 0, "errors": 0}


def test_collect_batch_failed_releases_papers_for_resubmission(conn, make_paper, cleanup_ids, batch_state_file):
    pid = make_paper("2401.20005", ai_stage2_keep=True)
    cleanup_ids.append(pid)
    conn.execute("UPDATE papers SET llm_batch_id = %s WHERE id = %s", ("batch_2", pid))
    llm_classify._record_batch_state(batch_id="batch_2", status="submitted")

    fake_batch = SimpleNamespace(
        id="batch_2", status="failed", output_file_id=None, error_file_id=None,
        model=None, request_counts=None, usage=None,
    )
    client = _FakeClient(batch=fake_batch)

    result = collect_batch(conn, "batch_2", client=client)
    assert result == {"status": "failed", "collected": False, "classified": 0, "relevant": 0, "errors": 0}

    row = conn.execute("SELECT llm_batch_id FROM papers WHERE id = %s", (pid,)).fetchone()
    assert row["llm_batch_id"] is None

    state = json.loads(batch_state_file.read_text())
    assert state[0]["status"] == "failed"


def test_collect_batch_completed_writes_results(conn, make_paper, cleanup_ids, batch_state_file):
    pid = make_paper("2401.20006", ai_stage2_keep=True)
    cleanup_ids.append(pid)
    llm_classify._record_batch_state(batch_id="batch_3", status="submitted")

    output_line = json.dumps({
        "custom_id": pid,
        "response": {
            "status_code": 200,
            "body": {
                "choices": [{"message": {"content": json.dumps({
                    "relevant": True,
                    "confidence": 0.9,
                    "reason": "stub",
                    "tags": ["alignment and value specification"],
                })}}],
                "usage": {
                    "prompt_tokens": 1300,
                    "completion_tokens": 50,
                    "prompt_tokens_details": {"cached_tokens": 1260},
                },
            },
        },
        "error": None,
    })

    fake_batch = SimpleNamespace(
        id="batch_3", status="completed", output_file_id="file_out", error_file_id=None,
        model="test-model", request_counts=SimpleNamespace(completed=1, total=1, failed=0),
        usage=SimpleNamespace(
            input_tokens=1300, output_tokens=50,
            input_tokens_details=SimpleNamespace(cached_tokens=1260),
        ),
    )
    client = _FakeClient(batch=fake_batch, file_contents={"file_out": output_line})

    result = collect_batch(conn, "batch_3", client=client)
    assert result == {"status": "completed", "collected": True, "classified": 1, "relevant": 1, "errors": 0}

    row = conn.execute(
        "SELECT llm_relevant, llm_tags, llm_model, llm_classified_at FROM papers WHERE id = %s", (pid,)
    ).fetchone()
    assert row["llm_relevant"] is True
    assert list(row["llm_tags"]) == ["alignment and value specification"]
    assert row["llm_model"] == "test-model"
    assert row["llm_classified_at"] is not None

    state = json.loads(batch_state_file.read_text())
    assert state[0]["status"] == "collected"
