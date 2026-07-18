"""Scorecard aggregation for deterministic and qualitative evaluation results."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .types import CaseResult


SCORECARD_SCHEMA_VERSION = "1.0"
DEFAULT_THRESHOLD = 0.95
VISUAL_REVIEW_STATUSES = {
    "pass",
    "fail",
    "needs_review",
    "not_reviewed",
    "not_applicable",
}
VISUAL_DIMENSION_KEYS = (
    "nonblank_render",
    "target_visible",
    "framing",
    "occlusion",
    "clutter",
    "prompt_match",
)
VISUAL_DIMENSION_STATUSES = {"pass", "fail", "needs_review", "not_applicable"}


@dataclass(frozen=True)
class ScorecardInput:
    case: dict[str, Any]
    result: CaseResult
    evidence_path: str
    screenshots: tuple[str, ...] = ()
    evidence_summary: dict[str, Any] | None = None


def git_commit(repo_root: Path) -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return completed.stdout.strip()


def make_run_id(timestamp_utc: str, commit: str) -> str:
    compact = (
        timestamp_utc
        .replace("+00:00", "Z")
        .replace("-", "")
        .replace(":", "")
        .replace(".", "")
    )
    return f"scorecard-{compact}-{commit[:12]}"


def _check_weight(check: dict[str, Any]) -> float:
    value = float(check.get("weight", 1.0))
    return value if value >= 0 else 0.0


def _score_for_checks(checks: list[dict[str, Any]]) -> dict[str, Any]:
    total_weight = sum(_check_weight(check) for check in checks)
    passed_weight = sum(_check_weight(check) for check in checks if check["result"] == "pass")
    total_checks = len(checks)
    passed_checks = sum(1 for check in checks if check["result"] == "pass")
    score = passed_weight / total_weight if total_weight else 0.0
    return {
        "score": score,
        "passed_weight": passed_weight,
        "total_weight": total_weight,
        "passed_checks": passed_checks,
        "total_checks": total_checks,
    }


def _probe_contract(case: dict[str, Any]) -> dict[str, Any]:
    probe = case.get("probe") or {}
    return {
        "capture": [str(item) for item in probe.get("capture", [])],
        "snapshot_before_and_after": bool(probe.get("snapshot_before_and_after", False)),
        "snapshot_after": bool(probe.get("snapshot_after", False)),
        "before_trigger": probe.get("before_trigger"),
        "after_trigger": probe.get("after_trigger"),
        "actual_source": probe.get("actual_source"),
    }


def _case_score(input_item: ScorecardInput) -> dict[str, Any]:
    result = input_item.result.to_dict()
    checks = result["checks"]
    score_data = _score_for_checks(checks)
    preflight = input_item.case.get("preflight") or {}
    return {
        "case_id": input_item.result.case_id,
        "case_name": input_item.result.case_name,
        "skill": input_item.result.skill,
        "task": str(input_item.case.get("prompt", "")),
        "category": str(input_item.case.get("category", "uncategorized")),
        "probe_contract": _probe_contract(input_item.case),
        "source_context": {
            "source": str(preflight.get("source", "evaluation/cases")),
            "source_scenario_id": preflight.get("source_scenario_id"),
            "source_name": preflight.get("source_name"),
            "landmark": preflight.get("landmark"),
            "perspective": preflight.get("perspective"),
            "difficulty": preflight.get("difficulty"),
            "expected_behaviors": list(preflight.get("expected_behaviors", [])),
            "visual_expectations": str(preflight.get("visual_expectations", "")),
            "screenshot_mode": preflight.get("screenshot_mode"),
        },
        "result": input_item.result.result,
        "score": score_data["score"],
        "duration_ms": input_item.result.duration_ms,
        "error": input_item.result.error,
        "evidence_path": input_item.evidence_path,
        "evidence_summary": input_item.evidence_summary or {},
        "screenshots": list(input_item.screenshots),
        "checks": checks,
    }


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, tuple):
        return [str(item) for item in value]
    return [str(value)]


def _coerce_dimension_score(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, min(10.0, float(value)))
    except (TypeError, ValueError):
        return None


def _normalize_visual_dimensions(raw_review: dict[str, Any], status: str) -> dict[str, dict[str, Any]]:
    raw_dimensions = raw_review.get("dimensions")
    if not isinstance(raw_dimensions, dict):
        raw_dimensions = {}
    normalized: dict[str, dict[str, Any]] = {}
    default_status = "not_applicable" if status == "not_applicable" else "needs_review"

    # Iterate WHATEVER dimension keys are present so rubric-defined keys pass
    # through. When no dimensions are supplied, fall back to the legacy named
    # set so the emitted shape stays stable for v1.0-style items.
    keys: list[str] = [str(k) for k in raw_dimensions.keys()] or list(VISUAL_DIMENSION_KEYS)
    for key in keys:
        raw_item = raw_dimensions.get(key)
        if not isinstance(raw_item, dict):
            normalized[key] = {"status": default_status, "note": ""}
            continue
        dimension_status = str(raw_item.get("status", default_status))
        if dimension_status not in VISUAL_DIMENSION_STATUSES:
            dimension_status = "needs_review"
        entry: dict[str, Any] = {
            "status": dimension_status,
            "note": str(raw_item.get("note", "")).strip(),
        }
        dimension_score = _coerce_dimension_score(raw_item.get("score"))
        if dimension_score is not None:
            entry["score"] = dimension_score
        normalized[key] = entry
    return normalized


def _visual_review_lookup(visual_review: dict[str, Any] | None) -> dict[tuple[str, str], dict[str, Any]]:
    if not visual_review:
        return {}

    default_reviewer = str(visual_review.get("reviewer", "unassigned"))
    default_reviewed_at = visual_review.get("reviewed_at")
    lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for raw_item in visual_review.get("items", []):
        if not isinstance(raw_item, dict):
            continue
        skill = raw_item.get("skill")
        case_id = raw_item.get("case_id")
        if not skill or not case_id:
            continue
        item = dict(raw_item)
        item.setdefault("reviewer", default_reviewer)
        item.setdefault("reviewed_at", default_reviewed_at)
        lookup[(str(skill), str(case_id))] = item
    return lookup


def _normalize_visual_review(
    case: dict[str, Any],
    raw_review: dict[str, Any] | None,
    *,
    require_visual_review: bool,
) -> dict[str, Any]:
    raw_review = raw_review or {}
    status = str(raw_review.get("status", "not_reviewed"))
    if status not in VISUAL_REVIEW_STATUSES:
        status = "needs_review"

    required = bool(raw_review.get("required", require_visual_review))
    blocking = bool(raw_review.get("blocking", required))

    overall_score = _coerce_dimension_score(raw_review.get("overall_score"))

    score = raw_review.get("score")
    if score is not None:
        score = max(0.0, min(1.0, float(score)))
    elif overall_score is not None:
        # Legacy [0,1] 'score' absent: derive the deterministic scorecard score
        # from the new 0-10 overall_score (overall_score / 10).
        score = max(0.0, min(1.0, overall_score / 10.0))

    failure_flags = _string_list(raw_review.get("failure_flags"))
    judge = raw_review.get("judge")
    judge = judge if isinstance(judge, dict) else None

    screenshots = raw_review.get("screenshots")
    if screenshots is None:
        screenshots = case.get("screenshots", [])

    summary = str(raw_review.get("summary", "")).strip()
    if not summary:
        if status == "not_reviewed":
            summary = "No qualitative visual assessment has been recorded for this case."
        elif status == "not_applicable":
            summary = "This case does not require visual assessment."
        else:
            summary = "Visual assessment recorded without a summary."

    normalized: dict[str, Any] = {
        "status": status,
        "required": required,
        "blocking": blocking,
        "score": score,
        "reviewer": str(raw_review.get("reviewer", "unassigned")),
        "reviewed_at": raw_review.get("reviewed_at"),
        "summary": summary,
        "dimensions": _normalize_visual_dimensions(raw_review, status),
        "observations": _string_list(raw_review.get("observations")),
        "risks": _string_list(raw_review.get("risks")),
        "screenshots": _string_list(screenshots),
        "artifact_path": str(raw_review.get("artifact_path", "")),
    }
    # Additive qualitative fields: emit only when present so the deterministic
    # spine and legacy v1.0 consumers stay byte-compatible.
    if overall_score is not None:
        normalized["overall_score"] = overall_score
    if failure_flags:
        normalized["failure_flags"] = failure_flags
    if judge is not None:
        normalized["judge"] = judge
    return normalized


def _visual_summary(
    cases: list[dict[str, Any]],
    *,
    visual_review_supplied: bool,
) -> dict[str, Any]:
    status_counts = {status: 0 for status in sorted(VISUAL_REVIEW_STATUSES)}
    blocking_failures: list[dict[str, Any]] = []
    reviewed_count = 0
    required_count = 0

    for case in cases:
        review = case["visual_review"]
        status = review["status"]
        status_counts[status] += 1
        if status != "not_reviewed":
            reviewed_count += 1
        if review["required"]:
            required_count += 1
        if review["blocking"] and status in {"fail", "needs_review", "not_reviewed"}:
            blocking_failures.append(
                {
                    "case_id": case["case_id"],
                    "case_name": case["case_name"],
                    "skill": case["skill"],
                    "status": status,
                    "summary": review["summary"],
                    "artifact_path": review["artifact_path"],
                }
            )

    if not visual_review_supplied and required_count == 0:
        result = "not_required"
    elif blocking_failures:
        result = "fail"
    elif status_counts["fail"] or status_counts["needs_review"]:
        result = "needs_review"
    else:
        result = "pass"

    return {
        "result": result,
        "visual_review_supplied": visual_review_supplied,
        "required_count": required_count,
        "reviewed_count": reviewed_count,
        "total_cases": len(cases),
        "pass_count": status_counts["pass"],
        "fail_count": status_counts["fail"],
        "needs_review_count": status_counts["needs_review"],
        "not_reviewed_count": status_counts["not_reviewed"],
        "not_applicable_count": status_counts["not_applicable"],
        "blocking_failures": blocking_failures,
    }


def build_scorecard(
    inputs: list[ScorecardInput],
    *,
    threshold: float = DEFAULT_THRESHOLD,
    repo_root: Path | None = None,
    timestamp_utc: str | None = None,
    commit: str | None = None,
    artifacts: dict[str, Any] | None = None,
    visual_review: dict[str, Any] | None = None,
    require_visual_review: bool = False,
    harness: str | None = None,
    harness_judge: str | None = None,
    model: str | None = None,
    model_variant: str | None = None,
) -> dict[str, Any]:
    repo_root = repo_root or Path.cwd()
    timestamp_utc = timestamp_utc or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    commit = commit or git_commit(repo_root)

    visual_lookup = _visual_review_lookup(visual_review)
    cases = []
    for input_item in inputs:
        case = _case_score(input_item)
        case["visual_review"] = _normalize_visual_review(
            case,
            visual_lookup.get((case["skill"], case["case_id"])),
            require_visual_review=require_visual_review,
        )
        cases.append(case)

    checks = [check for case in cases for check in case["checks"]]
    overall = _score_for_checks(checks)
    visual_summary = _visual_summary(
        cases,
        visual_review_supplied=visual_review is not None,
    )

    categories: dict[str, list[dict[str, Any]]] = {}
    for check in checks:
        categories.setdefault(check["category"], []).append(check)
    category_scores = {
        category: _score_for_checks(category_checks)
        for category, category_checks in sorted(categories.items())
    }

    critical_failures = []
    for case in cases:
        for check in case["checks"]:
            if check["result"] == "fail" and check["critical"]:
                critical_failures.append(
                    {
                        "case_id": case["case_id"],
                        "case_name": case["case_name"],
                        "skill": case["skill"],
                        "task": case["task"],
                        "check_id": check["check_id"],
                        "category": check["category"],
                        "actual": check["actual"],
                        "expected": check["expected"],
                        "tolerance": check["tolerance"],
                        "evidence_path": case["evidence_path"],
                        "detail": check["detail"],
                    }
                )

    deterministic_result = "pass" if overall["score"] >= threshold and not critical_failures else "fail"
    visual_result = visual_summary["result"]
    overall_result = (
        "pass"
        if deterministic_result == "pass" and visual_result in {"pass", "not_required"}
        else "fail"
    )
    # The judge harness (which agent rendered the qualitative verdict) is stamped
    # under the open `artifacts` object so it is never conflated with the codegen
    # harness on the compare axis (the codegen harness is the real "tested with" id).
    artifacts_out = dict(artifacts or {})
    if harness_judge:
        artifacts_out.setdefault("harness_judge", harness_judge)
    # Codegen model provenance rides beside the judge harness under `artifacts`:
    # additive and optional, so historical scorecards stay schema-valid, and a
    # missing stamp reads as "not recorded" rather than defaulting silently.
    if model:
        artifacts_out.setdefault("model", model)
    if model_variant:
        artifacts_out.setdefault("model_variant", model_variant)

    result = {
        "schema_version": SCORECARD_SCHEMA_VERSION,
        "run_id": make_run_id(timestamp_utc, commit),
        "timestamp_utc": timestamp_utc,
        "git_commit": commit,
        "overall_result": overall_result,
        "deterministic_result": deterministic_result,
        "overall_score": overall["score"],
        "threshold": threshold,
        "category_scores": category_scores,
        "critical_failures": critical_failures,
        "visual_summary": visual_summary,
        "cases": cases,
        "artifacts": artifacts_out,
    }
    # Additive, optional: emit the codegen harness only when known so existing
    # callers (and the ~25 historical fieldless scorecards) stay schema-valid.
    if harness:
        result["harness"] = harness
    return result


def _markdown_value(value: Any, max_length: int = 160) -> str:
    if value is None:
        text = "null"
    elif isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, sort_keys=True)
    text = text.replace("\n", " ").replace("|", "\\|")
    return text if len(text) <= max_length else text[: max_length - 1] + "..."


def scorecard_to_markdown(scorecard: dict[str, Any]) -> str:
    lines = [
        "# Evaluation Scorecard",
        "",
        f"- Result: **{scorecard['overall_result'].upper()}**",
        f"- Deterministic result: **{scorecard.get('deterministic_result', scorecard['overall_result']).upper()}**",
        f"- Visual review result: **{scorecard.get('visual_summary', {}).get('result', 'not_required').upper()}**",
        f"- Overall score: {scorecard['overall_score']:.1%}",
        f"- Threshold: {scorecard['threshold']:.1%}",
        f"- Git commit: `{scorecard['git_commit']}`",
        f"- Run ID: `{scorecard['run_id']}`",
        "",
        "## Category Scores",
        "",
        "| Category | Score | Passed | Total |",
        "| --- | ---: | ---: | ---: |",
    ]
    for category, data in scorecard["category_scores"].items():
        lines.append(
            f"| {category} | {data['score']:.1%} | "
            f"{data['passed_checks']} | {data['total_checks']} |"
        )

    lines.extend(["", "## Critical Failures", ""])
    if scorecard["critical_failures"]:
        for failure in scorecard["critical_failures"]:
            lines.append(
                f"- `{failure['skill']}/{failure['case_id']}/{failure['check_id']}` "
                f"({failure['category']}): {failure['detail']} "
                f"Evidence: `{failure['evidence_path']}`; "
                f"actual={_markdown_value(failure['actual'])}; "
                f"expected={_markdown_value(failure['expected'])}; "
                f"tolerance={_markdown_value(failure['tolerance'])}"
            )
    else:
        lines.append("None.")

    visual_summary = scorecard.get("visual_summary", {})
    lines.extend(["", "## Qualitative Visual Review", ""])
    lines.append(f"- Result: **{visual_summary.get('result', 'not_required').upper()}**")
    lines.append(f"- Reviewed cases: {visual_summary.get('reviewed_count', 0)}/{visual_summary.get('total_cases', 0)}")
    lines.append(f"- Required cases: {visual_summary.get('required_count', 0)}")
    lines.append(f"- Blocking visual issues: {len(visual_summary.get('blocking_failures', []))}")
    if visual_summary.get("blocking_failures"):
        lines.append("")
        for failure in visual_summary["blocking_failures"]:
            lines.append(
                f"- `{failure['skill']}/{failure['case_id']}` "
                f"({failure['status']}): {failure['summary']}"
            )

    lines.extend(["", "## Cases", ""])
    for case in scorecard["cases"]:
        visual_review = case.get("visual_review", {})
        lines.append(f"### {case['skill']} / {case['case_id']} - {case['case_name']}")
        lines.append("")
        lines.append(f"- Result: **{case['result'].upper()}**")
        lines.append(f"- Score: {case['score']:.1%}")
        lines.append(f"- Visual review: **{visual_review.get('status', 'not_reviewed').upper()}**")
        lines.append(f"- Visual summary: {visual_review.get('summary', 'No visual review recorded.')}")
        source_context = case.get("source_context", {})
        evidence_summary = case.get("evidence_summary", {})
        if source_context:
            lines.append(f"- Expected source: `{source_context.get('source', 'evaluation/cases')}`")
            if source_context.get("source_scenario_id"):
                lines.append(f"- Source scenario: `{source_context['source_scenario_id']}` / `{source_context.get('source_name', '')}`")
        if evidence_summary:
            lines.append(f"- Actual source: `{evidence_summary.get('actual_source_path', '')}`")
            if evidence_summary.get("run_artifact_path"):
                lines.append(f"- Observed run artifact: `{evidence_summary['run_artifact_path']}`")
        lines.append(f"- Category: `{case['category']}`")
        lines.append(f"- Duration: {case['duration_ms']} ms")
        if case["error"] is not None:
            lines.append(f"- Error: `{case['error']}`")
        lines.append(f"- Evidence: `{case['evidence_path']}`")
        lines.append("")
        lines.append("| Check | Category | Critical | Result | Actual | Expected | Tolerance | Detail |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for check in case["checks"]:
            lines.append(
                f"| `{check['check_id']}` | {check['category']} | "
                f"{str(check['critical']).lower()} | {check['result']} | "
                f"{_markdown_value(check['actual'])} | "
                f"{_markdown_value(check['expected'])} | "
                f"{_markdown_value(check['tolerance'])} | "
                f"{_markdown_value(check['detail'])} |"
            )
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_scorecard(scorecard: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "scorecard.json"
    md_path = output_dir / "scorecard.md"
    json_path.write_text(json.dumps(scorecard, indent=2, sort_keys=True) + "\n")
    md_path.write_text(scorecard_to_markdown(scorecard))
    return json_path, md_path
