from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator

from evaluation.framework.scorecard import ScorecardInput, build_scorecard
from evaluation.runner import run_case


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_PATH = REPO_ROOT / "apps" / "evaluation-console" / "server.py"
HANDOFF_SCHEMA_PATH = (
    REPO_ROOT / "apps" / "evaluation-console" / "schemas" / "optimization-handoff.schema.json"
)
CASE_PATH = REPO_ROOT / "evaluation" / "cases" / "cesiumjs-entities" / "eval-001-translate-marker-east-6m.json"
EVIDENCE_PATH = (
    REPO_ROOT
    / "evaluation"
    / "fixtures"
    / "cesiumjs-entities"
    / "eval-001-under-translation.evidence.json"
)


def _load_server():
    spec = importlib.util.spec_from_file_location("evaluation_review_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["evaluation_review_server"] = module
    spec.loader.exec_module(module)
    return module


def _scorecard() -> dict:
    case = json.loads(CASE_PATH.read_text())
    evidence = json.loads(EVIDENCE_PATH.read_text())
    return build_scorecard(
        [
            ScorecardInput(
                case=case,
                result=run_case(case, evidence),
                evidence_path=(
                    "evaluation/fixtures/cesiumjs-entities/"
                    "eval-001-under-translation.evidence.json"
                ),
            )
        ],
        commit="abc123",
        timestamp_utc="2026-06-25T00:00:00Z",
    )


def test_evaluation_review_handoff_matches_schema(tmp_path: Path) -> None:
    server = _load_server()
    scorecard_path = tmp_path / "scorecard.json"
    scorecard_path.write_text(json.dumps(_scorecard()), encoding="utf-8")
    context = server.ViewerContext(scorecard_path, tmp_path)

    focus_payload = server.build_focus_payload(
        context,
        ["cesiumjs-entities/eval-001"],
    )
    handoff = server.build_handoff_doc(context, focus_payload, "confirmed_flags")

    schema = json.loads(HANDOFF_SCHEMA_PATH.read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    Draft7Validator(schema).validate(handoff)

    assert handoff["focus_path"] == str(tmp_path / "focus.json")
    assert "--from-focus" in handoff["command"]
    assert handoff["skills"] == [
        {
            "skill": "cesiumjs-entities",
            "failed_cases": 1,
            "categories": ["semantic_scene_state"],
            "priority": 0,
        }
    ]
    assert "failed_checks" not in handoff["skills"][0]
    assert handoff["cases"][0]["deterministic_result"] == "fail"
