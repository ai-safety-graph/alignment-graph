from __future__ import annotations

import argparse

import pytest

from aisafety_pipeline import utils


def _make_args(**overrides):
    defaults = dict(db=None, seeds="seeds.txt", tau=0.92, filter_method="centroid",
                     device="auto", coords="umap", skip=[])
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


def _recording_stages(calls: list[str], *, failing_stage: str | None = None):
    stages = []
    for name, _ in utils._RUN_ALL_STAGES:
        if name == failing_stage:
            def _fn(ns, _name=name):
                calls.append(_name)
                raise RuntimeError(f"{_name} exploded")
        else:
            def _fn(ns, _name=name):
                calls.append(_name)
        stages.append((name, _fn))
    return stages


@pytest.fixture(autouse=True)
def _record_calls(monkeypatch):
    """Keep run-all tests DB-free: stub the end-of-run batch bookkeeping and
    record when it's called."""
    calls: list[str | None] = []
    monkeypatch.setattr(utils, "_record_latest_batch_safely", lambda db, started_at: calls.append(db))
    return calls


def test_run_all_runs_every_stage_in_documented_order(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(utils, "_RUN_ALL_STAGES", _recording_stages(calls))

    utils._cmd_run_all(_make_args())

    assert calls == [
        "harvest", "stage1", "embed", "filter", "llm-classify", "embed-topic", "compute-layout",
    ]


def test_run_all_embed_topic_runs_after_llm_classify():
    """embed-topic only embeds llm_relevant rows (set by llm-classify) --
    running it before llm-classify would embed nothing new, and compute-layout
    would then skip newly-relevant papers that have no topic vector yet."""
    names = [name for name, _ in utils._RUN_ALL_STAGES]
    assert names.index("llm-classify") < names.index("embed-topic") < names.index("compute-layout")


def test_run_all_skips_named_stages(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(utils, "_RUN_ALL_STAGES", _recording_stages(calls))

    utils._cmd_run_all(_make_args(skip=["embed", "llm-classify"]))

    assert calls == ["harvest", "stage1", "filter", "embed-topic", "compute-layout"]


def test_run_all_stops_at_first_failing_stage_without_running_later_ones(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(utils, "_RUN_ALL_STAGES", _recording_stages(calls, failing_stage="filter"))

    with pytest.raises(RuntimeError, match="filter exploded"):
        utils._cmd_run_all(_make_args())

    assert calls == ["harvest", "stage1", "embed", "filter"]


def test_run_all_records_latest_batch_once_after_all_stages(monkeypatch, _record_calls):
    calls: list[str] = []
    monkeypatch.setattr(utils, "_RUN_ALL_STAGES", _recording_stages(calls))

    utils._cmd_run_all(_make_args(db="postgresql://example"))

    assert _record_calls == ["postgresql://example"]


def test_run_all_does_not_record_latest_batch_when_a_stage_fails(monkeypatch, _record_calls):
    calls: list[str] = []
    monkeypatch.setattr(utils, "_RUN_ALL_STAGES", _recording_stages(calls, failing_stage="embed"))

    with pytest.raises(RuntimeError):
        utils._cmd_run_all(_make_args())

    assert _record_calls == []
