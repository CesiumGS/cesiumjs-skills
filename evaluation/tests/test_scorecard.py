from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator

from evaluation.framework.scorecard import (
    ScorecardInput,
    build_scorecard,
    resolve_codegen_provenance,
    scorecard_to_markdown,
)
from evaluation.runner import run_case


EVALUATION_ROOT = Path(__file__).resolve().parents[1]
CASE_PATH = EVALUATION_ROOT / "cases" / "cesiumjs-entities" / "eval-001-translate-marker-east-6m.json"
PASS_EVIDENCE_PATH = EVALUATION_ROOT / "fixtures" / "cesiumjs-entities" / "eval-001-pass.evidence.json"
FAIL_EVIDENCE_PATH = (
    EVALUATION_ROOT / "fixtures" / "cesiumjs-entities" / "eval-001-under-translation.evidence.json"
)
SCORECARD_SCHEMA_PATH = EVALUATION_ROOT / "schemas" / "scorecard.schema.json"
RESULT_SCHEMA_PATH = EVALUATION_ROOT / "schemas" / "result.schema.json"
RUN_SCORECARD_SCRIPT = EVALUATION_ROOT / "scripts" / "run-scorecard.py"


def _case() -> dict:
    return json.loads(CASE_PATH.read_text())


def _evidence(path: Path) -> dict:
    return json.loads(path.read_text())


def _scorecard_validator() -> Draft7Validator:
    schema = json.loads(SCORECARD_SCHEMA_PATH.read_text())
    result_schema = json.loads(RESULT_SCHEMA_PATH.read_text())
    schema["definitions"]["case_result"]["properties"]["checks"]["items"] = result_schema["definitions"]["check_result"]
    return Draft7Validator(schema)


