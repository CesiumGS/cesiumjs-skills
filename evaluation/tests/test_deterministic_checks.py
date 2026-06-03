from __future__ import annotations

import json
import math
from pathlib import Path

from jsonschema import Draft7Validator

from evaluation.runner import run_case


EVALUATION_ROOT = Path(__file__).resolve().parents[1]
CASE_PATH = (
    EVALUATION_ROOT
    / "cases"
    / "cesiumjs-entities"
    / "eval-001-translate-marker-east-6m.json"
)
PASS_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-entities"
    / "eval-001-pass.evidence.json"
)
UNDER_TRANSLATION_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-entities"
    / "eval-001-under-translation.evidence.json"
)
TRANSLATE_ALL_CASE_PATH = (
    EVALUATION_ROOT
    / "cases"
    / "cesiumjs-entities"
    / "eval-002-translate-all-objects-x-10.json"
)
TRANSLATE_ALL_PASS_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-entities"
    / "eval-002-pass.evidence.json"
)
TRANSLATE_ALL_Y_DRIFT_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-entities"
    / "eval-002-y-drift.evidence.json"
)
CAMERA_CASE_PATH = (
    EVALUATION_ROOT
    / "cases"
    / "cesiumjs-camera"
    / "eval-001-target-view-volume.json"
)
CAMERA_PASS_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-camera"
    / "eval-001-pass.evidence.json"
)
CAMERA_OVERHEAD_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-camera"
    / "eval-001-overhead.evidence.json"
)
SPATIAL_MATH_CASE_PATH = (
    EVALUATION_ROOT
    / "cases"
    / "cesiumjs-spatial-math"
    / "eval-001-cartesian-translation-contract.json"
)
SPATIAL_MATH_PASS_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-spatial-math"
    / "eval-001-pass.evidence.json"
)
SPATIAL_MATH_MUTATING_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-spatial-math"
    / "eval-001-mutating-output.evidence.json"
)
IMAGERY_CASE_PATH = (
    EVALUATION_ROOT
    / "cases"
    / "cesiumjs-imagery"
    / "eval-001-public-layer-contract.json"
)
IMAGERY_PASS_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-imagery"
    / "eval-001-pass.evidence.json"
)
IMAGERY_LOCAL_PATH_EVIDENCE_PATH = (
    EVALUATION_ROOT
    / "fixtures"
    / "cesiumjs-imagery"
    / "eval-001-local-path.evidence.json"
)
TIME_CASE_PATH = EVALUATION_ROOT / "cases" / "cesiumjs-time-properties" / "eval-001-clock-contract.json"
TIME_PASS_EVIDENCE_PATH = EVALUATION_ROOT / "fixtures" / "cesiumjs-time-properties" / "eval-001-pass.evidence.json"
TIME_WRONG_MULTIPLIER_EVIDENCE_PATH = (
    EVALUATION_ROOT / "fixtures" / "cesiumjs-time-properties" / "eval-001-wrong-multiplier.evidence.json"
)
INTERACTION_CASE_PATH = EVALUATION_ROOT / "cases" / "cesiumjs-interaction" / "eval-001-click-event-contract.json"
INTERACTION_PASS_EVIDENCE_PATH = EVALUATION_ROOT / "fixtures" / "cesiumjs-interaction" / "eval-001-pass.evidence.json"
INTERACTION_WRONG_TARGET_EVIDENCE_PATH = (
    EVALUATION_ROOT / "fixtures" / "cesiumjs-interaction" / "eval-001-wrong-target.evidence.json"
)
TERRAIN_CASE_PATH = (
    EVALUATION_ROOT / "cases" / "cesiumjs-terrain-environment" / "eval-001-globe-terrain-contract.json"
)
TERRAIN_PASS_EVIDENCE_PATH = (
    EVALUATION_ROOT / "fixtures" / "cesiumjs-terrain-environment" / "eval-001-pass.evidence.json"
)
TERRAIN_ION_EVIDENCE_PATH = (
    EVALUATION_ROOT / "fixtures" / "cesiumjs-terrain-environment" / "eval-001-ion-terrain.evidence.json"
)
TILESET_CASE_PATH = EVALUATION_ROOT / "cases" / "cesiumjs-3d-tiles" / "eval-001-public-tileset-contract.json"
TILESET_PASS_EVIDENCE_PATH = EVALUATION_ROOT / "fixtures" / "cesiumjs-3d-tiles" / "eval-001-pass.evidence.json"
TILESET_ION_EVIDENCE_PATH = EVALUATION_ROOT / "fixtures" / "cesiumjs-3d-tiles" / "eval-001-ion-token.evidence.json"
RESULT_SCHEMA_PATH = EVALUATION_ROOT / "schemas" / "result.schema.json"
LON_DEG = -73.985
LAT_DEG = 40.758
START_ECEF = (1333000.0, -4654000.0, 4138000.0)


def _unit_vectors() -> dict[str, tuple[float, float, float]]:
    lon = math.radians(LON_DEG)
    lat = math.radians(LAT_DEG)
    sin_lon = math.sin(lon)
    cos_lon = math.cos(lon)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    return {
        "east": (-sin_lon, cos_lon, 0.0),
        "north": (-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat),
        "up": (cos_lat * cos_lon, cos_lat * sin_lon, sin_lat),
    }


