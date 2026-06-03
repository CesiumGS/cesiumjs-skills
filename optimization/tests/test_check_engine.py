#!/usr/bin/env python3
"""
Tests for the deterministic check engine.

Tests cover:
- All six check types (code_runs, no_console_errors, pattern_present, pattern_absent, schema_match, api_present)
- Pass and fail cases for each check type
- Edge cases (missing patterns, invalid schemas, etc.)
- Deterministic output (byte-identical results on repeated runs)
- Performance (completes in under 5 seconds per scenario)
"""

import json
import time
from typing import Any

from optimization.framework.checks.engine import run_checks


def test_code_runs_pass():
    """Test code_runs check passes with no errors."""
    scenario = {
        "id": "test-001",
        "programmatic_checks": [
            {"type": "code_runs", "description": "Code executes without errors"}
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["scenario_id"] == "test-001"
    assert len(result["checks"]) == 1
    assert result["checks"][0]["type"] == "code_runs"
    assert result["checks"][0]["result"] == "pass"
    assert "without captured errors" in result["checks"][0]["detail"]


def test_code_runs_fail():
    """Test code_runs check fails with errors present."""
    scenario = {
        "id": "test-002",
        "programmatic_checks": [
            {"type": "code_runs", "description": "Code executes without errors"}
        ],
    }
    console_data = {
        "errors": [
            {"type": "error", "text": "ReferenceError: viewer is not defined"}
        ]
    }
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "1 error(s)" in result["checks"][0]["detail"]


def test_no_console_errors_pass():
    """Test no_console_errors check passes with clean console."""
    scenario = {
        "id": "test-003",
        "programmatic_checks": [
            {"type": "no_console_errors", "description": "No console errors"}
        ],
    }
    console_data = {"errors": []}
    generated_code = "console.log('Hello');"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "pass"
    assert "No console or page errors" in result["checks"][0]["detail"]


def test_no_console_errors_fail():
    """Test no_console_errors check fails with console errors."""
    scenario = {
        "id": "test-004",
        "programmatic_checks": [
            {"type": "no_console_errors", "description": "No console errors"}
        ],
    }
    console_data = {
        "errors": [
            {"type": "error", "text": "Something went wrong"},
            {"type": "warning", "text": "Deprecated API"},
        ]
    }
    generated_code = "doSomething();"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "2 error(s)" in result["checks"][0]["detail"]


def test_pattern_present_pass():
    """Test pattern_present check passes when pattern is found."""
    scenario = {
        "id": "test-005",
        "programmatic_checks": [
            {
                "type": "pattern_present",
                "pattern": r"viewer\.camera\.flyTo",
                "description": "Uses flyTo method",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = """
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-122.4, 37.8, 1000)
    });
    """

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "pass"
    assert "Pattern matched" in result["checks"][0]["detail"]


def test_pattern_present_fail():
    """Test pattern_present check fails when pattern is not found."""
    scenario = {
        "id": "test-006",
        "programmatic_checks": [
            {
                "type": "pattern_present",
                "pattern": r"viewer\.camera\.setView",
                "description": "Uses setView method",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "Pattern not found" in result["checks"][0]["detail"]


def test_pattern_absent_pass():
    """Test pattern_absent check passes when pattern is not found."""
    scenario = {
        "id": "test-007",
        "programmatic_checks": [
            {
                "type": "pattern_absent",
                "pattern": r"eval\(",
                "description": "No eval() usage",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "pass"
    assert "not found (as expected)" in result["checks"][0]["detail"]


def test_pattern_absent_fail():
    """Test pattern_absent check fails when pattern is found."""
    scenario = {
        "id": "test-008",
        "programmatic_checks": [
            {
                "type": "pattern_absent",
                "pattern": r"console\.log",
                "description": "No console.log usage",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "console.log('Debug message');"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "Unexpected pattern found" in result["checks"][0]["detail"]


def test_schema_match_pass():
    """Test schema_match check passes when scene state matches schema."""
    scenario = {
        "id": "test-009",
        "programmatic_checks": [
            {
                "type": "schema_match",
                "schema": {
                    "required": ["camera_position"],
                    "properties": {
                        "camera_position": {"type": "object"},
                        "entity_count": {"type": "integer", "minimum": 1},
                    },
                },
                "description": "Scene has camera and entities",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.entities.add({});"
    scene_state = {
        "available": True,
        "camera_position": {"x": 100, "y": 200, "z": 300},
        "entity_count": 5,
    }

    result = run_checks(scenario, generated_code, console_data, scene_state)

    assert result["checks"][0]["result"] == "pass"
    assert "matches schema" in result["checks"][0]["detail"]


def test_schema_match_fail_missing_property():
    """Test schema_match check fails when required property is missing."""
    scenario = {
        "id": "test-010",
        "programmatic_checks": [
            {
                "type": "schema_match",
                "schema": {
                    "required": ["camera_position", "entity_count"],
                },
                "description": "Scene has required properties",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.entities.add({});"
    scene_state = {
        "available": True,
        "camera_position": {"x": 100, "y": 200, "z": 300},
        # Missing entity_count
    }

    result = run_checks(scenario, generated_code, console_data, scene_state)

    assert result["checks"][0]["result"] == "fail"
    assert "Required property missing" in result["checks"][0]["detail"]


def test_schema_match_fail_wrong_type():
    """Test schema_match check fails when property has wrong type."""
    scenario = {
        "id": "test-011",
        "programmatic_checks": [
            {
                "type": "schema_match",
                "schema": {
                    "properties": {
                        "entity_count": {"type": "integer"},
                    },
                },
                "description": "Entity count is integer",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.entities.add({});"
    scene_state = {
        "available": True,
        "entity_count": "not a number",  # Wrong type
    }

    result = run_checks(scenario, generated_code, console_data, scene_state)

    assert result["checks"][0]["result"] == "fail"
    assert "wrong type" in result["checks"][0]["detail"]


def test_schema_match_fail_out_of_range():
    """Test schema_match check fails when numeric value is out of range."""
    scenario = {
        "id": "test-012",
        "programmatic_checks": [
            {
                "type": "schema_match",
                "schema": {
                    "properties": {
                        "altitude": {"type": "number", "minimum": 0, "maximum": 10000},
                    },
                },
                "description": "Altitude in valid range",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"
    scene_state = {
        "available": True,
        "altitude": 50000,  # Above maximum
    }

    result = run_checks(scenario, generated_code, console_data, scene_state)

    assert result["checks"][0]["result"] == "fail"
    assert "above maximum" in result["checks"][0]["detail"]


def test_schema_match_fail_scene_not_available():
    """Test schema_match check fails when scene state is not available."""
    scenario = {
        "id": "test-013",
        "programmatic_checks": [
            {
                "type": "schema_match",
                "schema": {"required": ["camera_position"]},
                "description": "Scene state available",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"
    scene_state = {"available": False}

    result = run_checks(scenario, generated_code, console_data, scene_state)

    assert result["checks"][0]["result"] == "fail"
    assert "not available" in result["checks"][0]["detail"]


def test_api_present_pass():
    """Test api_present check passes when API is found."""
    scenario = {
        "id": "test-014",
        "programmatic_checks": [
            {
                "type": "api_present",
                "api": "viewer.camera.flyTo",
                "description": "Uses flyTo API",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({destination: position});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "pass"
    assert "API present: 'flyTo'" in result["checks"][0]["detail"]


def test_api_present_pass_cartesian3():
    """Test api_present check passes for Cesium.Cartesian3."""
    scenario = {
        "id": "test-015",
        "programmatic_checks": [
            {
                "type": "api_present",
                "api": "Cesium.Cartesian3",
                "description": "Uses Cartesian3",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = """
    const position = Cesium.Cartesian3.fromDegrees(-122.4, 37.8, 1000);
    viewer.camera.setView({destination: position});
    """

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "pass"
    assert "API present: 'Cartesian3'" in result["checks"][0]["detail"]


def test_api_present_fail():
    """Test api_present check fails when API is not found."""
    scenario = {
        "id": "test-016",
        "programmatic_checks": [
            {
                "type": "api_present",
                "api": "viewer.camera.lookAt",
                "description": "Uses lookAt API",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "API not found: 'lookAt'" in result["checks"][0]["detail"]


def test_multiple_checks():
    """Test scenario with multiple checks."""
    scenario = {
        "id": "test-017",
        "programmatic_checks": [
            {"type": "code_runs", "description": "No errors"},
            {"type": "pattern_present", "pattern": "flyTo", "description": "Uses flyTo"},
            {"type": "api_present", "api": "Cesium.Cartesian3", "description": "Uses Cartesian3"},
        ],
    }
    console_data = {"errors": []}
    generated_code = """
    const position = Cesium.Cartesian3.fromDegrees(-122.4, 37.8);
    viewer.camera.flyTo({destination: position});
    """

    result = run_checks(scenario, generated_code, console_data)

    assert len(result["checks"]) == 3
    assert all(check["result"] == "pass" for check in result["checks"])


def test_deterministic_output():
    """Test that running checks multiple times produces byte-identical results."""
    scenario = {
        "id": "test-018",
        "programmatic_checks": [
            {"type": "code_runs", "description": "No errors"},
            {"type": "pattern_present", "pattern": "flyTo", "description": "Uses flyTo"},
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    # Run checks multiple times
    results = []
    for _ in range(5):
        result = run_checks(scenario, generated_code, console_data)
        results.append(json.dumps(result, sort_keys=True))

    # All results should be identical
    assert len(set(results)) == 1, "Results are not deterministic"


def test_performance():
    """Test that checks complete in under 5 seconds per scenario."""
    # Create a scenario with all check types
    scenario = {
        "id": "test-019",
        "programmatic_checks": [
            {"type": "code_runs", "description": "No errors"},
            {"type": "no_console_errors", "description": "No console errors"},
            {"type": "pattern_present", "pattern": "flyTo", "description": "Uses flyTo"},
            {"type": "pattern_absent", "pattern": "eval", "description": "No eval"},
            {
                "type": "schema_match",
                "schema": {"required": ["camera_position"]},
                "description": "Scene state valid",
            },
            {"type": "api_present", "api": "viewer.camera.flyTo", "description": "Uses flyTo API"},
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({destination: Cesium.Cartesian3.fromDegrees(0, 0)});"
    scene_state = {"available": True, "camera_position": {"x": 0, "y": 0, "z": 0}}

    start_time = time.time()
    result = run_checks(scenario, generated_code, console_data, scene_state)
    elapsed = time.time() - start_time

    assert elapsed < 5.0, f"Checks took {elapsed:.2f}s, exceeding 5s limit"
    assert len(result["checks"]) == 6


def test_invalid_regex_pattern():
    """Test that invalid regex patterns are handled gracefully."""
    scenario = {
        "id": "test-020",
        "programmatic_checks": [
            {
                "type": "pattern_present",
                "pattern": "[invalid(regex",  # Invalid regex
                "description": "Invalid pattern",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "Invalid regex pattern" in result["checks"][0]["detail"]


def test_missing_pattern_field():
    """Test that missing pattern field is handled gracefully."""
    scenario = {
        "id": "test-021",
        "programmatic_checks": [
            {
                "type": "pattern_present",
                # Missing pattern field
                "description": "Missing pattern",
            }
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["result"] == "fail"
    assert "No pattern specified" in result["checks"][0]["detail"]


def test_check_ids_are_unique():
    """Test that each check gets a unique check_id."""
    scenario = {
        "id": "test-022",
        "programmatic_checks": [
            {"type": "code_runs", "description": "First check"},
            {"type": "code_runs", "description": "Second check"},
            {"type": "pattern_present", "pattern": "test", "description": "Third check"},
        ],
    }
    console_data = {"errors": []}
    generated_code = "test();"

    result = run_checks(scenario, generated_code, console_data)

    check_ids = [check["check_id"] for check in result["checks"]]
    assert len(check_ids) == len(set(check_ids)), "Check IDs are not unique"
    assert check_ids == ["code_runs_0", "code_runs_1", "pattern_present_2"]


def test_description_preserved():
    """Test that check descriptions are preserved in output."""
    scenario = {
        "id": "test-023",
        "programmatic_checks": [
            {"type": "code_runs", "description": "Custom description here"}
        ],
    }
    console_data = {"errors": []}
    generated_code = "viewer.camera.flyTo({});"

    result = run_checks(scenario, generated_code, console_data)

    assert result["checks"][0]["description"] == "Custom description here"


if __name__ == "__main__":
    # Run all tests
    import sys
    import traceback

    test_functions = [
        test_code_runs_pass,
        test_code_runs_fail,
        test_no_console_errors_pass,
        test_no_console_errors_fail,
        test_pattern_present_pass,
        test_pattern_present_fail,
        test_pattern_absent_pass,
        test_pattern_absent_fail,
        test_schema_match_pass,
        test_schema_match_fail_missing_property,
        test_schema_match_fail_wrong_type,
        test_schema_match_fail_out_of_range,
        test_schema_match_fail_scene_not_available,
        test_api_present_pass,
        test_api_present_pass_cartesian3,
        test_api_present_fail,
        test_multiple_checks,
        test_deterministic_output,
        test_performance,
        test_invalid_regex_pattern,
        test_missing_pattern_field,
        test_check_ids_are_unique,
        test_description_preserved,
    ]

    passed = 0
    failed = 0

    for test_func in test_functions:
        try:
            test_func()
            print(f"✓ {test_func.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"✗ {test_func.__name__}: {e}")
            traceback.print_exc()
            failed += 1
        except Exception as e:
            print(f"✗ {test_func.__name__}: {e}")
            traceback.print_exc()
            failed += 1

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
