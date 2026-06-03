#!/usr/bin/env python3
"""Pure deterministic evaluation runner.

This runner intentionally does not propose candidates, judge subjective visual
quality, update current-best metadata, or mutate `skills/`. It loads an
evaluation case and a captured evidence bundle, dispatches every deterministic
check through the registry, and returns a pass/fail result.

The browser scene-capture harness is still a future layer. This module is the
stable core that layer should call once it has produced before/after evidence.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path

from .framework import checks  # noqa: F401 - registers built-in check matchers
from .framework.registry import dispatch
from .framework.types import CaseResult, CheckResult


DEFAULT_CHECK_CATEGORIES = {
    "entity_exists": "entity_state",
    "entity_translation_delta": "semantic_scene_state",
    "no_runtime_errors": "execution_health",
    "camera_target_view": "camera_framing",
    "json_value_equals": "semantic_scene_state",
    "json_value_compare": "semantic_scene_state",
    "collection_count": "semantic_scene_state",
    "pattern_present": "source_contract",
    "pattern_absent": "source_contract",
    "code_runs": "execution_health",
    "artifact_text_absent": "artifact_hygiene",
}
DEFAULT_CRITICAL_CATEGORIES = {
    "execution_health",
    "entity_state",
    "semantic_scene_state",
    "camera_framing",
    "asset_and_provider_safety",
    "artifact_hygiene",
    "public_reproducibility",
}
LEGACY_CATEGORY_ALIASES = {
    "camera_behavior": "camera_framing",
    "generated_output_semantics": "semantic_scene_state",
}


def normalize_category(category: str, check_type: str) -> str:
    if category == "generated_output_semantics" and check_type in {"pattern_present", "pattern_absent"}:
        return "source_contract"
    return LEGACY_CATEGORY_ALIASES.get(category, category)


def _check_tolerance(spec: dict) -> object:
    for key in ("tolerance", "tolerance_meters", "tolerance_degrees"):
        if key in spec:
            return spec[key]
    return None


def enrich_check_result(result: CheckResult, spec: dict, case: dict) -> CheckResult:
    raw_category = str(
        spec.get("category")
        or DEFAULT_CHECK_CATEGORIES.get(result.type)
        or case.get("category")
        or "uncategorized"
    )
    category = normalize_category(raw_category, result.type)
    critical = bool(spec.get("critical", case.get("critical", category in DEFAULT_CRITICAL_CATEGORIES)))
    return replace(
        result,
        category=category,
        critical=critical,
        weight=float(spec.get("weight", result.weight)),
        tolerance=_check_tolerance(spec),
    )


def run_case(case: dict, evidence: dict) -> CaseResult:
    started = time.perf_counter()
    results: list[CheckResult] = []
    error: str | None = None

    try:
        for spec in case.get("checks", []):
            results.append(enrich_check_result(dispatch(spec, evidence), spec, case))
    except Exception as exc:  # Keep runner output structured even on malformed cases.
        error = f"{type(exc).__name__}: {exc}"

    duration_ms = int((time.perf_counter() - started) * 1000)
    passed = bool(results) and all(result.passed for result in results) and error is None
    return CaseResult(
        case_id=str(case.get("id", "")),
        case_name=str(case.get("name", "")),
        skill=str(case.get("skill", "")),
        result="pass" if passed else "fail",
        checks=tuple(results),
        duration_ms=duration_ms,
        error=error,
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("case", help="Path to evaluation case JSON")
    p.add_argument("--evidence", required=True, help="Path to captured evidence JSON")
    p.add_argument("--output", help="Optional path to write the result JSON")
    args = p.parse_args()

    case_path = Path(args.case)
    if not case_path.exists():
        print(f"Case not found: {case_path}", file=sys.stderr)
        return 1
    evidence_path = Path(args.evidence)
    if not evidence_path.exists():
        print(f"Evidence not found: {evidence_path}", file=sys.stderr)
        return 1

    case = json.loads(case_path.read_text())
    evidence = json.loads(evidence_path.read_text())
    result = run_case(case, evidence).to_dict()

    payload = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).write_text(payload + "\n")
    else:
        print(payload)
    return 0 if result["result"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
