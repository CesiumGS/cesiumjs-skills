#!/usr/bin/env python3
"""Run BOTH evaluation lanes over all 14 skills' rendered baselines.

This is the single combined-audit entry point described in
``evaluation/docs/qualitative-audit-design.md`` (section 4). For each selected
skill it:

1. Selects the tracked ``*-baseline-observed.evidence.json`` fixtures whose
   ``case_id`` matches ``^eval-1[0-9]{2}$`` (the archived baselines), bridges
   each to its rendered bundle via the fixture's ``run_artifact_path``
   (``optimization/runs/<skill>/baseline/<dir>``), and loads the matching case
   manifest ``evaluation/cases/<skill>/<case_id>-*.json``.

2. **Lane 1 (deterministic):** runs ``evaluation.runner.run_case(case, evidence)``
   -> ``CaseResult`` -- the same binding gate as ``run-scorecard.py``.

3. **Lane 2 (qualitative):** unless ``--no-judge``, runs the static visual judge
   panel (``evaluation.framework.judge.static_judge.judge_render``) over each
   bundle. When ``--visual-review <json>`` is supplied the in-process judging is
   skipped and those pre-judged items are used instead (this is how the local
   parallel fan-out injects its per-case judge results).

It then assembles one combined scorecard (deterministic lane is binding; the
qualitative lane can only downgrade), writes it under
``evaluation/artifacts/audits/<run_id>/scorecard.{json,md}``, and validates both
the visual-review doc and the scorecard against their schemas.

Exit code is the combined gate: ``0`` iff ``overall_result == pass``.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator


REPO_ROOT = Path(__file__).resolve().parents[2]
CASES_ROOT = REPO_ROOT / "evaluation" / "cases"
FIXTURES_ROOT = REPO_ROOT / "evaluation" / "fixtures"
SCHEMAS_ROOT = REPO_ROOT / "evaluation" / "schemas"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "evaluation" / "artifacts" / "audits"

sys.path.insert(0, str(REPO_ROOT))
from evaluation.framework.judge.static_judge import (  # noqa: E402
    JudgeConfig,
    PROTOCOL_VERSION,
    judge_render,
)
from evaluation.framework.judge.cli_adapter import ClaudeCliAdapter, FakeAdapter  # noqa: E402
from evaluation.framework.judge.static_judge import _build_adapter  # noqa: E402
from evaluation.framework.scorecard import (  # noqa: E402
    DEFAULT_THRESHOLD,
    ScorecardInput,
    build_scorecard,
    git_commit,
    make_run_id,
    write_scorecard,
)
from evaluation.runner import run_case  # noqa: E402

# case_id pattern for the archived baselines (eval-1NN).
BASELINE_CASE_RE = re.compile(r"^eval-1[0-9]{2}$")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def relative_path(path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


# --- discovery -----------------------------------------------------------


def all_skills(fixtures_root: Path) -> list[str]:
    return sorted(
        p.name
        for p in fixtures_root.iterdir()
        if p.is_dir() and not p.name.startswith(".")
    )


def select_baseline_fixtures(fixtures_root: Path, skill: str) -> list[Path]:
    """Tracked baseline-observed fixtures for a skill, eval-1NN only, sorted."""
    selected: list[Path] = []
    for path in sorted(fixtures_root.glob(f"{skill}/eval-1*-baseline-observed.evidence.json")):
        data = load_json(path)
        case_id = str(data.get("case_id", ""))
        if BASELINE_CASE_RE.match(case_id):
            selected.append(path)
    return selected


def find_case_manifest(cases_root: Path, skill: str, case_id: str) -> Path | None:
    matches = sorted(cases_root.glob(f"{skill}/{case_id}-*.json"))
    if not matches:
        # Fall back to exact <case_id>.json if no descriptive suffix is used.
        exact = cases_root / skill / f"{case_id}.json"
        if exact.is_file():
            return exact
        return None
    return matches[0]


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
        "has_generated_code": isinstance(evidence.get("generated_code"), str)
        and bool(evidence.get("generated_code")),
    }


def bundle_dir_for(evidence: dict[str, Any]) -> Path | None:
    rel = evidence.get("run_artifact_path")
    if not rel:
        return None
    path = Path(rel)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def screenshot_path_for(bundle_dir: Path | None, evidence: dict[str, Any]) -> str:
    """Repo-relative primary screenshot path, preferring the rendered bundle."""
    if bundle_dir is not None:
        primary = bundle_dir / "screenshot.png"
        if primary.is_file():
            return relative_path(primary)
    shots = evidence.get("screenshots") or []
    if shots:
        return str(shots[0])
    return ""


# --- collection ----------------------------------------------------------


class AuditCase:
    """One selected baseline: its case manifest, evidence, and bundle."""

    def __init__(
        self,
        skill: str,
        case_id: str,
        case_path: Path,
        case: dict[str, Any],
        evidence_path: Path,
        evidence: dict[str, Any],
        bundle_dir: Path | None,
    ) -> None:
        self.skill = skill
        self.case_id = case_id
        self.case_path = case_path
        self.case = case
        self.evidence_path = evidence_path
        self.evidence = evidence
        self.bundle_dir = bundle_dir


def collect_cases(skills: list[str]) -> list[AuditCase]:
    collected: list[AuditCase] = []
    for skill in skills:
        for evidence_path in select_baseline_fixtures(FIXTURES_ROOT, skill):
            evidence = load_json(evidence_path)
            case_id = str(evidence.get("case_id", ""))
            case_path = find_case_manifest(CASES_ROOT, skill, case_id)
            if case_path is None:
                raise ValueError(
                    f"{relative_path(evidence_path)}: no case manifest for "
                    f"{skill}/{case_id} under {relative_path(CASES_ROOT / skill)}"
                )
            case = load_json(case_path)
            collected.append(
                AuditCase(
                    skill=skill,
                    case_id=case_id,
                    case_path=case_path,
                    case=case,
                    evidence_path=evidence_path,
                    evidence=evidence,
                    bundle_dir=bundle_dir_for(evidence),
                )
            )
    if not collected:
        raise ValueError("no baseline-observed fixtures selected for audit")
    return collected


# --- judge meta (case_meta passed to judge_render) -----------------------


def case_meta_for(audit_case: AuditCase) -> dict[str, Any]:
    case = audit_case.case
    return {
        "skill": audit_case.skill,
        "id": case.get("id", audit_case.case_id),
        "case_id": audit_case.case_id,
        "name": case.get("name", ""),
        "description": case.get("description", ""),
        "prompt": case.get("prompt", ""),
        "expected_behaviors": case.get("expected_behaviors"),
        "visual_expectations": case.get("visual_expectations"),
    }


# --- validation ----------------------------------------------------------


def load_scorecard_validator() -> Draft7Validator:
    schema = load_json(SCHEMAS_ROOT / "scorecard.schema.json")
    result_schema = load_json(SCHEMAS_ROOT / "result.schema.json")
    schema["definitions"]["case_result"]["properties"]["checks"]["items"] = (
        result_schema["definitions"]["check_result"]
    )
    return Draft7Validator(schema)


def load_visual_review_validator() -> Draft7Validator:
    return Draft7Validator(load_json(SCHEMAS_ROOT / "visual-review.schema.json"))


def validate_visual_review(
    visual_review: dict[str, Any],
    case_keys: set[tuple[str, str]],
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
        if key not in case_keys:
            errors.append(f"visual review references unknown case: {key[0]}/{key[1]}")
    return errors


# --- args ----------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skills",
        default="all",
        help="'all' (default) or a comma-separated list of skill ids to audit.",
    )
    parser.add_argument("--judge-model", default="sonnet", help="Judge model id/alias (default: sonnet).")
    parser.add_argument("--n-judges", type=int, default=3, help="Number of panel judges (default: 3).")
    parser.add_argument("--no-judge", action="store_true", help="Skip the qualitative lane entirely.")
    parser.add_argument(
        "--visual-review",
        help="Pre-judged visual-review JSON to inject (skips in-process judging).",
    )
    parser.add_argument(
        "--emit-cases",
        help="Write the {skill,case_id,prompt,bundle_dir,screenshot_path} list and exit.",
    )
    parser.add_argument(
        "--emit-visual-review",
        help="Also write the assembled visual-review doc to this path.",
    )
    parser.add_argument(
        "--adapter",
        default="claude",
        choices=["claude", "fake"],
        help="Judge adapter (default: claude; 'fake' for tests).",
    )
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--output-dir", default=None)
    return parser.parse_args(argv)


def resolve_skills(spec: str) -> list[str]:
    available = all_skills(FIXTURES_ROOT)
    if spec.strip().lower() == "all":
        return available
    requested = [s.strip() for s in spec.split(",") if s.strip()]
    unknown = [s for s in requested if s not in available]
    if unknown:
        raise ValueError(
            f"unknown skill(s): {', '.join(unknown)}. Available: {', '.join(available)}"
        )
    return requested


# --- main ----------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])

    skills = resolve_skills(args.skills)
    audit_cases = collect_cases(skills)
    case_keys = {(c.skill, c.case_id) for c in audit_cases}

    # --emit-cases: write the work list for the parallel Score/Judge phases.
    if args.emit_cases:
        cases_list = [
            {
                "skill": c.skill,
                "case_id": c.case_id,
                "prompt": str(c.case.get("prompt", "")),
                "bundle_dir": relative_path(c.bundle_dir) if c.bundle_dir else "",
                "screenshot_path": screenshot_path_for(c.bundle_dir, c.evidence),
                "case_path": relative_path(c.case_path),
            }
            for c in audit_cases
        ]
        out = Path(args.emit_cases)
        if not out.is_absolute():
            out = REPO_ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(cases_list, indent=2) + "\n")
        print(f"[baseline-audit] wrote {len(cases_list)} cases -> {relative_path(out)}")
        return 0

    # Shared timestamp/commit so run_id is stable across the scorecard and the
    # assembled visual-review doc.
    timestamp_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    commit = git_commit(REPO_ROOT)
    run_id = make_run_id(timestamp_utc, commit)

    # --- Lane 2: qualitative -------------------------------------------
    visual_review: dict[str, Any] | None = None
    judged_baseline_count = 0

    if args.visual_review:
        # Injected pre-judged items (local fan-out path); do not run the panel.
        visual_review = load_json(Path(args.visual_review))
        visual_review.setdefault("schema_version", "1.0")
        visual_review.setdefault("reviewer", "static-visual-judge")
        visual_review.setdefault("run_id", run_id)
        judged_baseline_count = sum(
            1
            for item in visual_review.get("items", [])
            if isinstance(item, dict) and item.get("status") not in (None, "not_reviewed")
        )
    elif not args.no_judge:
        if args.adapter == "fake":
            adapter = _build_adapter("fake")
        else:
            adapter = ClaudeCliAdapter()
        items: list[dict[str, Any]] = []
        for c in audit_cases:
            config = JudgeConfig(
                adapter=adapter,
                model=args.judge_model,
                n_judges=args.n_judges,
                repo_root=REPO_ROOT,
            )
            item = judge_render(case_meta_for(c), bundle_dir=c.bundle_dir, config=config)
            items.append(item)
            if item.get("status") not in (None, "not_reviewed"):
                judged_baseline_count += 1
        visual_review = {
            "schema_version": "1.0",
            "reviewer": "static-visual-judge",
            "run_id": run_id,
            "reviewed_at": timestamp_utc,
            "items": items,
        }

    # Optionally persist the assembled visual-review doc.
    if args.emit_visual_review and visual_review is not None:
        out = Path(args.emit_visual_review)
        if not out.is_absolute():
            out = REPO_ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(visual_review, indent=2) + "\n")
        print(f"[baseline-audit] wrote visual-review -> {relative_path(out)}")

    # Validate the visual-review doc before scoring (matches run-scorecard.py).
    if visual_review is not None:
        visual_errors = validate_visual_review(visual_review, case_keys)
        if visual_errors:
            for error in visual_errors:
                print(f"[baseline-audit] visual-review {error}", file=sys.stderr)
            return 2

    # --- Lane 1: deterministic + assemble combined scorecard -----------
    inputs: list[ScorecardInput] = []
    for c in audit_cases:
        result = run_case(c.case, c.evidence)
        inputs.append(
            ScorecardInput(
                case=c.case,
                result=result,
                evidence_path=relative_path(c.evidence_path),
                screenshots=tuple(c.evidence.get("screenshots", ())),
                evidence_summary=evidence_summary(c.evidence, c.evidence_path),
            )
        )

    require_visual_review = visual_review is not None
    scorecard = build_scorecard(
        inputs,
        threshold=args.threshold,
        repo_root=REPO_ROOT,
        timestamp_utc=timestamp_utc,
        commit=commit,
        visual_review=visual_review,
        require_visual_review=require_visual_review,
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
            print(f"[baseline-audit] schema error at {location}: {error.message}", file=sys.stderr)
        return 2

    print(f"[baseline-audit] wrote {relative_path(json_path)}")
    print(f"[baseline-audit] wrote {relative_path(md_path)}")
    print(f"[baseline-audit] run_id={scorecard['run_id']}")
    print(f"[baseline-audit] deterministic_result={scorecard['deterministic_result']}")
    print(f"[baseline-audit] visual_result={scorecard['visual_summary']['result']}")
    print(f"[baseline-audit] overall_result={scorecard['overall_result']}")
    print(f"[baseline-audit] judged_baseline_count={judged_baseline_count}")
    return 0 if scorecard["overall_result"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
