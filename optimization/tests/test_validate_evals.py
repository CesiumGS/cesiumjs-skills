"""Tests for the public eval manifest validator."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "optimization" / "scripts" / "validate-evals.py"


def load_validate_evals():
    spec = importlib.util.spec_from_file_location("validate_evals", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["validate_evals"] = module
    spec.loader.exec_module(module)
    return module


def test_validate_baselines_rejects_stale_hash(monkeypatch, tmp_path):
    validator = load_validate_evals()
    baselines_path = tmp_path / "baselines.json"
    baselines_path.write_text(json.dumps({
        "schema_version": "1.0",
        "scenarios": {"cesiumjs-camera": {"eval-001": "old-hash"}},
    }))
    monkeypatch.setattr(validator, "BASELINES_PATH", baselines_path)

    with pytest.raises(SystemExit):
        validator.validate_baselines({"cesiumjs-camera": {"eval-001": "new-hash"}})


def test_validate_baselines_does_not_modify_file(monkeypatch, tmp_path):
    validator = load_validate_evals()
    baselines_path = tmp_path / "baselines.json"
    content = json.dumps({
        "schema_version": "1.0",
        "scenarios": {"cesiumjs-camera": {"eval-001": "same-hash"}},
    })
    baselines_path.write_text(content)
    monkeypatch.setattr(validator, "BASELINES_PATH", baselines_path)

    validator.validate_baselines({"cesiumjs-camera": {"eval-001": "same-hash"}})

    assert baselines_path.read_text() == content


def test_validate_results_rejects_stale_runner_mode_counts(monkeypatch, tmp_path):
    validator = load_validate_evals()
    results_path = tmp_path / "public-status.json"
    results_path.write_text(json.dumps({
        "schema_version": "1.0",
        "summary_type": "public-sanitized-eval-status",
        "skills": [
            {
                "skill": "cesiumjs-viewer-setup",
                "scenario_count": 7,
                "runner_mode_counts": {"review-only": 7},
            }
        ],
    }))
    monkeypatch.setattr(validator, "RESULTS_PATH", results_path)

    with pytest.raises(SystemExit):
        validator.validate_results(
            {"cesiumjs-viewer-setup": 7},
            {"cesiumjs-viewer-setup": {"global-js": 7}},
        )
