#!/usr/bin/env python3
"""Tests for the rebaseline-scenario CLI."""

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "optimization" / "scripts" / "rebaseline-scenario.py"
BASELINES = REPO_ROOT / "optimization" / "results" / "baselines.json"


def test_rebaseline_dry_run_does_not_modify_baselines():
    before = BASELINES.read_bytes()

    result = subprocess.run(
        ["python3", str(SCRIPT), "cesiumjs-camera", "eval-001", "--dry-run"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Dry run; baselines.json was not modified" in result.stdout
    assert BASELINES.read_bytes() == before
