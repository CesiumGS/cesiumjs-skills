#!/usr/bin/env python3
"""Validate public CesiumJS skills eval scenario manifests."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SCENARIOS_ROOT = REPO_ROOT / "evals" / "scenarios"
RESULTS_PATH = REPO_ROOT / "evals" / "results" / "public-status.json"
ALLOWED_CHECK_TYPES = {
    "no_console_errors",
    "code_runs",
    "pattern_present",
    "pattern_absent",
}
REQUIRED_FIELDS = {
    "id",
    "name",
    "difficulty",
    "description",
    "prompt",
    "expected_behaviors",
    "visual_expectations",
    "programmatic_checks",
    "screenshots",
    "regression_critical",
}


def fail(message: str) -> None:
    print(f"[validate-evals] FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid JSON: {exc}")


def require_string(data: dict[str, Any], key: str, path: Path) -> None:
    if not isinstance(data.get(key), str) or not data[key].strip():
        fail(f"{path}: {key} must be a non-empty string")


def validate_check(check: dict[str, Any], path: Path, index: int) -> None:
    check_type = check.get("type")
    if check_type not in ALLOWED_CHECK_TYPES:
        fail(f"{path}: programmatic_checks[{index}].type is unsupported: {check_type!r}")
    require_string(check, "description", path)
    if check_type in {"pattern_present", "pattern_absent"}:
        require_string(check, "pattern", path)
        try:
            re.compile(check["pattern"])
        except re.error as exc:
            fail(f"{path}: programmatic_checks[{index}].pattern is invalid regex: {exc}")


def validate_scenario(path: Path) -> tuple[str, str]:
    data = load_json(path)
    if not isinstance(data, dict):
        fail(f"{path}: top-level JSON value must be an object")

    missing = sorted(REQUIRED_FIELDS - set(data))
    if missing:
        fail(f"{path}: missing required field(s): {', '.join(missing)}")

    require_string(data, "id", path)
    require_string(data, "name", path)
    require_string(data, "difficulty", path)
    require_string(data, "description", path)
    require_string(data, "prompt", path)
    require_string(data, "visual_expectations", path)

    if not re.fullmatch(r"eval-[0-9]{3}", data["id"]):
        fail(f"{path}: id must match eval-NNN")
    if not path.name.startswith(data["id"] + "-"):
        fail(f"{path}: filename must start with scenario id {data['id']}-")
    if not isinstance(data["expected_behaviors"], list) or not data["expected_behaviors"]:
        fail(f"{path}: expected_behaviors must be a non-empty array")
    if not all(isinstance(item, str) and item.strip() for item in data["expected_behaviors"]):
        fail(f"{path}: expected_behaviors entries must be non-empty strings")
    if not isinstance(data["programmatic_checks"], list) or not data["programmatic_checks"]:
        fail(f"{path}: programmatic_checks must be a non-empty array")
    for index, check in enumerate(data["programmatic_checks"]):
        if not isinstance(check, dict):
            fail(f"{path}: programmatic_checks[{index}] must be an object")
        validate_check(check, path, index)
    if not isinstance(data["screenshots"], list) or not data["screenshots"]:
        fail(f"{path}: screenshots must be a non-empty array")
    for index, screenshot in enumerate(data["screenshots"]):
        if not isinstance(screenshot, dict):
            fail(f"{path}: screenshots[{index}] must be an object")
        for key in ("timing", "description"):
            require_string(screenshot, key, path)
        if not isinstance(screenshot.get("delay_ms"), int) or screenshot["delay_ms"] < 0:
            fail(f"{path}: screenshots[{index}].delay_ms must be a non-negative integer")
    if not isinstance(data["regression_critical"], bool):
        fail(f"{path}: regression_critical must be boolean")
    if data.get("runner_mode", "global-js") not in {"global-js", "review-only"}:
        fail(f"{path}: runner_mode must be global-js or review-only")

    return path.parent.name, data["id"]


def validate_results(skill_counts: dict[str, int]) -> None:
    data = load_json(RESULTS_PATH)
    if data.get("schema_version") != "1.0":
        fail(f"{RESULTS_PATH}: schema_version must be 1.0")
    if data.get("summary_type") != "public-sanitized-eval-status":
        fail(f"{RESULTS_PATH}: summary_type must be public-sanitized-eval-status")
    skills = data.get("skills")
    if not isinstance(skills, list) or not skills:
        fail(f"{RESULTS_PATH}: skills must be a non-empty array")
    for entry in skills:
        if not isinstance(entry, dict):
            fail(f"{RESULTS_PATH}: each skills entry must be an object")
        skill = entry.get("skill")
        if skill not in skill_counts:
            fail(f"{RESULTS_PATH}: unknown skill summary {skill!r}")
        if entry.get("scenario_count") != skill_counts[skill]:
            fail(
                f"{RESULTS_PATH}: {skill} scenario_count {entry.get('scenario_count')} "
                f"does not match {skill_counts[skill]}"
            )
        runner_mode_counts = entry.get("runner_mode_counts")
        if not isinstance(runner_mode_counts, dict):
            fail(f"{RESULTS_PATH}: {skill} runner_mode_counts must be an object")
        if sum(runner_mode_counts.values()) != skill_counts[skill]:
            fail(f"{RESULTS_PATH}: {skill} runner_mode_counts do not sum to scenario_count")
        unknown_modes = set(runner_mode_counts) - {"global-js", "review-only"}
        if unknown_modes:
            fail(f"{RESULTS_PATH}: {skill} has unknown runner mode(s): {sorted(unknown_modes)}")


def main() -> None:
    if not SCENARIOS_ROOT.is_dir():
        fail(f"{SCENARIOS_ROOT} does not exist")

    seen: set[tuple[str, str]] = set()
    skill_counts: dict[str, int] = {}
    scenario_paths = sorted(SCENARIOS_ROOT.glob("*/eval-*.json"))
    if not scenario_paths:
        fail("no scenario manifests found")

    for path in scenario_paths:
        skill, scenario_id = validate_scenario(path)
        key = (skill, scenario_id)
        if key in seen:
            fail(f"duplicate scenario id for {skill}: {scenario_id}")
        seen.add(key)
        skill_counts[skill] = skill_counts.get(skill, 0) + 1

    validate_results(skill_counts)
    print(
        f"[validate-evals] OK: {len(scenario_paths)} scenarios across "
        f"{len(skill_counts)} skills"
    )


if __name__ == "__main__":
    main()
