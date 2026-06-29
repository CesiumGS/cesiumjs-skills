#!/usr/bin/env python3
"""Run the deterministic evaluation scorecard.

Default mode uses tracked positive synthetic fixtures. Browser-captured evidence
can be supplied with repeated `--evidence` arguments. The command writes JSON
and Markdown scorecards under evaluation/artifacts/ by default, which is
gitignored and safe for local or CI artifacts.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator


REPO_ROOT = Path(__file__).resolve().parents[2]
CASES_ROOT = REPO_ROOT / "evaluation" / "cases"
FIXTURES_ROOT = REPO_ROOT / "evaluation" / "fixtures"
SCHEMAS_ROOT = REPO_ROOT / "evaluation" / "schemas"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "evaluation" / "artifacts" / "scorecards"

sys.path.insert(0, str(REPO_ROOT))
from evaluation.framework.scorecard import (  # noqa: E402
    DEFAULT_THRESHOLD,
    ScorecardInput,
    build_scorecard,
    write_scorecard,
)
from evaluation.runner import run_case  # noqa: E402


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def load_cases(cases_root: Path) -> dict[tuple[str, str], tuple[Path, dict[str, Any]]]:
    cases: dict[tuple[str, str], tuple[Path, dict[str, Any]]] = {}
    for path in sorted(cases_root.glob("*/eval-*.json")):
        data = load_json(path)
        key = (data["skill"], data["id"])
        if key in cases:
            raise ValueError(f"duplicate case id: {data['skill']}/{data['id']}")
        cases[key] = (path, data)
    if not cases:
        raise ValueError(f"no cases found under {cases_root}")
    return cases


def discover_fixture_evidence(fixtures_root: Path, expectation: str) -> list[Path]:
    paths = sorted(fixtures_root.glob("*/*.evidence.json"))
    if expectation == "all":
        return paths

    selected: list[Path] = []
    for path in paths:
        data = load_json(path)
        if data.get("expected_result", "pass") == expectation:
            selected.append(path)
    return selected


def relative_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def evidence_summary(evidence: dict[str, Any], evidence_path: Path) -> dict[str, Any]:
    after_values = (evidence.get("after") or {}).get("values") or {}
    return {
        "expected_result": evidence.get("expected_result"),
        "evidence_source": evidence.get("source"),
        "actual_source_path": evidence.get("source_path"),
        "run_artifact_path": evidence.get("run_artifact_path"),
        "source_scenario_id": after_values.get("source_scenario_id"),
        "observed_from": (evidence.get("execution") or {}).get("observed_from"),
        "evidence_path": relative_path(evidence_path),
        "has_generated_code": isinstance(evidence.get("generated_code"), str) and bool(evidence.get("generated_code")),
    }


def load_scorecard_validator() -> Draft7Validator:
    schema = load_json(SCHEMAS_ROOT / "scorecard.schema.json")
    result_schema = load_json(SCHEMAS_ROOT / "result.schema.json")
    schema["definitions"]["case_result"]["properties"]["checks"]["items"] = result_schema["definitions"]["check_result"]
    return Draft7Validator(schema)


def load_visual_review_validator() -> Draft7Validator:
    return Draft7Validator(load_json(SCHEMAS_ROOT / "visual-review.schema.json"))


def validate_visual_review(
    visual_review: dict[str, Any],
    cases: dict[tuple[str, str], tuple[Path, dict[str, Any]]],
) -> list[str]:
    errors: list[str] = []
    validator = load_visual_review_validator()
    for error in sorted(validator.iter_errors(visual_review), key=lambda item: list(item.path)):
        location = ".".join(str(part) for part in error.path) or "<root>"
        errors.append(f"schema error at {location}: {error.message}")

    seen: set[tuple[str, str]] = set()
    for item in visual_review.get("items", []):
        if not isinstance(item, dict):
            continue
        key = (str(item.get("skill", "")), str(item.get("case_id", "")))
        if key in seen:
            errors.append(f"duplicate visual review item: {key[0]}/{key[1]}")
        seen.add(key)
        if key not in cases:
            errors.append(f"visual review references unknown case: {key[0]}/{key[1]}")
    return errors


def run_inputs(cases: dict[tuple[str, str], tuple[Path, dict[str, Any]]], evidence_paths: list[Path]) -> list[ScorecardInput]:
    inputs: list[ScorecardInput] = []
    for evidence_path in evidence_paths:
        evidence = load_json(evidence_path)
        key = (evidence.get("skill"), evidence.get("case_id"))
        if key not in cases:
            raise ValueError(f"{evidence_path}: evidence references unknown case {key[0]}/{key[1]}")
        _, case = cases[key]
        result = run_case(case, evidence)
        inputs.append(
            ScorecardInput(
                case=case,
                result=result,
                evidence_path=relative_path(evidence_path),
                screenshots=tuple(evidence.get("screenshots", ())),
                evidence_summary=evidence_summary(evidence, evidence_path),
            )
        )
    if not inputs:
        raise ValueError("no evidence selected for scorecard run")
    return inputs


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases-root", default=str(CASES_ROOT))
    parser.add_argument("--fixtures-root", default=str(FIXTURES_ROOT))
    parser.add_argument(
        "--fixture-expectation",
        choices=["pass", "fail", "all"],
        default="pass",
        help="Which tracked synthetic fixtures to run when --evidence is omitted.",
    )
    parser.add_argument(
        "--evidence",
        action="append",
        default=[],
        help="Evidence JSON file to score. Repeat for multiple evidence files.",
    )
    parser.add_argument(
        "--visual-review",
        help="Optional qualitative visual review JSON to attach to the scorecard.",
    )
    parser.add_argument(
        "--require-visual-review",
        action="store_true",
        help="Fail cases without a recorded qualitative visual review.",
    )
    parser.add_argument(
        "--harness",
        default=None,
        help=(
            "Codegen harness that produced the scored evidence (the 'tested with' id "
            "stamped into the scorecard). Omit for synthetic fixtures (stays 'unknown')."
        ),
    )
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--output-dir", default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    cases_root = Path(args.cases_root)
    fixtures_root = Path(args.fixtures_root)
    cases = load_cases(cases_root)

    evidence_paths = [Path(path) for path in args.evidence]
    if not evidence_paths:
        evidence_paths = discover_fixture_evidence(fixtures_root, args.fixture_expectation)

    visual_review = load_json(Path(args.visual_review)) if args.visual_review else None
    if visual_review is not None:
        visual_errors = validate_visual_review(visual_review, cases)
        if visual_errors:
            for error in visual_errors:
                print(f"[run-scorecard] visual-review {error}", file=sys.stderr)
            return 2

    inputs = run_inputs(cases, evidence_paths)
    scorecard = build_scorecard(
        inputs,
        threshold=args.threshold,
        repo_root=REPO_ROOT,
        visual_review=visual_review,
        require_visual_review=args.require_visual_review,
        harness=args.harness,
    )

    output_dir = Path(args.output_dir) if args.output_dir else DEFAULT_OUTPUT_ROOT / scorecard["run_id"]
    if not output_dir.is_absolute():
        output_dir = REPO_ROOT / output_dir
    json_path, md_path = write_scorecard(scorecard, output_dir)

    validator = load_scorecard_validator()
    errors = sorted(validator.iter_errors(scorecard), key=lambda error: list(error.path))
    if errors:
        for error in errors:
            location = ".".join(str(part) for part in error.path) or "<root>"
            print(f"[run-scorecard] schema error at {location}: {error.message}", file=sys.stderr)
        return 2

    print(f"[run-scorecard] wrote {relative_path(json_path)}")
    print(f"[run-scorecard] wrote {relative_path(md_path)}")
    print(f"[run-scorecard] result={scorecard['overall_result']} score={scorecard['overall_score']:.1%}")
    return 0 if scorecard["overall_result"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