def _load_run_scorecard():
    spec = importlib.util.spec_from_file_location("run_scorecard", RUN_SCORECARD_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_scorecard"] = module
    spec.loader.exec_module(module)
    return module


def test_scorecard_passes_with_positive_fixture() -> None:
    case = _case()
    result = run_case(case, _evidence(PASS_EVIDENCE_PATH))

    scorecard = build_scorecard(
        [ScorecardInput(case=case, result=result, evidence_path=str(PASS_EVIDENCE_PATH))],
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )

    _scorecard_validator().validate(scorecard)
    assert scorecard["overall_result"] == "pass"
    assert scorecard["deterministic_result"] == "pass"
    assert scorecard["overall_score"] == 1.0
    assert scorecard["visual_summary"]["result"] == "not_required"
    assert scorecard["critical_failures"] == []
    assert scorecard["category_scores"]["semantic_scene_state"]["score"] == 1.0
    assert scorecard["cases"][0]["probe_contract"]["capture"] == [
        "entities[marker].position_ecef",
        "entities[marker].position_cartographic",
    ]


def test_scorecard_fails_on_critical_translation_failure() -> None:
    case = _case()
    result = run_case(case, _evidence(FAIL_EVIDENCE_PATH))

    scorecard = build_scorecard(
        [ScorecardInput(case=case, result=result, evidence_path=str(FAIL_EVIDENCE_PATH))],
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )

    assert scorecard["overall_result"] == "fail"
    assert scorecard["overall_score"] < 1.0
    assert scorecard["critical_failures"][0]["check_id"] == "east_6m"
    assert abs(scorecard["critical_failures"][0]["actual"] - 5.9) < 1e-8
    assert scorecard["critical_failures"][0]["expected"] == 6.0
    assert scorecard["critical_failures"][0]["evidence_path"].endswith("eval-001-under-translation.evidence.json")


def test_scorecard_includes_first_class_visual_review() -> None:
    case = _case()
    result = run_case(case, _evidence(PASS_EVIDENCE_PATH))
    scorecard = build_scorecard(
        [ScorecardInput(case=case, result=result, evidence_path=str(PASS_EVIDENCE_PATH))],
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
        visual_review={
            "schema_version": "1.0",
            "reviewer": "local-review",
            "reviewed_at": "2026-05-27T00:00:00Z",
            "items": [
                {
                    "skill": "cesiumjs-entities",
                    "case_id": "eval-001",
                    "status": "pass",
                    "required": True,
                    "blocking": True,
                    "score": 0.92,
                    "summary": "Marker is visibly translated east with no obvious render artifacts.",
                    "dimensions": {
                        "nonblank_render": {"status": "pass", "note": "Canvas is populated."},
                        "target_visible": {"status": "pass", "note": "Marker is visible."},
                        "framing": {"status": "pass", "note": "Marker remains in context."},
                        "occlusion": {"status": "pass", "note": "No blocking UI overlap."},
                        "clutter": {"status": "pass", "note": "Scene is simple."},
                        "prompt_match": {"status": "pass", "note": "Visual evidence matches the requested translation."},
                    },
                    "observations": ["The target marker remains visible."],
                    "risks": ["Synthetic fixture does not prove real browser styling."],
                    "screenshots": ["evaluation/artifacts/example.png"],
                    "artifact_path": "evaluation/artifacts/review/example.json",
                }
            ],
        },
        require_visual_review=True,
    )

    _scorecard_validator().validate(scorecard)
    assert scorecard["overall_result"] == "pass"
    assert scorecard["visual_summary"]["result"] == "pass"
    assert scorecard["visual_summary"]["reviewed_count"] == 1
    assert scorecard["cases"][0]["visual_review"]["status"] == "pass"
    assert scorecard["cases"][0]["visual_review"]["summary"].startswith("Marker is visibly")
    assert scorecard["cases"][0]["visual_review"]["dimensions"]["target_visible"]["status"] == "pass"


def test_visual_review_defaults_unscored_dimensions_to_needs_review() -> None:
    case = _case()
    result = run_case(case, _evidence(PASS_EVIDENCE_PATH))
    scorecard = build_scorecard(
        [ScorecardInput(case=case, result=result, evidence_path=str(PASS_EVIDENCE_PATH))],
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
        visual_review={
            "schema_version": "1.0",
            "items": [
                {
                    "skill": "cesiumjs-entities",
                    "case_id": "eval-001",
                    "status": "needs_review",
                    "summary": "Screenshot needs a closer human pass.",
                }
            ],
        },
    )

    dimensions = scorecard["cases"][0]["visual_review"]["dimensions"]
    assert dimensions["nonblank_render"] == {"status": "needs_review", "note": ""}
    assert dimensions["prompt_match"]["status"] == "needs_review"


def test_required_visual_review_fails_when_missing() -> None:
    case = _case()
    result = run_case(case, _evidence(PASS_EVIDENCE_PATH))
    scorecard = build_scorecard(
        [ScorecardInput(case=case, result=result, evidence_path=str(PASS_EVIDENCE_PATH))],
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
        require_visual_review=True,
    )

    assert scorecard["deterministic_result"] == "pass"
    assert scorecard["visual_summary"]["result"] == "fail"
    assert scorecard["overall_result"] == "fail"
    assert scorecard["visual_summary"]["blocking_failures"][0]["status"] == "not_reviewed"


def test_scorecard_markdown_exposes_categories_and_failures() -> None:
    case = _case()
    result = run_case(case, _evidence(FAIL_EVIDENCE_PATH))
    scorecard = build_scorecard(
        [ScorecardInput(case=case, result=result, evidence_path=str(FAIL_EVIDENCE_PATH))],
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )

    markdown = scorecard_to_markdown(scorecard)

    assert "Evaluation Scorecard" in markdown
    assert "semantic_scene_state" in markdown
    assert "east_6m" in markdown
    assert "Qualitative Visual Review" in markdown
    assert "Actual" in markdown
    assert "Expected" in markdown
    assert "tolerance=0.01" in markdown


def test_run_scorecard_cli_writes_json_and_markdown(tmp_path: Path) -> None:
    runner = _load_run_scorecard()

    result = runner.main(["--output-dir", str(tmp_path)])

    assert result == 0
    assert (tmp_path / "scorecard.json").exists()
    assert (tmp_path / "scorecard.md").exists()
    scorecard = json.loads((tmp_path / "scorecard.json").read_text())
    assert scorecard["overall_result"] == "pass"


def test_run_scorecard_cli_can_score_negative_fixture(tmp_path: Path) -> None:
    runner = _load_run_scorecard()

    result = runner.main(
        [
            "--evidence",
            str(FAIL_EVIDENCE_PATH),
            "--output-dir",
            str(tmp_path),
        ]
    )

    assert result == 1
    scorecard = json.loads((tmp_path / "scorecard.json").read_text())
    assert scorecard["critical_failures"][0]["check_id"] == "east_6m"


def test_run_scorecard_cli_accepts_visual_review(tmp_path: Path) -> None:
    runner = _load_run_scorecard()
    visual_path = tmp_path / "visual-review.json"
    visual_path.write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "reviewer": "local-review",
                "reviewed_at": "2026-05-27T00:00:00Z",
                "items": [
                    {
                        "skill": "cesiumjs-entities",
                        "case_id": "eval-001",
                        "status": "pass",
                        "required": True,
                        "blocking": True,
                        "summary": "Rendered marker translation is visually legible.",
                    },
                    {
                        "skill": "cesiumjs-entities",
                        "case_id": "eval-002",
                        "status": "pass",
                        "required": True,
                        "blocking": True,
                        "summary": "All rendered objects move together without visible artifacts.",
                    },
                    {
                        "skill": "cesiumjs-camera",
                        "case_id": "eval-001",
                        "status": "pass",
                        "required": True,
                        "blocking": True,
                        "summary": "Camera framing shows target context clearly.",
                    },
                    {
                        "skill": "cesiumjs-spatial-math",
                        "case_id": "eval-001",
                        "status": "not_applicable",
                        "required": False,
                        "summary": "Pure helper contract has no render surface.",
                    },
                ],
            }
        )
    )

    result = runner.main(
        [
            "--output-dir",
            str(tmp_path),
            "--evidence",
            str(PASS_EVIDENCE_PATH),
            "--visual-review",
            str(visual_path),
            "--require-visual-review",
        ]
    )

    assert result == 0
    scorecard = json.loads((tmp_path / "scorecard.json").read_text())
    assert scorecard["visual_summary"]["result"] == "pass"
    assert scorecard["visual_summary"]["required_count"] == 1


