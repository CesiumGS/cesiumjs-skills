"""Tests for optimization/scripts/run-all-evals.py."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import Mock, patch


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "optimization" / "scripts" / "run-all-evals.py"


def load_run_all():
    spec = importlib.util.spec_from_file_location("run_all_evals", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_all_evals"] = module
    spec.loader.exec_module(module)
    return module


def test_dry_run_lists_all_discovered_skills(capsys):
    run_all = load_run_all()

    result = run_all.main(["--dry-run", "--max-iterations", "1"])

    assert result == 0
    output = capsys.readouterr().out
    assert "cesiumjs-camera" in output
    assert "optimization/scripts/run-loop.py" in output


def test_unknown_skill_fails():
    run_all = load_run_all()

    try:
        run_all.selected_skills("not-a-skill")
    except SystemExit as exc:
        assert "Unknown skill" in str(exc)
    else:
        raise AssertionError("expected SystemExit for unknown skill")


def test_stops_on_first_failure_by_default():
    run_all = load_run_all()

    with patch.object(run_all, "discover_skills", return_value=["skill-a", "skill-b"]), \
         patch.object(run_all.subprocess, "run", return_value=Mock(returncode=1)) as mock_run:
        result = run_all.main(["--skills", "all"])

    assert result == 1
    assert mock_run.call_count == 1


def test_continue_on_failure_runs_remaining_skills():
    run_all = load_run_all()

    with patch.object(run_all, "discover_skills", return_value=["skill-a", "skill-b"]), \
         patch.object(run_all.subprocess, "run", return_value=Mock(returncode=1)) as mock_run:
        result = run_all.main(["--skills", "all", "--continue-on-failure"])

    assert result == 1
    assert mock_run.call_count == 2


def test_from_scorecard_selects_failed_skills_and_seeds_decisions(tmp_path, capsys):
    run_all = load_run_all()
    scorecard_path = tmp_path / "scorecard.json"
    scorecard_path.write_text(json.dumps({
        "run_id": "scorecard-test",
        "git_commit": "abc123",
        "overall_result": "fail",
        "overall_score": 0.5,
        "threshold": 0.95,
        "category_scores": {
            "camera_behavior": {
                "score": 0.0,
                "passed_weight": 0,
                "total_weight": 1,
                "passed_checks": 0,
                "total_checks": 1,
            }
        },
        "critical_failures": [
            {
                "skill": "cesiumjs-camera",
                "case_id": "eval-001",
                "case_name": "target-view-volume",
                "check_id": "camera_views_target_not_overhead",
                "category": "camera_behavior",
                "detail": "overhead camera",
            }
        ],
        "cases": [
            {
                "skill": "cesiumjs-camera",
                "case_id": "eval-001",
                "case_name": "target-view-volume",
                "task": "View target from an oblique angle",
                "category": "camera_behavior",
                "result": "fail",
                "score": 0.0,
                "evidence_path": "evaluation/fixtures/cesiumjs-camera/eval-001-overhead.evidence.json",
                "checks": [
                    {
                        "check_id": "camera_views_target_not_overhead",
                        "type": "camera_target_view",
                        "category": "camera_behavior",
                        "critical": True,
                        "result": "fail",
                        "actual": {"up_alignment": 1.0},
                        "expected": {"max_up_alignment": 0.75},
                        "tolerance": None,
                        "detail": "overhead camera",
                    }
                ],
            }
        ],
    }))

    with patch.object(run_all, "discover_skills", return_value=["cesiumjs-camera", "cesiumjs-entities"]), \
         patch.object(run_all, "FOCUS_TMP_ROOT", tmp_path / "focus-decisions"):
        result = run_all.main(["--from-scorecard", str(scorecard_path), "--dry-run"])

    assert result == 0
    output = capsys.readouterr().out
    assert "Scorecard focus selected skills" in output
    assert "cesiumjs-camera" in output
    assert "cesiumjs-entities" not in output
    assert "--proposer-decision-path" in output
    decision_path = tmp_path / "focus-decisions" / "scorecard-test" / "cesiumjs-camera-decision.json"
    decision = json.loads(decision_path.read_text())
    assert decision["decision"] == "SCORECARD_FOCUS"


def test_from_clean_focus_noops(tmp_path, capsys):
    run_all = load_run_all()
    focus_path = tmp_path / "focus.json"
    focus_path.write_text(json.dumps({
        "schema_version": "1.0",
        "source_run_id": "scorecard-clean",
        "focus_required": False,
        "categories": [],
        "skills": [],
        "cases": [],
    }))

    result = run_all.main(["--from-focus", str(focus_path), "--dry-run"])

    assert result == 0
    assert "No optimization recommended" in capsys.readouterr().out