def _translated_ecef(east: float = 0.0, north: float = 0.0, up: float = 0.0) -> list[float]:
    basis = _unit_vectors()
    return [
        START_ECEF[i]
        + east * basis["east"][i]
        + north * basis["north"][i]
        + up * basis["up"][i]
        for i in range(3)
    ]


def _evidence(east: float = 6.0, north: float = 0.0, up: float = 0.0) -> dict:
    return {
        "before": {
            "entities": {
                "marker": {
                    "position_ecef": list(START_ECEF),
                    "position_cartographic": {
                        "longitude_deg": LON_DEG,
                        "latitude_deg": LAT_DEG,
                        "altitude_m": 0,
                    },
                }
            }
        },
        "after": {
            "entities": {
                "marker": {
                    "position_ecef": _translated_ecef(east=east, north=north, up=up),
                }
            }
        },
    }


def _case() -> dict:
    return json.loads(CASE_PATH.read_text())


def _fixture(path: Path) -> dict:
    return json.loads(path.read_text())


def test_translate_six_meter_case_passes_with_exact_scene_state() -> None:
    result = run_case(_case(), _evidence(east=6.0))

    assert result.passed
    assert [check.check_id for check in result.checks] == [
        "no_runtime_errors",
        "marker_exists",
        "east_6m",
        "no_north_drift",
        "no_up_drift",
    ]


def test_translate_six_meter_case_fails_on_under_translation() -> None:
    result = run_case(_case(), _evidence(east=5.9))

    assert not result.passed
    failed = [check.check_id for check in result.checks if not check.passed]
    assert failed == ["east_6m"]


def test_translate_six_meter_case_fails_on_unintended_north_drift() -> None:
    result = run_case(_case(), _evidence(east=6.0, north=0.5))

    assert not result.passed
    failed = [check.check_id for check in result.checks if not check.passed]
    assert failed == ["no_north_drift"]


def test_tracked_pass_fixture_matches_result_schema() -> None:
    result = run_case(_case(), _fixture(PASS_EVIDENCE_PATH)).to_dict()
    schema = json.loads(RESULT_SCHEMA_PATH.read_text())

    Draft7Validator(schema).validate(result)
    assert result["result"] == "pass"


def test_tracked_negative_fixture_fails_only_translation_delta() -> None:
    result = run_case(_case(), _fixture(UNDER_TRANSLATION_EVIDENCE_PATH))

    assert not result.passed
    failed = [check.check_id for check in result.checks if not check.passed]
    assert failed == ["east_6m"]


def test_cartesian_translation_case_passes_for_all_objects() -> None:
    result = run_case(_fixture(TRANSLATE_ALL_CASE_PATH), _fixture(TRANSLATE_ALL_PASS_EVIDENCE_PATH))

    assert result.passed
    assert result.checks[3].metadata["frame"] == "ecef"


def test_cartesian_translation_case_fails_on_y_drift() -> None:
    result = run_case(_fixture(TRANSLATE_ALL_CASE_PATH), _fixture(TRANSLATE_ALL_Y_DRIFT_EVIDENCE_PATH))

    assert not result.passed
    failed = [check.check_id for check in result.checks if not check.passed]
    assert failed == ["box_a_no_y_drift"]


