from __future__ import annotations

import json

import pytest

from aisafety_pipeline.llm_classify import (
    LlmParseError,
    build_batch_request_line,
    build_system_prompt,
    parse_batch_output_line,
    parse_response,
)
from aisafety_pipeline.taxonomy import TAXONOMY, TAXONOMY_DESCRIPTIONS


def test_build_system_prompt_is_deterministic():
    assert build_system_prompt() == build_system_prompt()


def test_build_system_prompt_contains_every_taxonomy_phrase_and_description():
    prompt = build_system_prompt()
    for phrase in TAXONOMY:
        assert phrase in prompt
        assert TAXONOMY_DESCRIPTIONS[phrase] in prompt


def _payload(**overrides) -> str:
    data = {"relevant": True, "confidence": 0.9, "reason": "because", "tags": []}
    data.update(overrides)
    return json.dumps(data)


def test_parse_response_round_trips_valid_json():
    result = parse_response(_payload(tags=["alignment and value specification"]))
    assert result.relevant is True
    assert result.confidence == 0.9
    assert result.reason == "because"
    assert result.tags == ["alignment and value specification"]
    assert result.dropped_tags == []


def test_parse_response_relevant_with_no_tags_is_valid():
    result = parse_response(_payload(relevant=True, tags=[]))
    assert result.relevant is True
    assert result.tags == []


def test_parse_response_drops_tags_outside_taxonomy_without_failing():
    result = parse_response(_payload(tags=["alignment and value specification", "not a real category"]))
    assert result.tags == ["alignment and value specification"]
    assert result.dropped_tags == ["not a real category"]


def test_parse_response_raises_on_malformed_json():
    with pytest.raises(LlmParseError):
        parse_response("not json at all")


def test_parse_response_raises_on_missing_field():
    with pytest.raises(LlmParseError):
        parse_response(json.dumps({"relevant": True, "confidence": 0.9, "tags": []}))


def test_parse_response_raises_on_confidence_out_of_range():
    with pytest.raises(LlmParseError):
        parse_response(_payload(confidence=1.5))


def test_parse_response_raises_on_wrong_type():
    with pytest.raises(LlmParseError):
        parse_response(_payload(relevant="yes"))


def test_build_batch_request_line_shape():
    line = build_batch_request_line("https://arxiv.org/abs/1234.5678", "A Title", "An abstract.", model="test-model")
    assert line["custom_id"] == "https://arxiv.org/abs/1234.5678"
    assert line["method"] == "POST"
    assert line["url"] == "/v1/chat/completions"
    assert line["body"]["model"] == "test-model"
    assert line["body"]["messages"][0]["role"] == "system"
    assert line["body"]["messages"][0]["content"] == build_system_prompt()
    assert "A Title" in line["body"]["messages"][1]["content"]


def _batch_output_line(**overrides) -> dict:
    line = {
        "custom_id": "https://arxiv.org/abs/1234.5678",
        "response": {
            "status_code": 200,
            "body": {
                "choices": [{"message": {"content": _payload(tags=["alignment and value specification"])}}],
                "usage": {
                    "prompt_tokens": 1300,
                    "completion_tokens": 50,
                    "prompt_tokens_details": {"cached_tokens": 1260},
                },
            },
        },
        "error": None,
    }
    line.update(overrides)
    return line


def test_parse_batch_output_line_success():
    pid, classification, usage, error = parse_batch_output_line(_batch_output_line())
    assert pid == "https://arxiv.org/abs/1234.5678"
    assert error is None
    assert classification.relevant is True
    assert classification.tags == ["alignment and value specification"]
    assert usage.prompt_tokens == 1300
    assert usage.cached_tokens == 1260
    assert usage.completion_tokens == 50


def test_parse_batch_output_line_request_level_error():
    pid, classification, usage, error = parse_batch_output_line(
        _batch_output_line(response=None, error={"code": "rate_limit", "message": "slow down"})
    )
    assert pid == "https://arxiv.org/abs/1234.5678"
    assert classification is None
    assert usage is None
    assert "slow down" in error


def test_parse_batch_output_line_non_200_status():
    pid, classification, usage, error = parse_batch_output_line(
        _batch_output_line(response={"status_code": 500, "body": {}})
    )
    assert classification is None
    assert "500" in error


def test_parse_batch_output_line_malformed_body_is_reported_as_error_not_raised():
    pid, classification, usage, error = parse_batch_output_line(
        _batch_output_line(response={"status_code": 200, "body": {"choices": []}})
    )
    assert classification is None
    assert error is not None


class _FakeWriteConn:
    """Stand-in for PgConnection recording commits/reconnects, so the
    per-chunk write logic is testable without a database."""

    def __init__(self):
        self.commits = 0
        self.reconnects = 0

    def raw_cursor(self):
        return object()

    def commit(self):
        self.commits += 1

    def reconnect(self):
        self.reconnects += 1


def _rows(n):
    return [(f"id{i}", True, 0.9, [], "r", "m", None) for i in range(n)]


def test_write_results_commits_after_every_chunk(monkeypatch):
    from aisafety_pipeline import llm_classify

    calls = []
    monkeypatch.setattr(llm_classify, "execute_values", lambda cur, sql, chunk, template: calls.append(len(chunk)))
    conn = _FakeWriteConn()

    llm_classify._write_results_committed(conn, _rows(120))

    assert calls == [50, 50, 20]  # _LLM_WRITE_BATCH = 50
    assert conn.commits == 3


def test_write_results_reconnects_and_retries_chunk_after_dropped_connection(monkeypatch):
    import psycopg2

    from aisafety_pipeline import llm_classify

    monkeypatch.setattr(llm_classify.time, "sleep", lambda s: None)
    attempts = {"n": 0}

    def flaky(cur, sql, chunk, template):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise psycopg2.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(llm_classify, "execute_values", flaky)
    conn = _FakeWriteConn()

    llm_classify._write_results_committed(conn, _rows(10))

    assert conn.reconnects == 1
    assert conn.commits == 1
    assert attempts["n"] == 2


def test_write_results_gives_up_after_repeated_connection_failures(monkeypatch):
    import psycopg2

    from aisafety_pipeline import llm_classify

    monkeypatch.setattr(llm_classify.time, "sleep", lambda s: None)

    def always_fails(cur, sql, chunk, template):
        raise psycopg2.OperationalError("down")

    monkeypatch.setattr(llm_classify, "execute_values", always_fails)

    with pytest.raises(psycopg2.OperationalError):
        llm_classify._write_results_committed(_FakeWriteConn(), _rows(5))
