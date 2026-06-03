"""Convert deterministic scorecards into optimization focus hints.

This module intentionally lives under `optimization/`: evaluation produces
scorecards, and local optimization may consume them. The dependency direction
does not go the other way.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import json
from typing import Any


def _failed_checks(case: dict[str, Any]) -> list[dict[str, Any]]:
    return [check for check in case.get("checks", []) if check.get("result") == "fail"]


def _category_failures(scorecard: dict[str, Any]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for case in scorecard.get("cases", []):
        for check in _failed_checks(case):
            counts[str(check.get("category", "uncategorized"))] += 1
    return counts


def _critical_counts(scorecard: dict[str, Any]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for failure in scorecard.get("critical_failures", []):
        counts[str(failure.get("category", "uncategorized"))] += 1
    return counts


def build_focus(scorecard: dict[str, Any]) -> dict[str, Any]:
    threshold = float(scorecard.get("threshold", 0.95))
    category_failures = _category_failures(scorecard)
    critical_counts = _critical_counts(scorecard)
    category_scores = scorecard.get("category_scores", {})

    categories = []
    for category, data in sorted(category_scores.items()):
        score = float(data.get("score", 0.0))
        failed_checks = category_failures[category]
        critical_failures = critical_counts[category]
        if score >= threshold and failed_checks == 0 and critical_failures == 0:
            continue
        categories.append(
            {
                "category": category,
                "score": score,
                "threshold": threshold,
                "failed_checks": failed_checks,
                "critical_failures": critical_failures,
                "priority": critical_failures * 100 + failed_checks * 10 + max(0.0, threshold - score),
            }
        )
    categories.sort(key=lambda item: (-item["priority"], item["category"]))

    cases = []
    skills: Counter[str] = Counter()
    for case in scorecard.get("cases", []):
        failed = _failed_checks(case)
        if not failed:
            continue
        skill = str(case.get("skill", ""))
        skills[skill] += len(failed)
        cases.append(
            {
                "skill": skill,
                "case_id": case.get("case_id", ""),
                "case_name": case.get("case_name", ""),
                "task": case.get("task", ""),
                "evidence_path": case.get("evidence_path", ""),
                "score": case.get("score", 0.0),
                "failed_checks": [
                    {
                        "check_id": check.get("check_id", ""),
                        "type": check.get("type", ""),
                        "category": check.get("category", "uncategorized"),
                        "critical": bool(check.get("critical", False)),
                        "actual": check.get("actual"),
                        "expected": check.get("expected"),
                        "tolerance": check.get("tolerance"),
                        "detail": check.get("detail", ""),
                    }
                    for check in failed
                ],
            }
        )
    cases.sort(key=lambda item: (-sum(1 for check in item["failed_checks"] if check["critical"]), item["skill"], item["case_id"]))

    category_to_cases: dict[str, set[str]] = defaultdict(set)
    for case in cases:
        for check in case["failed_checks"]:
            category_to_cases[check["category"]].add(f"{case['skill']}/{case['case_id']}")

    return {
        "schema_version": "1.0",
        "source_run_id": scorecard.get("run_id", ""),
        "source_git_commit": scorecard.get("git_commit", ""),
        "source_result": scorecard.get("overall_result", ""),
        "source_score": scorecard.get("overall_score", 0.0),
        "threshold": threshold,
        "focus_required": bool(categories or cases),
        "categories": [
            {
                **category,
                "affected_cases": sorted(category_to_cases.get(category["category"], set())),
            }
            for category in categories
        ],
        "skills": [
            {"skill": skill, "failed_checks": failed_checks}
            for skill, failed_checks in sorted(skills.items(), key=lambda item: (-item[1], item[0]))
        ],
        "cases": cases,
    }


def _markdown_value(value: Any, max_length: int = 140) -> str:
    if value is None:
        text = "null"
    elif isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, sort_keys=True)
    text = text.replace("\n", " ").replace("|", "\\|")
    return text if len(text) <= max_length else text[: max_length - 1] + "..."


def focus_to_markdown(focus: dict[str, Any]) -> str:
    lines = [
        "# Optimization Focus From Scorecard",
        "",
        f"- Source run: `{focus['source_run_id']}`",
        f"- Source result: **{str(focus['source_result']).upper()}**",
        f"- Source score: {float(focus['source_score']):.1%}",
        f"- Threshold: {float(focus['threshold']):.1%}",
        "",
    ]
    if not focus["focus_required"]:
        lines.append("No optimization focus is required from this scorecard.")
        return "\n".join(lines).rstrip() + "\n"

    lines.extend(["## Categories", "", "| Category | Score | Failed Checks | Critical Failures | Affected Cases |"])
    lines.append("| --- | ---: | ---: | ---: | --- |")
    for category in focus["categories"]:
        lines.append(
            f"| {category['category']} | {category['score']:.1%} | "
            f"{category['failed_checks']} | {category['critical_failures']} | "
            f"{', '.join(category['affected_cases'])} |"
        )

    lines.extend(["", "## Cases", ""])
    for case in focus["cases"]:
        lines.append(f"### {case['skill']} / {case['case_id']} - {case['case_name']}")
        lines.append(f"- Score: {float(case['score']):.1%}")
        lines.append(f"- Evidence: `{case['evidence_path']}`")
        for check in case["failed_checks"]:
            lines.append(
                f"- `{check['check_id']}` ({check['category']}): {check['detail']}; "
                f"actual={_markdown_value(check['actual'])}; "
                f"expected={_markdown_value(check['expected'])}; "
                f"tolerance={_markdown_value(check['tolerance'])}"
            )
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def focus_to_decision(focus: dict[str, Any], *, skill: str | None = None) -> dict[str, Any]:
    """Create a proposer-compatible decision record from scorecard focus.

    The legacy proposer already knows how to consume a decision record as its
    strongest recent signal. This keeps the bridge local to optimization while
    allowing deterministic scorecard failures to seed a targeted proposal pass.
    """
    cases = [
        case
        for case in focus.get("cases", [])
        if skill is None or case.get("skill") == skill
    ]
    categories = []
    for category in focus.get("categories", []):
        affected = [
            case_id
            for case_id in category.get("affected_cases", [])
            if skill is None or str(case_id).startswith(f"{skill}/")
        ]
        if affected or skill is None:
            categories.append({**category, "affected_cases": affected})

    failed_checks = sum(len(case.get("failed_checks", [])) for case in cases)
    critical_failures = sum(
        1
        for case in cases
        for check in case.get("failed_checks", [])
        if check.get("critical")
    )
    category_summary = ", ".join(
        f"{category['category']} {float(category['score']):.1%}"
        for category in categories[:5]
    ) or "no failing categories"
    case_lines = []
    for case in cases[:8]:
        check_summaries = "; ".join(
            f"{check['check_id']}: {check['detail']}"
            for check in case.get("failed_checks", [])[:3]
        )
        case_lines.append(
            f"- {case['skill']}/{case['case_id']} {case['case_name']}: {check_summaries}"
        )
    rationale = (
        "Deterministic scorecard focus should guide the next local optimization. "
        f"Source result={focus.get('source_result')} score={float(focus.get('source_score', 0.0)):.1%} "
        f"threshold={float(focus.get('threshold', 0.95)):.1%}. "
        f"Failing categories: {category_summary}. "
        "Failed checks:\n" + ("\n".join(case_lines) if case_lines else "- none")
    )

    return {
        "decision": "SCORECARD_FOCUS" if cases else "SCORECARD_CLEAN",
        "rule_fired": "scorecard_critical_failure_focus" if critical_failures else "scorecard_threshold_focus",
        "rationale": rationale,
        "counts": {
            "wins": 0,
            "losses": failed_checks,
            "ties": 0,
        },
        "scorecard_focus": {
            "source_run_id": focus.get("source_run_id", ""),
            "source_git_commit": focus.get("source_git_commit", ""),
            "source_result": focus.get("source_result", ""),
            "source_score": focus.get("source_score", 0.0),
            "threshold": focus.get("threshold", 0.95),
            "skill": skill,
            "failed_checks": failed_checks,
            "critical_failures": critical_failures,
            "categories": categories,
            "cases": cases,
        },
    }
