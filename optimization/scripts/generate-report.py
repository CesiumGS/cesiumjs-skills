#!/usr/bin/env python3
"""
Generate sanitized human-readable reports for skill evaluation iterations.

This script creates:
1. optimization/results/public-status.json - Current best skill version, last decision, per-scenario stats
2. optimization/results/<skill>/<iteration>/summary.md - Per-scenario verdict, check status, curated screenshots

All outputs are validated against check-public-artifacts.py before writing.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def compute_scores(
    check_results: list[dict[str, Any]],
    judge_results: list[dict[str, Any]],
    scenarios: list[dict[str, Any]],
) -> dict[str, float]:
    """
    Compute report scores from evaluation results.

    Returns:
        Dictionary with:
        - programmatic_correctness: % of scenarios passing all programmatic checks
        - api_accuracy: % of scenarios with all api_present checks passing
        - visual_win_rate: % of judged scenarios where candidate won
        - coverage_delta: reserved for future coverage analysis (US-013)
    """
    # Programmatic correctness: % scenarios passing all checks
    passing_scenarios = 0
    for result in check_results:
        checks = result.get("checks", [])
        if checks and all(c.get("result") == "pass" for c in checks):
            passing_scenarios += 1
    programmatic_correctness = passing_scenarios / len(check_results) if check_results else 0.0

    # API accuracy: % scenarios with all api_present checks passing
    api_check_scenarios = 0
    api_passing_scenarios = 0
    for result in check_results:
        checks = result.get("checks", [])
        api_checks = [c for c in checks if c.get("type") == "api_present"]
        if api_checks:
            api_check_scenarios += 1
            if all(c.get("result") == "pass" for c in api_checks):
                api_passing_scenarios += 1
    api_accuracy = api_passing_scenarios / api_check_scenarios if api_check_scenarios > 0 else 1.0

    # Visual win rate: % of judged scenarios where candidate won
    judged_scenarios = [j for j in judge_results if not j.get("judge_unavailable", False)]
    wins = sum(1 for j in judged_scenarios if j.get("verdict") == "CANDIDATE")
    visual_win_rate = wins / len(judged_scenarios) if judged_scenarios else 0.0

    # Coverage delta: reserved for US-013
    coverage_delta = 0.0

    return {
        "programmatic_correctness": round(programmatic_correctness, 4),
        "api_accuracy": round(api_accuracy, 4),
        "visual_win_rate": round(visual_win_rate, 4),
        "coverage_delta": coverage_delta,
    }


def count_wins_losses_ties(judge_results: list[dict[str, Any]]) -> dict[str, int]:
    """Count wins, losses, and ties from judge results."""
    wins = 0
    losses = 0
    ties = 0

    for result in judge_results:
        if result.get("judge_unavailable", False):
            continue
        verdict = result.get("verdict")
        if verdict == "CANDIDATE":
            wins += 1
        elif verdict == "BASELINE":
            losses += 1
        elif verdict == "TIE":
            ties += 1

    return {"wins": wins, "losses": losses, "ties": ties}


def format_check_result(check: dict[str, Any]) -> str:
    """Format a single check result for markdown."""
    result = check.get("result", "unknown")
    symbol = "✓" if result == "pass" else "✗"
    check_type = check.get("type", "unknown")
    description = check.get("description", "")
    return f"{symbol} {check_type}: {description}"


def generate_summary_md(
    skill: str,
    iteration: str,
    decision_result: dict[str, Any],
    check_results: list[dict[str, Any]],
    judge_results: list[dict[str, Any]],
    scenarios: list[dict[str, Any]],
    scores: dict[str, float],
    output_path: Path,
) -> None:
    """
    Generate summary.md for a specific iteration.

    Args:
        skill: Skill name (e.g., 'cesiumjs-camera')
        iteration: Iteration number (e.g., '001')
        decision_result: Decision engine output
        check_results: List of programmatic check results per scenario
        judge_results: List of judge verdict results per scenario
        scenarios: List of scenario manifests
        scores: Computed scores
        output_path: Path to write summary.md
    """
    lines = [
        f"# Evaluation Report: {skill} - Iteration {iteration}",
        "",
        f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "",
        "## Decision",
        "",
        f"- **Result:** {decision_result['decision']}",
        f"- **Rule:** {decision_result['rule_fired']}",
        f"- **Rationale:** {decision_result['rationale']}",
        "",
        "## Score Summary",
        "",
        f"- **Programmatic Correctness:** {scores['programmatic_correctness']:.1%}",
        f"- **API Accuracy:** {scores['api_accuracy']:.1%}",
        f"- **Visual Win Rate:** {scores['visual_win_rate']:.1%}",
        f"- **Coverage Delta:** {scores['coverage_delta']:.1%} (reserved for US-013)",
        "",
        "## Win/Loss/Tie Counts",
        "",
        f"- Wins: {decision_result['counts']['wins']}",
        f"- Losses: {decision_result['counts']['losses']}",
        f"- Ties: {decision_result['counts']['ties']}",
        "",
    ]

    # Add rebaseline warnings if any
    if decision_result.get("rebaseline_required"):
        lines.extend([
            "## Rebaseline Required",
            "",
            "The following scenarios have changed and need re-baseline:",
            "",
        ])
        for scenario_id in decision_result["rebaseline_required"]:
            lines.append(f"- {scenario_id}")
        lines.append("")

    # Per-scenario details
    lines.extend([
        "## Per-Scenario Results",
        "",
    ])

    # Create lookup maps
    check_map = {r["scenario_id"]: r for r in check_results}
    judge_map = {r["scenario_id"]: r for r in judge_results}
    scenario_map = {s["id"]: s for s in scenarios}

    for scenario in scenarios:
        scenario_id = scenario["id"]
        scenario_name = scenario.get("name", scenario_id)

        lines.extend([
            f"### {scenario_id}: {scenario_name}",
            "",
        ])

        # Programmatic checks
        if scenario_id in check_map:
            check_result = check_map[scenario_id]
            lines.append("**Programmatic Checks:**")
            lines.append("")
            for check in check_result.get("checks", []):
                lines.append(f"- {format_check_result(check)}")
            lines.append("")

        # Judge verdict
        if scenario_id in judge_map:
            judge_result = judge_map[scenario_id]
            if judge_result.get("judge_unavailable"):
                lines.append("**Judge Verdict:** Unavailable")
            else:
                verdict = judge_result.get("verdict", "UNKNOWN")
                majority_count = judge_result.get("majority_count", 0)
                lines.append(f"**Judge Verdict:** {verdict} ({majority_count}/3 judges)")
            lines.append("")

        # Screenshot reference (relative path only for public safety)
        # Format: optimization/runs/<skill>/<iteration>/<eval-id>-<name>/screenshot.png
        run_dir = f"optimization/runs/{skill}/{iteration}/{scenario_id}-{scenario_name}"
        lines.extend([
            "**Evidence:**",
            "",
            f"- Screenshot(s): `{run_dir}/screenshot*.png`",
            f"- Console log: `{run_dir}/console.json`",
            f"- Metadata: `{run_dir}/metadata.json`",
            "",
            "---",
            "",
        ])

    # Write to file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines))


def update_public_status(
    skill: str,
    iteration: str,
    decision_result: dict[str, Any],
    scores: dict[str, float],
    scenarios: list[dict[str, Any]],
    public_status_path: Path,
) -> None:
    """
    Update optimization/results/public-status.json with the latest iteration results.

    Args:
        skill: Skill name
        iteration: Iteration number
        decision_result: Decision engine output
        scores: Computed scores
        scenarios: List of scenario manifests
        public_status_path: Path to public-status.json
    """
    # Load existing public status or create new
    if public_status_path.exists():
        with public_status_path.open() as f:
            public_status = json.load(f)
    else:
        public_status = {
            "schema_version": "1.0",
            "summary_type": "public-sanitized-eval-status",
            "skills": []
        }

    # Find or create skill entry
    skill_entry = None
    for entry in public_status["skills"]:
        if entry["skill"] == skill:
            skill_entry = entry
            break

    if skill_entry is None:
        skill_entry = {
            "skill": skill,
            "scenario_count": len(scenarios),
            "current_best": {},
            "latest_reviewed_decision": {},
            "runner_mode_counts": {}
        }
        public_status["skills"].append(skill_entry)

    # Update scenario count
    skill_entry["scenario_count"] = len(scenarios)

    # Update latest decision
    counts = decision_result["counts"]
    skill_entry["latest_reviewed_decision"] = {
        "iteration": iteration,
        "status": "keep" if decision_result["decision"] == "KEEP" else "reject",
        "compared_to": "baseline",  # This would be dynamic in full implementation
        "methodology": "3-parallel-independent-judges, majority vote per eval",
        "tally": {
            "wins": counts["wins"],
            "losses": counts["losses"],
            "ties": counts["ties"]
        },
        "critical_regressions": [],  # Would be computed from decision_result
        "rationale_summary": decision_result["rationale"]
    }

    # Update current_best if KEEP decision
    if decision_result["decision"] == "KEEP":
        skill_entry["current_best"] = {
            "iteration": iteration,
            "wins": counts["wins"],
            "losses": counts["losses"],
            "ties": counts["ties"],
            "programmatic_correctness": scores["programmatic_correctness"],
            "api_accuracy": scores["api_accuracy"],
            "visual_win_rate": scores["visual_win_rate"],
            "methodology": "3-parallel-independent-judges",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    elif skill_entry.get("current_best", {}).get("iteration") == iteration:
        # If an iteration is reclassified or regenerated as REJECT, do not
        # leave a stale current_best pointer to that same rejected iteration.
        skill_entry["current_best"] = {}

    # Update runner mode counts (scan scenarios for runner_mode field)
    runner_modes: dict[str, int] = {}
    for scenario in scenarios:
        mode = scenario.get("runner_mode", "global-js")
        runner_modes[mode] = runner_modes.get(mode, 0) + 1
    skill_entry["runner_mode_counts"] = runner_modes

    # Write back to file
    public_status_path.parent.mkdir(parents=True, exist_ok=True)
    with public_status_path.open("w") as f:
        json.dump(public_status, f, indent=2)
        f.write("\n")


def validate_public_safety(file_path: Path) -> bool:
    """
    Run optimization/scripts/check-public-artifacts.py on a file to ensure it's public-safe.

    Returns:
        True if file passes, False if it fails validation
    """
    try:
        result = subprocess.run(
            ["python3", "optimization/scripts/check-public-artifacts.py", str(file_path)],
            capture_output=True,
            text=True,
            check=False
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Warning: Could not run public-artifacts validation: {e}", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate sanitized human-readable reports for skill evaluation iterations"
    )
    parser.add_argument("skill", help="Skill name (e.g., cesiumjs-camera)")
    parser.add_argument("iteration", help="Iteration number (e.g., 001)")
    parser.add_argument("--decision", required=True, help="Path to decision.json")
    parser.add_argument("--check-results", required=True, help="Path to check-results.json (list of per-scenario check results)")
    parser.add_argument("--judge-results", required=True, help="Path to judge-results.json (list of per-scenario judge verdicts)")
    parser.add_argument("--scenarios", required=True, help="Path to scenarios directory")
    parser.add_argument("--public-status", default="optimization/results/public-status.json", help="Path to public-status.json")
    parser.add_argument("--output-dir", help="Output directory for summary.md (default: optimization/results/<skill>/<iteration>)")

    args = parser.parse_args()

    # Load inputs
    decision_path = Path(args.decision)
    check_results_path = Path(args.check_results)
    judge_results_path = Path(args.judge_results)
    scenarios_dir = Path(args.scenarios)
    public_status_path = Path(args.public_status)

    if not decision_path.exists():
        print(f"Error: Decision file not found: {decision_path}", file=sys.stderr)
        return 1

    if not check_results_path.exists():
        print(f"Error: Check results file not found: {check_results_path}", file=sys.stderr)
        return 1

    if not judge_results_path.exists():
        print(f"Error: Judge results file not found: {judge_results_path}", file=sys.stderr)
        return 1

    if not scenarios_dir.exists():
        print(f"Error: Scenarios directory not found: {scenarios_dir}", file=sys.stderr)
        return 1

    # Load decision result
    with decision_path.open() as f:
        decision_result = json.load(f)

    # Load check results
    with check_results_path.open() as f:
        check_results = json.load(f)

    # Load judge results
    with judge_results_path.open() as f:
        judge_results = json.load(f)

    # Load scenarios
    scenarios = []
    for scenario_file in sorted(scenarios_dir.glob("*.json")):
        with scenario_file.open() as f:
            scenarios.append(json.load(f))

    # Compute scores
    scores = compute_scores(check_results, judge_results, scenarios)

    # Determine output directory
    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = Path("optimization/results") / args.skill / args.iteration

    summary_path = output_dir / "summary.md"

    # Generate summary.md
    generate_summary_md(
        args.skill,
        args.iteration,
        decision_result,
        check_results,
        judge_results,
        scenarios,
        scores,
        summary_path
    )

    print(f"Generated summary report: {summary_path}")

    # Validate summary.md before continuing
    if not validate_public_safety(summary_path):
        print(f"Error: Summary file failed public-artifacts validation: {summary_path}", file=sys.stderr)
        summary_path.unlink()  # Remove invalid file
        return 1

    # Update public-status.json
    update_public_status(
        args.skill,
        args.iteration,
        decision_result,
        scores,
        scenarios,
        public_status_path
    )

    print(f"Updated public status: {public_status_path}")

    # Validate public-status.json before continuing
    if not validate_public_safety(public_status_path):
        print(f"Error: Public status file failed public-artifacts validation: {public_status_path}", file=sys.stderr)
        return 1

    print(f"\nScores:")
    print(f"  Programmatic Correctness: {scores['programmatic_correctness']:.1%}")
    print(f"  API Accuracy: {scores['api_accuracy']:.1%}")
    print(f"  Visual Win Rate: {scores['visual_win_rate']:.1%}")
    print(f"  Coverage Delta: {scores['coverage_delta']:.1%}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
