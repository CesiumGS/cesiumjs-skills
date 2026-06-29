from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from evaluation.framework.scorecard import ScorecardInput, build_scorecard
from evaluation.runner import run_case
from optimization.framework.scorecard_focus import build_focus, focus_to_decision, focus_to_markdown


REPO_ROOT = Path(__file__).resolve().parents[2]
EVALUATION_ROOT = REPO_ROOT / "evaluation"
RUN_SCORECARD_SCRIPT = EVALUATION_ROOT / "scripts" / "run-scorecard.py"
SCORECARD_FOCUS_SCRIPT = REPO_ROOT / "optimization" / "scripts" / "scorecard-focus.py"


def _json(path: Path) -> dict:
    return json.loads(path.read_text())


def _case(skill: str, filename: str) -> dict:
    return _json(EVALUATION_ROOT / "cases" / skill / filename)


def _evidence(skill: str, filename: str) -> dict:
    return _json(EVALUATION_ROOT / "fixtures" / skill / filename)


def _load_script(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_focus_prioritizes_critical_scorecard_failures() -> None:
    camera_case = _case("cesiumjs-camera", "eval-001-target-view-volume.json")
    camera_result = run_case(camera_case, _evidence("cesiumjs-camera", "eval-001-overhead.evidence.json"))
    spatial_case = _case("cesiumjs-spatial-math", "eval-001-cartesian-translation-contract.json")
    spatial_result = run_case(
        spatial_case,
        _evidence("cesiumjs-spatial-math", "eval-001-mutating-output.evidence.json"),
    )
    scorecard = build_scorecard(
        [
            ScorecardInput(
                case=camera_case,
                result=camera_result,
                evidence_path="evaluation/fixtures/cesiumjs-camera/eval-001-overhead.evidence.json",
            ),
            ScorecardInput(
                case=spatial_case,
                result=spatial_result,
                evidence_path="evaluation/fixtures/cesiumjs-spatial-math/eval-001-mutating-output.evidence.json",
            ),
        ],
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )

    focus = build_focus(scorecard)

    assert focus["focus_required"]
    assert [category["category"] for category in focus["categories"]] == [
        "camera_framing",
        "semantic_scene_state",
    ]
    assert focus["cases"][0]["skill"] == "cesiumjs-camera"
    assert focus["cases"][0]["failed_checks"][0]["check_id"] == "camera_views_target_not_overhead"


def test_focus_markdown_has_reviewable_failure_context() -> None:
    case = _case("cesiumjs-entities", "eval-001-translate-marker-east-6m.json")
    result = run_case(case, _evidence("cesiumjs-entities", "eval-001-under-translation.evidence.json"))
    scorecard = build_scorecard(
        [
            ScorecardInput(
                case=case,
                result=result,
                evidence_path="evaluation/fixtures/cesiumjs-entities/eval-001-under-translation.evidence.json",
            )
        ],
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )

    markdown = focus_to_markdown(build_focus(scorecard))

    assert "Optimization Focus From Scorecard" in markdown
    assert "semantic_scene_state" in markdown
    assert "east_6m" in markdown
    assert "eval-001-under-translation.evidence.json" in markdown


def test_focus_can_emit_skill_scoped_decision_record() -> None:
    camera_case = _case("cesiumjs-camera", "eval-001-target-view-volume.json")
    camera_result = run_case(camera_case, _evidence("cesiumjs-camera", "eval-001-overhead.evidence.json"))
    entity_case = _case("cesiumjs-entities", "eval-001-translate-marker-east-6m.json")
    entity_result = run_case(entity_case, _evidence("cesiumjs-entities", "eval-001-under-translation.evidence.json"))
    scorecard = build_scorecard(
        [
            ScorecardInput(
                case=camera_case,
                result=camera_result,
                evidence_path="evaluation/fixtures/cesiumjs-camera/eval-001-overhead.evidence.json",
            ),
            ScorecardInput(
                case=entity_case,
                result=entity_result,
                evidence_path="evaluation/fixtures/cesiumjs-entities/eval-001-under-translation.evidence.json",
            ),
        ],
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )

    decision = focus_to_decision(build_focus(scorecard), skill="cesiumjs-camera")

    assert decision["decision"] == "SCORECARD_FOCUS"
    assert decision["rule_fired"] == "scorecard_critical_failure_focus"
    assert decision["counts"]["losses"] == 1
    assert "camera_views_target_not_overhead" in decision["rationale"]
    assert decision["scorecard_focus"]["skill"] == "cesiumjs-camera"
    assert [case["skill"] for case in decision["scorecard_focus"]["cases"]] == ["cesiumjs-camera"]


def test_focus_includes_blocking_visual_review_failures() -> None:
    case = _case("cesiumjs-entities", "eval-001-translate-marker-east-6m.json")
    result = run_case(case, _evidence("cesiumjs-entities", "eval-001-pass.evidence.json"))
    scorecard = build_scorecard(
        [
            ScorecardInput(
                case=case,
                result=result,
                evidence_path="evaluation/fixtures/cesiumjs-entities/eval-001-pass.evidence.json",
            )
        ],
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
        visual_review={
            "schema_version": "1.0",
            "reviewer": "screenshot-visual-judge",
            "reviewed_at": "2026-05-27T00:00:00+00:00",
            "items": [
                {
                    "skill": "cesiumjs-entities",
                    "case_id": "eval-001",
                    "case_name": "translate-marker-east-6m",
                    "status": "fail",
                    "blocking": True,
                    "overall_score": 3.0,
                    "summary": "The marker is visible but not translated far enough east.",
                    "dimensions": {
                        "prompt_and_behavior_fidelity": {
                            "status": "fail",
                            "score": 3.0,
                            "note": "The marker remains near its starting point.",
                        }
                    },
                }
            ],
        },
        require_visual_review=True,
    )

    focus = build_focus(scorecard)

    assert focus["focus_required"]
    assert focus["categories"][0]["category"] == "visual_review"
    assert focus["categories"][0]["failed_checks"] == 1
    assert focus["skills"] == [{"skill": "cesiumjs-entities", "failed_checks": 1}]
    visual_check = focus["cases"][0]["failed_checks"][0]
    assert visual_check["check_id"] == "visual_review_fail"
    assert visual_check["category"] == "visual_review"
    assert visual_check["critical"] is True
    assert "translated far enough east" in visual_check["detail"]
    assert "prompt_and_behavior_fidelity" in visual_check["detail"]


def test_scorecard_focus_cli_writes_markdown(tmp_path: Path) -> None:
    run_scorecard = _load_script(RUN_SCORECARD_SCRIPT, "run_scorecard_for_focus_test")
    focus_script = _load_script(SCORECARD_FOCUS_SCRIPT, "scorecard_focus_script_test")
    scorecard_dir = tmp_path / "scorecard"
    focus_path = tmp_path / "focus.md"

    assert run_scorecard.main(
        [
            "--fixture-expectation",
            "fail",
            "--output-dir",
            str(scorecard_dir),
        ]
    ) == 1

    assert focus_script.main(
        [
            str(scorecard_dir / "scorecard.json"),
            "--format",
            "markdown",
            "--output",
            str(focus_path),
        ]
    ) == 0
    assert "Optimization Focus From Scorecard" in focus_path.read_text()


def test_scorecard_focus_cli_writes_decision(tmp_path: Path) -> None:
    run_scorecard = _load_script(RUN_SCORECARD_SCRIPT, "run_scorecard_for_decision_test")
    focus_script = _load_script(SCORECARD_FOCUS_SCRIPT, "scorecard_focus_decision_script_test")
    scorecard_dir = tmp_path / "scorecard"
    decision_path = tmp_path / "decision.json"

    assert run_scorecard.main(
        [
            "--fixture-expectation",
            "fail",
            "--output-dir",
            str(scorecard_dir),
        ]
    ) == 1

    assert focus_script.main(
        [
            str(scorecard_dir / "scorecard.json"),
            "--format",
            "decision",
            "--skill",
            "cesiumjs-camera",
            "--output",
            str(decision_path),
        ]
    ) == 0
    decision = json.loads(decision_path.read_text())
    assert decision["decision"] == "SCORECARD_FOCUS"
    assert decision["scorecard_focus"]["skill"] == "cesiumjs-camera"
