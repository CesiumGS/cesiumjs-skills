from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from evaluation.framework.scorecard import ScorecardInput, build_scorecard
from evaluation.runner import run_case


EVALUATION_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = EVALUATION_ROOT / "scripts" / "build-review-ui.py"
CASE_PATH = EVALUATION_ROOT / "cases" / "cesiumjs-entities" / "eval-001-translate-marker-east-6m.json"
EVIDENCE_PATH = EVALUATION_ROOT / "fixtures" / "cesiumjs-entities" / "eval-001-under-translation.evidence.json"


def _load_script():
    spec = importlib.util.spec_from_file_location("build_review_ui", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_review_ui"] = module
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
                evidence_path="evaluation/fixtures/cesiumjs-entities/eval-001-under-translation.evidence.json",
            )
        ],
        commit="abc123",
        timestamp_utc="2026-05-27T00:00:00+00:00",
    )


def test_review_ui_embeds_scorecard_data() -> None:
    builder = _load_script()

    html = builder.build_html(_scorecard(), None)

    assert "Scorecard Review" in html
    assert "scorecard-data" in html
    assert "Review Queue" in html
    assert "Qualitative Visual Review" in html
    assert "visual_review" in html
    assert "Visual dimensions" in html
    assert "nonblank_render" in html
    assert "target_visible" in html
    assert "screenshot-gallery" in html
    assert "Render screenshot being evaluated" in html
    assert "Captured Evidence" in html
    assert "Probe capture contract" in html
    assert "entities[marker].position_ecef" in html
    assert "Start Optimization From This Scorecard" in html
    assert "east_6m" in html


def test_review_ui_cli_writes_static_html(tmp_path: Path) -> None:
    builder = _load_script()
    scorecard_path = tmp_path / "scorecard.json"
    output_path = tmp_path / "index.html"
    scorecard_path.write_text(json.dumps(_scorecard()))

    result = builder.main([str(scorecard_path), "--output", str(output_path)])

    assert result == 0
    html = output_path.read_text()
    assert "Scorecard Review" in html
    assert "Evaluation review" in html
    assert "Visual Review" in html
    assert "--from-scorecard" in html
