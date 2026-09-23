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


def test_run_all_runs_every_stage_in_documented_order(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(utils, "_RUN_ALL_STAGES", _recording_stages(calls))

    utils._cmd_run_all(_make_args())

    assert calls == [
        "harvest", "stage1", "embed", "filter", "embed-topic", "llm-classify", "compute-layout",
    ]


def test_run_all_embed_topic_runs_after_filter():
    """embed-topic only embeds ai_stage2_keep=TRUE rows (set by filter) --
    running it before filter would embed nothing useful, and compute-layout
    would then hard-fail on newly-kept papers with no topic vector."""
    names = [name for name, _ in utils._RUN_ALL_STAGES]
    assert names.index("filter") < names.index("embed-topic") < names.index("compute-layout")


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