def test_scorecard_stamps_model_provenance_under_artifacts() -> None:
    case = _case()
    result = run_case(case, _evidence(PASS_EVIDENCE_PATH))
    inputs = [ScorecardInput(case=case, result=result, evidence_path=str(PASS_EVIDENCE_PATH))]

    stamped = build_scorecard(
        inputs,
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
        harness="codex",
        harness_judge="codex",
        model="gpt-5.6-sol",
        model_variant="low",
    )
    _scorecard_validator().validate(stamped)
    assert stamped["harness"] == "codex"
    assert stamped["artifacts"]["harness_judge"] == "codex"
    assert stamped["artifacts"]["model"] == "gpt-5.6-sol"
    assert stamped["artifacts"]["model_variant"] == "low"

    # Omitted stamps stay omitted — "not recorded" must remain distinguishable.
    bare = build_scorecard(
        inputs,
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )
    _scorecard_validator().validate(bare)
    assert "harness" not in bare
    assert "model" not in bare["artifacts"]
    assert "model_variant" not in bare["artifacts"]


def test_resolve_codegen_provenance_recovers_from_metas(tmp_path: Path) -> None:
    # A generated source file beside its meta.json, the way the optimization
    # pipeline lays them down.
    gen = tmp_path / "optimization" / "generated" / "cesiumjs-camera" / "baseline"
    gen.mkdir(parents=True)
    (gen / "eval-001.js").write_text("// generated\n")
    (gen / "eval-001.meta.json").write_text(
        json.dumps({"harness": "opencode", "model_id": "openai/gpt-5.5", "model_variant": "medium"})
    )

    scorecard = {
        "cases": [
            {
                "case_id": "eval-101",
                "skill": "cesiumjs-camera",
                "evidence_summary": {
                    "actual_source_path": "optimization/generated/cesiumjs-camera/baseline/eval-001.js"
                },
            }
        ]
    }
    prov = resolve_codegen_provenance(scorecard, tmp_path)
    assert prov == {"harness": "opencode", "model": "openai/gpt-5.5", "model_variant": "medium"}

    # A pure-fixtures run (no recoverable source) recovers nothing — never guessed.
    assert resolve_codegen_provenance({"cases": [{"case_id": "x"}]}, tmp_path) == {}


def test_scorecard_stamps_evidence_source() -> None:
    case = _case()
    result = run_case(case, _evidence(PASS_EVIDENCE_PATH))

    fixture_inputs = [ScorecardInput(case=case, result=result, evidence_path=str(PASS_EVIDENCE_PATH))]
    fixture_run = build_scorecard(
        fixture_inputs,
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )
    _scorecard_validator().validate(fixture_run)
    assert fixture_run["artifacts"]["evidence_source"] == "fixtures"

    agent_inputs = [
        ScorecardInput(case=case, result=result, evidence_path="evaluation/artifacts/runs/eval-001.evidence.json")
    ]
    agent_run = build_scorecard(
        agent_inputs,
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
        harness="codex",
    )
    _scorecard_validator().validate(agent_run)
    assert agent_run["artifacts"]["evidence_source"] == "agent"

    mixed_run = build_scorecard(
        fixture_inputs + agent_inputs,
        threshold=0.95,
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )
    assert mixed_run["artifacts"]["evidence_source"] == "mixed"
