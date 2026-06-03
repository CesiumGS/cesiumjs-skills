"""CI-safe unit tests for the combined baseline-audit runner (no network).

Invokes ``evaluation/scripts/run-baseline-audit.py``'s ``main()`` over a tiny
``--skills`` subset (cesiumjs-entities, whose baseline bundles are tracked) and
asserts:

* the combined scorecard carries BOTH a deterministic_result and a populated
  visual_summary;
* gate composition holds: a forced visual blocking fail downgrades the overall
  result, and a deterministic fail can never be upgraded by a good qualitative
  score.

The qualitative lane is driven with ``--adapter fake`` (canned verdicts) or via
injected ``--visual-review`` JSON, so nothing touches the network.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from evaluation.framework.types import CaseResult, CheckResult


EVALUATION_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = EVALUATION_ROOT.parent
RUN_AUDIT_SCRIPT = EVALUATION_ROOT / "scripts" / "run-baseline-audit.py"

SKILL = "cesiumjs-entities"
# The five tracked baseline cases for the subset skill.
CASE_IDS = ["eval-101", "eval-102", "eval-103", "eval-104", "eval-105"]


def _load_runner():
    spec = importlib.util.spec_from_file_location("run_baseline_audit", RUN_AUDIT_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_baseline_audit"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def runner():
    return _load_runner()


@pytest.fixture(scope="module", autouse=True)
def _require_bundles(runner) -> None:
    """Skip if the tracked baseline bundles for the subset are missing."""
    try:
        cases = runner.collect_cases([SKILL])
    except Exception as exc:  # pragma: no cover - environment guard
        pytest.skip(f"could not collect baseline cases for {SKILL}: {exc}")
    for c in cases:
        if c.bundle_dir is None or not (c.bundle_dir / "screenshot.png").is_file():
            pytest.skip(f"baseline bundle missing screenshot: {c.bundle_dir}")


def _visual_review(items: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "reviewer": "static-visual-judge",
        "reviewed_at": "2026-06-02T00:00:00Z",
        "items": items,
    }


def _pass_item(case_id: str, *, blocking: bool = True) -> dict:
    return {
        "skill": SKILL,
        "case_id": case_id,
        "status": "pass",
        "required": True,
        "blocking": blocking,
        "score": 0.83,
        "overall_score": 8.3,
        "summary": "Live scene with the intended subject well framed.",
    }


def _read_scorecard(output_dir: Path) -> dict:
    return json.loads((output_dir / "scorecard.json").read_text())


# --- tests ---------------------------------------------------------------


def test_combined_scorecard_has_both_lanes(runner, tmp_path: Path) -> None:
    """The fake-adapter audit produces a deterministic_result AND a visual_summary."""
    out = tmp_path / "audit"
    rc = runner.main(
        [
            "--skills",
            SKILL,
            "--adapter",
            "fake",
            "--output-dir",
            str(out),
        ]
    )

    scorecard = _read_scorecard(out)

    # Lane 1: deterministic gate present and binding.
    assert scorecard["deterministic_result"] in {"pass", "fail"}

    # Lane 2: visual_summary is populated, not an empty/not_required stub.
    vs = scorecard["visual_summary"]
    assert vs["visual_review_supplied"] is True
    assert vs["total_cases"] == len(CASE_IDS)
    assert vs["reviewed_count"] == len(CASE_IDS)
    assert vs["result"] in {"pass", "fail", "needs_review"}

    # Per-case visual reviews carry the qualitative 0-10 overall_score and a
    # derived [0,1] score.
    case0 = scorecard["cases"][0]["visual_review"]
    assert case0["overall_score"] is not None
    assert 0.0 <= case0["overall_score"] <= 10.0
    assert case0["score"] == pytest.approx(case0["overall_score"] / 10.0, abs=1e-6)

    # The tracked entities baselines pass both lanes -> overall pass, exit 0.
    assert scorecard["deterministic_result"] == "pass"
    assert scorecard["visual_summary"]["result"] == "pass"
    assert scorecard["overall_result"] == "pass"
    assert rc == 0


def test_forced_visual_blocking_fail_downgrades_overall(runner, tmp_path: Path) -> None:
    """A blocking visual fail downgrades overall even when deterministic passes."""
    visual_path = tmp_path / "visual-review.json"
    items = [_pass_item(cid) for cid in CASE_IDS]
    # Force the first case to a blocking visual failure.
    items[0] = {
        "skill": SKILL,
        "case_id": CASE_IDS[0],
        "status": "fail",
        "required": True,
        "blocking": True,
        "score": 0.1,
        "overall_score": 1.0,
        "failure_flags": ["starfield_only"],
        "summary": "Starfield only: the globe never loaded.",
    }
    visual_path.write_text(json.dumps(_visual_review(items)))

    out = tmp_path / "audit"
    rc = runner.main(
        [
            "--skills",
            SKILL,
            "--visual-review",
            str(visual_path),
            "--output-dir",
            str(out),
        ]
    )

    scorecard = _read_scorecard(out)

    # Deterministic lane still passes (unchanged baselines)...
    assert scorecard["deterministic_result"] == "pass"
    # ...but the blocking visual failure downgrades the combined gate.
    assert scorecard["visual_summary"]["result"] == "fail"
    assert scorecard["overall_result"] == "fail"
    blocking = scorecard["visual_summary"]["blocking_failures"]
    assert any(bf["case_id"] == CASE_IDS[0] and bf["status"] == "fail" for bf in blocking)
    assert rc == 1


def test_deterministic_fail_cannot_be_upgraded_by_good_visual(
    runner, tmp_path: Path, monkeypatch
) -> None:
    """A deterministic critical failure stays fail despite an all-pass visual review."""
    # Inject an all-pass, high-score qualitative review for every case.
    visual_path = tmp_path / "visual-review.json"
    visual_path.write_text(json.dumps(_visual_review([_pass_item(cid) for cid in CASE_IDS])))

    real_run_case = runner.run_case
    target_case_id = CASE_IDS[0]

    def fake_run_case(case: dict, evidence: dict) -> CaseResult:
        result = real_run_case(case, evidence)
        if result.case_id != target_case_id:
            return result
        # Inject a failing CRITICAL check so the deterministic lane fails.
        forced = CheckResult(
            check_id="forced_failure",
            type="no_runtime_errors",
            result="fail",
            category="execution_health",
            critical=True,
            actual=False,
            expected=True,
            detail="forced deterministic failure for gate-composition test",
        )
        checks = list(result.checks) + [forced]
        return CaseResult(
            case_id=result.case_id,
            case_name=result.case_name,
            skill=result.skill,
            result="fail",
            checks=checks,
            duration_ms=result.duration_ms,
            error=result.error,
        )

    monkeypatch.setattr(runner, "run_case", fake_run_case)

    out = tmp_path / "audit"
    rc = runner.main(
        [
            "--skills",
            SKILL,
            "--visual-review",
            str(visual_path),
            "--output-dir",
            str(out),
        ]
    )

    scorecard = _read_scorecard(out)

    # Qualitative lane is a clean pass...
    assert scorecard["visual_summary"]["result"] == "pass"
    # ...yet the deterministic critical failure is binding and can't be upgraded.
    assert scorecard["deterministic_result"] == "fail"
    assert scorecard["overall_result"] == "fail"
    assert any(
        cf["check_id"] == "forced_failure" and cf["case_id"] == target_case_id
        for cf in scorecard["critical_failures"]
    )
    assert rc == 1
