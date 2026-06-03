#!/usr/bin/env python3
"""
Deterministic check engine for CesiumJS skill evaluations.

Runs pass/fail checks on evaluation evidence without requiring LLM judgment.
Produces byte-identical results when run on the same evidence bundle.

Supported check types:
- code_runs: Checks if the code executed without runtime exceptions
- no_console_errors: Checks if there are no console errors or page errors
- pattern_present: Checks if a regex pattern is present in the generated code
- pattern_absent: Checks if a regex pattern is absent from the generated code
- schema_match: Checks if scene state matches a JSON schema
- api_present: Checks if a CesiumJS API method/property is present in the code
"""

import re
import json
from typing import Any
from pathlib import Path


def run_checks(
    scenario: dict[str, Any],
    generated_code: str,
    console_data: dict[str, Any],
    scene_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Run all programmatic checks for a scenario.

    Args:
        scenario: The scenario manifest with programmatic_checks field
        generated_code: The generated JavaScript code
        console_data: Console output with 'errors' field
        scene_state: Optional scene state data for schema_match checks

    Returns:
        Dict with structure:
        {
            "scenario_id": str,
            "checks": [
                {
                    "check_id": str (derived from type + index),
                    "type": str,
                    "result": "pass" | "fail",
                    "detail": str,
                    "description": str
                }
            ]
        }

    Notes:
        - Results are deterministic: same inputs produce byte-identical output
        - Completes in under 5 seconds per scenario on typical machines
        - All checks run independently; one failure doesn't stop others
    """
    scenario_id = scenario.get("id", "unknown")
    checks_results: list[dict[str, Any]] = []

    errors = console_data.get("errors", [])

    for idx, check in enumerate(scenario.get("programmatic_checks", [])):
        check_type = check["type"]
        description = check.get("description", "")
        check_id = f"{check_type}_{idx}"

        result = "fail"
        detail = ""

        try:
            if check_type == "code_runs":
                result, detail = _check_code_runs(errors)
            elif check_type == "no_console_errors":
                result, detail = _check_no_console_errors(errors)
            elif check_type == "pattern_present":
                pattern = check.get("pattern", "")
                result, detail = _check_pattern_present(generated_code, pattern)
            elif check_type == "pattern_absent":
                pattern = check.get("pattern", "")
                result, detail = _check_pattern_absent(generated_code, pattern)
            elif check_type == "schema_match":
                schema = check.get("schema", {})
                result, detail = _check_schema_match(scene_state, schema)
            elif check_type == "api_present":
                api = check.get("api", "")
                result, detail = _check_api_present(generated_code, api)
            else:
                result = "fail"
                detail = f"Unsupported check type: {check_type}"
        except Exception as e:
            result = "fail"
            detail = f"Check execution error: {str(e)}"

        checks_results.append({
            "check_id": check_id,
            "type": check_type,
            "result": result,
            "detail": detail,
            "description": description,
        })

    return {
        "scenario_id": scenario_id,
        "checks": checks_results,
    }


def _check_code_runs(errors: list[dict[str, Any]]) -> tuple[str, str]:
    """Check if code executed without runtime exceptions."""
    if len(errors) == 0:
        return "pass", "Code completed without captured errors"
    return "fail", f"Runtime errors captured: {len(errors)} error(s)"


def _check_no_console_errors(errors: list[dict[str, Any]]) -> tuple[str, str]:
    """Check if there are no console or page errors."""
    if len(errors) == 0:
        return "pass", "No console or page errors captured"
    return "fail", f"Console/page errors found: {len(errors)} error(s)"


def _check_pattern_present(code: str, pattern: str) -> tuple[str, str]:
    """Check if a regex pattern is present in the code."""
    if not pattern:
        return "fail", "No pattern specified"

    try:
        match = re.search(pattern, code, re.MULTILINE | re.IGNORECASE)
        if match:
            return "pass", f"Pattern matched: '{match.group(0)[:50]}'"
        return "fail", f"Pattern not found: '{pattern}'"
    except re.error as e:
        return "fail", f"Invalid regex pattern: {e}"


def _check_pattern_absent(code: str, pattern: str) -> tuple[str, str]:
    """Check if a regex pattern is absent from the code."""
    if not pattern:
        return "fail", "No pattern specified"

    try:
        match = re.search(pattern, code, re.MULTILINE | re.IGNORECASE)
        if match:
            return "fail", f"Unexpected pattern found: '{match.group(0)[:50]}'"
        return "pass", "Pattern not found (as expected)"
    except re.error as e:
        return "fail", f"Invalid regex pattern: {e}"


def _check_schema_match(scene_state: dict[str, Any] | None, schema: dict[str, Any]) -> tuple[str, str]:
    """
    Check if scene state matches a JSON schema.

    This is a simplified schema matcher focusing on common use cases:
    - Required properties existence
    - Type validation
    - Numeric ranges (minimum, maximum)
    - Array constraints (minItems, maxItems)

    For full JSON Schema validation, consider integrating jsonschema library.
    """
    if not schema:
        return "fail", "No schema specified"

    if scene_state is None or not scene_state.get("available", False):
        return "fail", "Scene state not available"

    # Validate required properties
    required_props = schema.get("required", [])
    for prop in required_props:
        if prop not in scene_state:
            return "fail", f"Required property missing: '{prop}'"

    # Validate property types and constraints
    properties = schema.get("properties", {})
    for prop, prop_schema in properties.items():
        if prop not in scene_state:
            continue  # Skip optional properties

        value = scene_state[prop]
        expected_type = prop_schema.get("type")

        # Type validation
        if expected_type:
            if not _validate_type(value, expected_type):
                return "fail", f"Property '{prop}' has wrong type (expected {expected_type})"

        # Numeric range validation
        if expected_type in ["number", "integer"]:
            minimum = prop_schema.get("minimum")
            maximum = prop_schema.get("maximum")
            if minimum is not None and value < minimum:
                return "fail", f"Property '{prop}' below minimum: {value} < {minimum}"
            if maximum is not None and value > maximum:
                return "fail", f"Property '{prop}' above maximum: {value} > {maximum}"

        # Array constraints
        if expected_type == "array":
            min_items = prop_schema.get("minItems")
            max_items = prop_schema.get("maxItems")
            if min_items is not None and len(value) < min_items:
                return "fail", f"Array '{prop}' has too few items: {len(value)} < {min_items}"
            if max_items is not None and len(value) > max_items:
                return "fail", f"Array '{prop}' has too many items: {len(value)} > {max_items}"

    return "pass", "Scene state matches schema"


def _validate_type(value: Any, expected_type: str) -> bool:
    """Validate JSON Schema type."""
    type_map = {
        "string": str,
        "number": (int, float),
        "integer": int,
        "boolean": bool,
        "array": list,
        "object": dict,
        "null": type(None),
    }

    expected_python_type = type_map.get(expected_type)
    if expected_python_type is None:
        return False

    return isinstance(value, expected_python_type)


def _check_api_present(code: str, api: str) -> tuple[str, str]:
    """
    Check if a CesiumJS API method or property is present in the code.

    Examples:
    - api="viewer.camera.flyTo" -> checks for "flyTo" method call
    - api="Cesium.Cartesian3" -> checks for Cartesian3 usage
    - api="viewer.scene.globe" -> checks for globe property access
    """
    if not api:
        return "fail", "No API specified"

    # Extract the method/property name from the full API path
    # e.g., "viewer.camera.flyTo" -> "flyTo"
    api_parts = api.split(".")
    api_name = api_parts[-1]

    # Check for the API name in the code
    # Use word boundary to avoid partial matches
    pattern = r'\b' + re.escape(api_name) + r'\b'
    match = re.search(pattern, code)

    if match:
        return "pass", f"API present: '{api_name}'"
    return "fail", f"API not found: '{api_name}'"


def run_checks_from_bundle(bundle_dir: Path) -> dict[str, Any]:
    """
    Run checks on a complete evidence bundle.

    Args:
        bundle_dir: Path to evidence bundle directory containing:
            - scenario manifest reference (loaded from metadata.json)
            - generated code (*.js file)
            - console.json
            - scene-state.json (optional)

    Returns:
        Check results dict (same format as run_checks)
    """
    # Load console data
    console_path = bundle_dir / "console.json"
    with open(console_path) as f:
        console_data = json.load(f)

    # Load scene state if available
    scene_state_path = bundle_dir / "scene-state.json"
    scene_state = None
    if scene_state_path.exists():
        with open(scene_state_path) as f:
            scene_state = json.load(f)

    # Find generated code file (*.js)
    js_files = list(bundle_dir.glob("*.js"))
    if not js_files:
        raise FileNotFoundError(f"No .js file found in {bundle_dir}")
    generated_code_path = js_files[0]
    with open(generated_code_path) as f:
        generated_code = f.read()

    # Load metadata to get scenario ID
    metadata_path = bundle_dir / "metadata.json"
    with open(metadata_path) as f:
        metadata = json.load(f)

    # We need the full scenario manifest for programmatic_checks
    # This would typically be loaded from the scenarios directory
    # For now, return a minimal structure
    # TODO: Load full scenario from optimization/scenarios/<skill>/<eval-id>.json
    scenario_id = console_data.get("scenario_id", metadata.get("scenario_id", "unknown"))
    scenario = {"id": scenario_id, "programmatic_checks": []}

    return run_checks(scenario, generated_code, console_data, scene_state)