def test_camera_target_view_case_rejects_overhead_view() -> None:
    passing = run_case(_fixture(CAMERA_CASE_PATH), _fixture(CAMERA_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(CAMERA_CASE_PATH), _fixture(CAMERA_OVERHEAD_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["camera_views_target_not_overhead"]


def test_generated_output_semantics_case_checks_return_value_and_mutation() -> None:
    passing = run_case(_fixture(SPATIAL_MATH_CASE_PATH), _fixture(SPATIAL_MATH_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(SPATIAL_MATH_CASE_PATH), _fixture(SPATIAL_MATH_MUTATING_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["input_points_not_mutated"]


def test_imagery_layer_contract_fixture_checks_provider_alpha_time_and_hygiene() -> None:
    passing = run_case(_fixture(IMAGERY_CASE_PATH), _fixture(IMAGERY_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(IMAGERY_CASE_PATH), _fixture(IMAGERY_LOCAL_PATH_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["public_artifact_hygiene"]


def test_time_contract_checks_clock_state_without_visual_playback() -> None:
    passing = run_case(_fixture(TIME_CASE_PATH), _fixture(TIME_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(TIME_CASE_PATH), _fixture(TIME_WRONG_MULTIPLIER_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["multiplier_30"]


def test_interaction_contract_checks_observable_click_effect() -> None:
    passing = run_case(_fixture(INTERACTION_CASE_PATH), _fixture(INTERACTION_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(INTERACTION_CASE_PATH), _fixture(INTERACTION_WRONG_TARGET_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["alpha_clicked"]


def test_terrain_contract_blocks_token_backed_terrain() -> None:
    passing = run_case(_fixture(TERRAIN_CASE_PATH), _fixture(TERRAIN_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(TERRAIN_CASE_PATH), _fixture(TERRAIN_ION_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["public_terrain_provider", "no_ion_terrain_required"]


def test_tileset_contract_checks_public_ready_framed_tileset() -> None:
    passing = run_case(_fixture(TILESET_CASE_PATH), _fixture(TILESET_PASS_EVIDENCE_PATH))
    failing = run_case(_fixture(TILESET_CASE_PATH), _fixture(TILESET_ION_EVIDENCE_PATH))

    assert passing.passed
    assert not failing.passed
    failed = [check.check_id for check in failing.checks if not check.passed]
    assert failed == ["tileset_public_url", "tileset_no_ion_token"]


def test_runtime_error_check_is_gate_critical() -> None:
    evidence = _fixture(SPATIAL_MATH_PASS_EVIDENCE_PATH)
    evidence["errors"] = ["ReferenceError: Cesium is not defined"]

    result = run_case(_fixture(SPATIAL_MATH_CASE_PATH), evidence)

    assert not result.passed
    failed = [check for check in result.checks if not check.passed]
    assert [check.check_id for check in failed] == ["no_runtime_errors"]
    assert failed[0].category == "execution_health"
    assert failed[0].critical


def test_imported_source_pattern_checks_are_deterministic() -> None:
    case = {
        "id": "eval-999",
        "name": "source-pattern-contract",
        "skill": "cesiumjs-test",
        "category": "generated_output_semantics",
        "critical": True,
        "checks": [
            {
                "id": "uses_viewer",
                "type": "pattern_present",
                "pattern": "new\\s+Cesium\\.Viewer",
            },
            {
                "id": "avoids_ion",
                "type": "pattern_absent",
                "pattern": "fromIonAssetId",
            },
            {
                "id": "code_completed",
                "type": "code_runs",
            },
        ],
    }
    evidence = {
        "generated_code": "const viewer = new Cesium.Viewer('cesiumContainer');",
        "execution": {"success": True, "observed_from": "optimization/runs/example/programmatic-checks.json"},
    }

    result = run_case(case, evidence)

    assert result.passed
    assert [check.actual for check in result.checks] == [
        {"matched": True, "match": "new Cesium.Viewer"},
        {"matched": False, "match": None},
        True,
    ]
    assert [check.category for check in result.checks] == [
        "source_contract",
        "source_contract",
        "execution_health",
    ]


def test_scene_state_collection_and_numeric_contracts_are_deterministic() -> None:
    case = {
        "id": "eval-998",
        "name": "imagery-layer-contract",
        "skill": "cesiumjs-imagery",
        "checks": [
            {
                "id": "one_imagery_layer",
                "type": "collection_count",
                "path": "/after/imagery_layers",
                "count": 1,
                "category": "asset_and_provider_safety",
                "critical": True,
            },
            {
                "id": "layer_alpha",
                "type": "json_value_compare",
                "path": "/after/imagery_layers/0/alpha",
                "operator": "==",
                "expected": 0.65,
                "tolerance": 0.001,
                "category": "visual_fidelity",
            },
            {
                "id": "clock_multiplier",
                "type": "json_value_compare",
                "path": "/after/clock/multiplier",
                "operator": ">=",
                "expected": 10,
                "category": "time_behavior",
            },
        ],
    }
    evidence = {
        "after": {
            "imagery_layers": [{"provider": "OpenStreetMapImageryProvider", "alpha": 0.6504}],
            "clock": {"multiplier": 20},
        }
    }

    result = run_case(case, evidence)

    assert result.passed
    assert [check.category for check in result.checks] == [
        "asset_and_provider_safety",
        "visual_fidelity",
        "time_behavior",
    ]


def test_scene_state_collection_count_fails_on_unexpected_extra_layer() -> None:
    case = {
        "id": "eval-998",
        "name": "imagery-layer-contract",
        "skill": "cesiumjs-imagery",
        "checks": [
            {
                "id": "one_imagery_layer",
                "type": "collection_count",
                "path": "/after/imagery_layers",
                "count": 1,
            }
        ],
    }
    evidence = {"after": {"imagery_layers": [{"provider": "OSM"}, {"provider": "Unexpected"}]}}

    result = run_case(case, evidence)

    assert not result.passed
    assert result.checks[0].actual == 2
    assert result.checks[0].category == "semantic_scene_state"


def test_artifact_text_absent_blocks_local_paths_and_tokens() -> None:
    case = {
        "id": "eval-997",
        "name": "artifact-hygiene",
        "skill": "cesiumjs-viewer-setup",
        "checks": [
            {
                "id": "public_artifacts",
                "type": "artifact_text_absent",
                "extra_patterns": ["LOCAL_ONLY_PATH"],
                "category": "artifact_hygiene",
                "critical": True,
            }
        ],
    }
    evidence = {
        "generated_code": "const url = 'LOCAL_ONLY_PATH/private/trace.html';",
        "after": {"entities": {}},
    }

    result = run_case(case, evidence)

    assert not result.passed
    assert result.checks[0].actual["path"] == "/generated_code"
    assert result.checks[0].critical
