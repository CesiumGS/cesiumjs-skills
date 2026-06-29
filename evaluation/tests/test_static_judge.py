"""CI-safe unit tests for the static visual judge (no network).

Drives ``evaluation.framework.judge.static_judge.judge_render`` with the
:class:`FakeAdapter`, injecting canned per-judge JSON verdicts keyed by the
deterministic seed embedded in each judge's prompt. Bundles are real tracked
baseline render directories under ``optimization/runs/<skill>/baseline/<dir>``;
the only thing faked is the LLM transport.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from evaluation.framework.judge.cli_adapter import FakeAdapter
from evaluation.framework.judge.static_judge import (
    DEFAULT_SEEDS,
    JudgeConfig,
    judge_render,
)


EVALUATION_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = EVALUATION_ROOT.parent
VISUAL_REVIEW_SCHEMA_PATH = EVALUATION_ROOT / "schemas" / "visual-review.schema.json"

# A real tracked baseline render bundle (has screenshot.png + scene-state.json
# + console.json), bridged from evaluation/fixtures/cesiumjs-entities/eval-101.
BUNDLE_DIR = (
    REPO_ROOT
    / "optimization"
    / "runs"
    / "cesiumjs-entities"
    / "baseline"
    / "eval-001-multiple-points-with-labels"
)

ALL_DIMENSIONS = [
    "render_liveness",
    "subject_presence_and_recognizability",
    "framing_and_composition",
    "prompt_and_behavior_fidelity",
    "visual_correctness_and_artifacts",
    "legibility_and_clarity",
]


# --- fixtures ------------------------------------------------------------


@pytest.fixture(scope="module")
def visual_item_validator() -> Draft7Validator:
    """Validator for a single ``visual_review_item`` from the v1.0 schema."""
    schema = json.loads(VISUAL_REVIEW_SCHEMA_PATH.read_text())
    item_schema = dict(schema["definitions"]["visual_review_item"])
    item_schema["definitions"] = schema["definitions"]
    return Draft7Validator(item_schema)


@pytest.fixture(scope="module", autouse=True)
def _require_bundle() -> None:
    if not (BUNDLE_DIR / "screenshot.png").is_file():
        pytest.skip(f"baseline bundle missing screenshot: {BUNDLE_DIR}")


def _case_meta(case_id: str = "eval-101") -> dict:
    return {
        "skill": "cesiumjs-entities",
        "id": case_id,
        "case_id": case_id,
        "name": "multiple-points-with-labels",
        "description": "Three labeled landmark points on the globe.",
        "prompt": "Add three labeled points and frame all of them.",
        "expected_behaviors": ["three points visible", "labels legible"],
        "visual_expectations": "Three colored markers with readable labels.",
    }


def _verdict(
    *,
    score: int,
    liveness: int | None = None,
    subject: int | None = None,
    failure_modes: list[str] | None = None,
    band: str = "PASS",
    overall: float | None = None,
    confidence: str = "high",
) -> dict:
    """Build a single judge JSON verdict with every dimension at ``score``.

    ``liveness`` / ``subject`` override those individual dimensions; the
    per-dimension ``failure_modes`` lists default to empty and the top-level
    ``failure_modes_detected`` carries any consensus flags.
    """
    dims = {}
    for dim in ALL_DIMENSIONS:
        s = score
        if dim == "render_liveness" and liveness is not None:
            s = liveness
        if dim == "subject_presence_and_recognizability" and subject is not None:
            s = subject
        dims[dim] = {"score": s, "justification": f"visible: {dim}", "failure_modes": []}
    return {
        "observed": "A loaded globe with three labeled landmark points.",
        "dimensions": dims,
        "failure_modes_detected": list(failure_modes or []),
        "gates_triggered": [],
        "weighted_sum": float(overall if overall is not None else score),
        "overall": float(overall if overall is not None else score),
        "band": band,
        "confidence": confidence,
        "rationale": "Synthetic canned verdict for CI.",
    }


def _adapter_by_seed(verdicts_by_seed: dict[int, dict]) -> FakeAdapter:
    """FakeAdapter whose dict keys are the per-judge seeds.

    ``static_judge`` embeds ``[Deterministic judge seed: <seed>]`` in each
    judge's prompt, so keying the canned dict by the seed string routes the
    matching verdict to each judge index. JSON-encode each verdict.
    """
    canned = {str(seed): json.dumps(v) for seed, v in verdicts_by_seed.items()}
    return FakeAdapter(canned)


def _config(adapter: FakeAdapter, n_judges: int = 3) -> JudgeConfig:
    return JudgeConfig(
        adapter=adapter,
        model="fake",
        n_judges=n_judges,
        repo_root=REPO_ROOT,
    )


# --- tests ---------------------------------------------------------------


def test_judge_render_emits_schema_valid_item(visual_item_validator) -> None:
    """A clean three-judge panel produces a schema-valid item with score==overall/10."""
    adapter = _adapter_by_seed({s: _verdict(score=8) for s in DEFAULT_SEEDS})
    item = judge_render(_case_meta(), BUNDLE_DIR, config=_config(adapter))

    # Strip the additive judge.per_judge payload? No — schema allows additive
    # judge object (additionalProperties true) so validate the whole item.
    errors = sorted(
        visual_item_validator.iter_errors(item), key=lambda e: list(e.path)
    )
    assert not errors, "\n".join(
        f"{'.'.join(str(p) for p in e.path) or '<root>'}: {e.message}" for e in errors
    )

    assert item["skill"] == "cesiumjs-entities"
    assert item["case_id"] == "eval-101"  # normalized to ^eval-[0-9]{3}$
    assert item["status"] == "pass"

    overall = item["overall_score"]
    assert 0.0 <= overall <= 10.0
    # v1.0 'score' field is overall_score / 10.
    assert item["score"] == pytest.approx(round(overall / 10.0, 4))
    assert 0.0 <= item["score"] <= 1.0

    # Adapter was invoked once per judge.
    assert len(adapter.calls) == 3
    for call in adapter.calls:
        assert call["files"] == [str((BUNDLE_DIR / "screenshot.png").resolve())]
        assert "Screenshot PNG file(s) are attached" in call["prompt"]
        assert "images are not attached" not in call["prompt"]
        assert "do not read" not in call["prompt"].lower()

    assert item["reviewer"] == "screenshot-visual-judge"
    assert item["judge"]["screenshot_input_mode"] == "attached_image_files"
    assert item["judge"]["screenshots_attached"] == 1


def test_overall_score_in_range_and_derived() -> None:
    """overall_score stays within [0,10] for a uniformly-high panel."""
    adapter = _adapter_by_seed({s: _verdict(score=9) for s in DEFAULT_SEEDS})
    item = judge_render(_case_meta(), BUNDLE_DIR, config=_config(adapter))
    assert 0.0 <= item["overall_score"] <= 10.0
    assert item["score"] == pytest.approx(round(item["overall_score"] / 10.0, 4))


def test_liveness_gate_caps_overall_at_two() -> None:
    """render_liveness median <= 2 caps the gated overall at <= 2.0."""
    # All other dimensions high, but liveness is dead (<=2) for every judge so
    # the median is <=2 and the hard liveness gate fires.
    adapter = _adapter_by_seed(
        {s: _verdict(score=9, liveness=1, band="FAIL") for s in DEFAULT_SEEDS}
    )
    item = judge_render(_case_meta(), BUNDLE_DIR, config=_config(adapter))

    assert item["overall_score"] <= 2.0
    assert item["judge"]["cap_applied"] == 2.0
    assert "liveness_gate" in item["judge"]["gates_triggered"]
    # A capped-dead render is a fail.
    assert item["status"] == "fail"
    assert item["dimensions"]["render_liveness"]["status"] == "fail"


def test_blocking_failure_flag_forces_fail() -> None:
    """A consensus blocking failure flag forces status=fail even if scores are high."""
    # High scores everywhere, but >=2/3 judges report a blocking failure mode.
    # 'render_artifacts' is NOT in BLOCKING_FAILURE_FLAGS, so use 'wrong_subject'
    # which IS blocking. Keep liveness high so only the flag (not a score gate)
    # is doing the work.
    verdicts = {
        DEFAULT_SEEDS[0]: _verdict(score=8, failure_modes=["wrong_subject"]),
        DEFAULT_SEEDS[1]: _verdict(score=8, failure_modes=["wrong_subject"]),
        DEFAULT_SEEDS[2]: _verdict(score=8, failure_modes=[]),
    }
    adapter = _adapter_by_seed(verdicts)
    item = judge_render(_case_meta(), BUNDLE_DIR, config=_config(adapter))

    assert "wrong_subject" in item["failure_flags"]
    assert item["status"] == "fail"


def test_no_screenshot_yields_not_reviewed(tmp_path: Path) -> None:
    """A bundle with no screenshot.png yields status=not_reviewed (no panel run)."""
    empty_bundle = tmp_path / "empty-bundle"
    empty_bundle.mkdir()
    adapter = _adapter_by_seed({s: _verdict(score=8) for s in DEFAULT_SEEDS})

    item = judge_render(_case_meta(), empty_bundle, config=_config(adapter))

    assert item["status"] == "not_reviewed"
    assert item["score"] is None
    assert item["overall_score"] is None
    # The panel must NOT have been invoked when there is no screenshot.
    assert adapter.calls == []


def test_median_aggregation_picks_middle_of_three() -> None:
    """Per-dimension aggregation is the median of the three judges' scores."""
    # Judges score every dimension 4, 6, 8 -> median 6 on each dimension.
    verdicts = {
        DEFAULT_SEEDS[0]: _verdict(score=4, band="BORDERLINE"),
        DEFAULT_SEEDS[1]: _verdict(score=6, band="BORDERLINE"),
        DEFAULT_SEEDS[2]: _verdict(score=8, band="PASS"),
    }
    adapter = _adapter_by_seed(verdicts)
    item = judge_render(_case_meta(), BUNDLE_DIR, config=_config(adapter))

    for dim in ALL_DIMENSIONS:
        assert item["dimensions"][dim]["score"] == 6, dim

    # With every dimension at 6 the weighted sum is exactly 6.0 (weights sum to 1).
    assert item["overall_score"] == pytest.approx(6.0)
    assert item["judge"]["aggregation"] == "median"
    assert item["judge"]["n_parsed"] == 3
