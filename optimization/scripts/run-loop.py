#!/usr/bin/env python3
"""
Autonomous iteration loop for skill evaluation and optimization.

This script runs the complete evaluation pipeline in a loop until a stopping
condition is met. Before the loop, it ensures the current best skill has
baseline browser evidence under optimization/runs/<skill>/baseline. Each iteration:
1. Proposes a candidate skill revision
2. Generates code for all scenarios using the skills adapter
3. Runs browser evaluation for all scenarios
4. Runs deterministic checks
5. Runs three-judge visual comparison
6. Makes autonomous KEEP/REJECT decision
7. Generates report
8. Archives iteration to history

The loop is fully autonomous with no interactive pauses or confirmation gates.

Stopping conditions:
- max-iterations: Stop after N iterations
- plateau: Stop after M consecutive TIE decisions (no improvement)
- regression: Stop immediately on first REJECT
- SIGINT: Stop gracefully on Ctrl+C

Requires the `claude` CLI on PATH (handles auth itself) and CESIUM_ION_TOKEN
for the browser runner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

# Flag for graceful SIGINT handling
_stop_requested = False


def signal_handler(sig, frame):
    """Handle SIGINT (Ctrl+C) gracefully."""
    global _stop_requested
    print("\n[!] SIGINT received. Stopping after current step...", file=sys.stderr)
    _stop_requested = True


# Redaction patterns for secrets that leak into tracked journals/history.
# Subprocess tracebacks captured into result dicts (e.g. "Proposer failed: <stderr>")
# routinely embed the developer's home-directory paths and local dev-server URLs.
# Because _json_safe() serializes those result dicts verbatim into tracked
# optimization/results/.../journal.jsonl and optimization/history/..., we scrub
# every persisted string here at the single serialization choke point.
#   - User-home paths: /Users/<name>/, /home/<name>/, C:\Users\<name>\
#   - Local dev URLs:  http(s)://localhost:<port> and http(s)://127.0.0.1:<port>
_HOME_PATH_RE = re.compile(r"(?:/Users/|/home/|C:\\Users\\)[^/\\\s:'\"]+[/\\]")
_LOCAL_URL_RE = re.compile(r"https?://(?:localhost|127\.0\.0\.1)(?::\d+)?")


def _redact_secrets(text: str) -> str:
    """Scrub user-home paths and localhost URLs from a persisted string."""
    # Order: redact local URLs first so the host segment can't be misread as a
    # path fragment, then collapse any user-home path prefixes.
    text = _LOCAL_URL_RE.sub("<redacted-local-url>", text)
    text = _HOME_PATH_RE.sub("<redacted-path>/", text)
    return text


def _json_safe(value: Any) -> Any:
    """Convert common runtime values to JSON-safe structures for journals."""
    if isinstance(value, Path):
        # Paths are real filesystem locations — redact before persisting.
        return _redact_secrets(str(value))
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, str):
        # Redact every persisted string (e.g. subprocess tracebacks) so local
        # paths and dev-server URLs never reach tracked journals/history.
        return _redact_secrets(value)
    return value


def write_journal_event(journal_path: Path, event: str, **fields: Any) -> None:
    """Append a structured event to the per-iteration journal."""
    journal_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event": event,
        **{key: _json_safe(value) for key, value in fields.items()},
    }
    with journal_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def scenario_content_hash(scenario: dict[str, Any]) -> str:
    """Hash a scenario manifest the same way validate-evals.py does."""
    content = json.dumps(scenario, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def get_current_best_skill(skill: str) -> Path:
    """
    Get the path to the current best skill file.

    Returns:
        Path to skills/<skill>/SKILL.md (the current best)
    """
    skill_path = Path(f"skills/{skill}/SKILL.md")
    if not skill_path.exists():
        raise FileNotFoundError(f"Skill file not found: {skill_path}")
    return skill_path


def get_next_iteration(skill: str) -> str:
    """
    Determine the next iteration number by finding existing candidates.

    Returns:
        Iteration string in format 'NNN' (e.g., '001', '002')
    """
    candidates_dir = Path(f"optimization/candidates/{skill}")
    if not candidates_dir.exists():
        return "001"

    # Find all iteration directories
    existing = []
    for item in candidates_dir.iterdir():
        if item.is_dir() and item.name.isdigit():
            existing.append(int(item.name))

    if not existing:
        return "001"

    next_num = max(existing) + 1
    return f"{next_num:03d}"


def run_proposer(skill: str, iteration: str, args: argparse.Namespace) -> dict[str, Any]:
    """
    Run the proposer to generate a candidate skill revision.

    Returns:
        Dict with 'success': bool, 'candidate_path': Path | None, 'error': str | None
    """
    print(f"\n=== Iteration {iteration}: Proposer ===")

    cmd = [
        "python3", "optimization/scripts/propose-candidate.py",
        skill,
        "--iteration", iteration,
        "--max-history", str(args.proposer_history),
        "--model-id", args.proposer_model,
        "--temperature", str(args.proposer_temperature),
    ]
    proposer_decision_path = getattr(args, "proposer_decision_path", None)
    if proposer_decision_path:
        cmd.extend(["--decision-path", str(proposer_decision_path)])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(result.stdout)

        # Proposer outputs to optimization/candidates/<skill>/<iteration>/SKILL.md
        candidate_path = Path(f"optimization/candidates/{skill}/{iteration}/SKILL.md")
        if not candidate_path.exists():
            return {
                "success": False,
                "candidate_path": None,
                "error": f"Proposer did not create expected candidate file: {candidate_path}"
            }

        return {"success": True, "candidate_path": candidate_path, "error": None}

    except subprocess.CalledProcessError as e:
        error_msg = f"Proposer failed: {e.stderr}"
        print(error_msg, file=sys.stderr)
        return {"success": False, "candidate_path": None, "error": error_msg}


def run_skills_adapter(skill: str, iteration: str, candidate_path: Path, args: argparse.Namespace) -> dict[str, Any]:
    """
    Run skills adapter to generate JavaScript code for all scenarios.

    This directly invokes the SkillsAdapter for each scenario instead of using
    a CLI wrapper (since no standalone CLI exists for the adapter).

    Returns:
        Dict with 'success': bool, 'generated_count': int, 'error': str | None
    """
    print(f"\n=== Iteration {iteration}: Skills Adapter ===")

    # Import the adapter
    try:
        from optimization.framework.adapters.skills_adapter import SkillsAdapter
    except ImportError as e:
        return {"success": False, "generated_count": 0, "error": f"Failed to import SkillsAdapter: {e}"}

    # Load all scenarios for this skill
    scenarios_dir = Path(f"optimization/scenarios/{skill}")
    if not scenarios_dir.exists():
        return {"success": False, "generated_count": 0, "error": f"Scenarios directory not found: {scenarios_dir}"}

    scenario_files = sorted(scenarios_dir.glob("eval-*.json"))
    if not scenario_files:
        return {"success": False, "generated_count": 0, "error": f"No scenarios found in {scenarios_dir}"}

    # Initialize adapter. Iteration is kept as the zero-padded string from
    # get_next_iteration so the generated-code directory matches the runner's
    # expected layout (optimization/generated/<skill>/<iter>/).
    try:
        adapter = SkillsAdapter(
            skill=skill,
            iteration=iteration,
            model_id=args.eval_model,
            temperature=args.eval_temperature
        )
    except Exception as e:
        return {"success": False, "generated_count": 0, "error": f"Failed to initialize adapter: {e}"}

    # Generate code for each scenario
    generated_count = 0
    for scenario_file in scenario_files:
        try:
            scenario = json.loads(scenario_file.read_text())
            candidate = {"skill_path": str(candidate_path)}

            # Run adapter workflow
            adapter.prepare(scenario, candidate)
            adapter.invoke()
            output_path, metadata = adapter.collect_output()

            print(f"  ✓ Generated {scenario['id']}: {output_path}")
            generated_count += 1

        except Exception as e:
            print(f"  ✗ Failed to generate {scenario_file.name}: {e}", file=sys.stderr)
            # Continue with other scenarios instead of failing completely

    if generated_count == 0:
        return {"success": False, "generated_count": 0, "error": "No scenarios were successfully generated"}

    print(f"Generated code for {generated_count}/{len(scenario_files)} scenarios")
    return {"success": True, "generated_count": generated_count, "error": None}


def run_browser_eval(skill: str, iteration: str, args: argparse.Namespace) -> dict[str, Any]:
    """
    Run browser-backed evaluation for all scenarios.

    Returns:
        Dict with 'success': bool, 'runs_dir': Path | None, 'error': str | None
    """
    print(f"\n=== Iteration {iteration}: Browser Runner ===")

    generated_dir = Path(f"optimization/generated/{skill}/{iteration}")
    if not generated_dir.exists():
        return {"success": False, "runs_dir": None, "error": f"Generated code directory not found: {generated_dir}"}

    cmd = [
        "python3", "optimization/scripts/run-public-eval.py",
        skill,
        "--iteration", iteration,
        "--generated-dir", str(generated_dir),
        "--output-dir", f"optimization/runs/{skill}/{iteration}",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(result.stdout)

        runs_dir = Path(f"optimization/runs/{skill}/{iteration}")
        if not runs_dir.exists():
            return {"success": False, "runs_dir": None, "error": f"Runner did not create expected output directory: {runs_dir}"}

        return {"success": True, "runs_dir": runs_dir, "error": None}

    except subprocess.CalledProcessError as e:
        error_msg = f"Browser runner failed: {e.stderr}"
        print(error_msg, file=sys.stderr)
        return {"success": False, "runs_dir": None, "error": error_msg}


def expected_bundle_count(skill: str) -> int:
    """Count runnable scenarios for a skill."""
    scenarios_dir = Path(f"optimization/scenarios/{skill}")
    if not scenarios_dir.exists():
        return 0
    count = 0
    for scenario_file in sorted(scenarios_dir.glob("eval-*.json")):
        scenario = json.loads(scenario_file.read_text())
        if scenario.get("runner_mode", "global-js") != "review-only":
            count += 1
    return count


def evidence_dir_complete(runs_dir: Path, expected_count: int) -> bool:
    """Return True when a run directory has a complete evidence bundle set."""
    if expected_count == 0 or not runs_dir.exists():
        return False
    bundles = [item for item in runs_dir.iterdir() if item.is_dir()]
    complete = 0
    for bundle in bundles:
        has_screenshot = any(bundle.glob("screenshot*.png"))
        required = [
            bundle / "console.json",
            bundle / "programmatic-checks.json",
            bundle / "scene-state.json",
            bundle / "metadata.json",
            bundle / "screenshot-quality.json",
        ]
        if has_screenshot and all(path.exists() for path in required):
            complete += 1
    return complete >= expected_count


def ensure_current_best_baseline(skill: str, current_best: Path, args: argparse.Namespace) -> dict[str, Any]:
    """Ensure the current best skill has browser evidence to judge against."""
    print("\n=== Current Best Baseline ===")
    baseline_runs_dir = Path(f"optimization/runs/{skill}/baseline")
    expected_count = expected_bundle_count(skill)
    journal_path = Path(f"optimization/results/{skill}/baseline/journal.jsonl")

    write_journal_event(
        journal_path,
        "baseline_check_started",
        skill=skill,
        iteration="baseline",
        current_best=current_best,
        expected_bundle_count=expected_count,
    )

    if evidence_dir_complete(baseline_runs_dir, expected_count):
        print(f"  Existing baseline evidence is complete: {baseline_runs_dir}")
        write_journal_event(
            journal_path,
            "baseline_check_completed",
            skill=skill,
            iteration="baseline",
            runs_dir=baseline_runs_dir,
            reused=True,
        )
        return {"success": True, "runs_dir": baseline_runs_dir, "reused": True, "error": None}

    print("  Baseline evidence missing or incomplete; generating current-best baseline.")
    write_journal_event(
        journal_path,
        "baseline_generation_started",
        skill=skill,
        iteration="baseline",
        current_best=current_best,
    )
    adapter_result = run_skills_adapter(skill, "baseline", current_best, args)
    if not adapter_result["success"]:
        write_journal_event(
            journal_path,
            "baseline_generation_failed",
            skill=skill,
            iteration="baseline",
            result=adapter_result,
        )
        return {"success": False, "runs_dir": None, "reused": False, "error": adapter_result["error"]}
    write_journal_event(
        journal_path,
        "baseline_generation_completed",
        skill=skill,
        iteration="baseline",
        result=adapter_result,
    )

    write_journal_event(
        journal_path,
        "baseline_browser_eval_started",
        skill=skill,
        iteration="baseline",
    )
    runner_result = run_browser_eval(skill, "baseline", args)
    if not runner_result["success"]:
        write_journal_event(
            journal_path,
            "baseline_browser_eval_failed",
            skill=skill,
            iteration="baseline",
            result=runner_result,
        )
        return {"success": False, "runs_dir": None, "reused": False, "error": runner_result["error"]}

    write_journal_event(
        journal_path,
        "baseline_browser_eval_completed",
        skill=skill,
        iteration="baseline",
        result=runner_result,
    )
    return {"success": True, "runs_dir": runner_result["runs_dir"], "reused": False, "error": None}


def run_judges(skill: str, iteration: str, runs_dir: Path, args: argparse.Namespace) -> dict[str, Any]:
    """
    Run three-judge panel for all scenarios.

    Returns:
        Dict with 'success': bool, 'judge_results': list | None, 'error': str | None
    """
    print(f"\n=== Iteration {iteration}: Three-Judge Panel ===")

    # Import judge panel
    try:
        from optimization.framework.judges.panel import judge_panel, write_judge_verdicts
    except ImportError as e:
        return {"success": False, "judge_results": None, "error": f"Failed to import judge_panel: {e}"}

    # Load scenarios
    scenarios_dir = Path(f"optimization/scenarios/{skill}")
    scenario_files = sorted(scenarios_dir.glob("eval-*.json"))

    # Determine baseline directory (previous iteration or current best)
    baseline_dir = get_baseline_dir(skill, iteration)
    if baseline_dir is None:
        print("  No baseline found - this is the first iteration. Skipping judge comparison.")
        # Return empty judge results - decision engine will handle this
        return {"success": True, "judge_results": [], "error": None}

    print(f"  Baseline: {baseline_dir}")
    print(f"  Candidate: {runs_dir}")

    # Judge configuration
    judge_config = {
        "model_ids": [args.judge_model] * 3,  # Use same model for all 3 judges
        "protocol_version": args.judge_protocol,
        "seeds": [42, 123, 789],  # Fixed seeds for reproducibility
    }

    # Run panel for each scenario
    judge_results = []
    for scenario_file in scenario_files:
        try:
            scenario = json.loads(scenario_file.read_text())
            scenario_id = scenario["id"]
            scenario_name = scenario.get("name", scenario_id)

            # Find bundle directories
            baseline_bundle_path = find_bundle(baseline_dir, scenario_id, scenario_name)
            candidate_bundle_path = find_bundle(runs_dir, scenario_id, scenario_name)

            if baseline_bundle_path is None or candidate_bundle_path is None:
                print(f"  ⊘ Skipped {scenario_id}: bundle not found")
                judge_results.append({
                    "scenario_id": scenario_id,
                    "verdict": "TIE",
                    "judge_unavailable": True,
                    "error": "Bundle not found"
                })
                continue

            # Run judge panel
            result = judge_panel(
                scenario=scenario,
                baseline_bundle={"path": str(baseline_bundle_path)},
                candidate_bundle={"path": str(candidate_bundle_path)},
                judge_config=judge_config
            )

            # Write judge verdicts to candidate bundle
            verdict_path = candidate_bundle_path / "judge-verdicts.json"
            write_judge_verdicts(result, verdict_path)

            judge_results.append({
                "scenario_id": scenario_id,
                "verdict": result["verdict"],
                "majority_count": result["majority_count"],
                "judge_unavailable": result.get("judge_unavailable", False),
            })

            print(f"  ✓ {scenario_id}: {result['verdict']} (majority: {result['majority_count']}/3)")

        except Exception as e:
            print(f"  ✗ Failed to judge {scenario_file.name}: {e}", file=sys.stderr)
            judge_results.append({
                "scenario_id": scenario.get("id", "unknown"),
                "verdict": "TIE",
                "judge_unavailable": True,
                "error": str(e)
            })

    return {"success": True, "judge_results": judge_results, "error": None}


def get_baseline_dir(skill: str, current_iteration: str) -> Path | None:
    """
    Find the baseline directory for comparison.

    For iteration 001: Current-best baseline in optimization/runs/<skill>/baseline
    For iteration 002+: Most recent KEEP'd iteration, or current best if no previous KEEP
    """
    iteration_num = int(current_iteration)
    if iteration_num == 1:
        baseline = Path(f"optimization/runs/{skill}/baseline")
        return baseline if baseline.exists() else None

    # Look for most recent iteration in optimization/history/<skill>/ with KEEP decision
    history_dir = Path(f"optimization/history/{skill}")
    if history_dir.exists():
        # Find all iteration-NNN directories
        iteration_dirs = sorted(
            [d for d in history_dir.iterdir() if d.is_dir() and d.name.startswith("iteration-")],
            reverse=True  # Most recent first
        )

        for iteration_dir in iteration_dirs:
            decision_file = iteration_dir / "decision.json"
            if decision_file.exists():
                decision = json.loads(decision_file.read_text())
                if decision.get("decision") == "KEEP":
                    # Use the runs directory from this iteration
                    iter_num = iteration_dir.name.replace("iteration-", "")
                    baseline = Path(f"optimization/runs/{skill}/{iter_num}")
                    if baseline.exists():
                        return baseline

    # Fallback: No previous KEEP'd iteration found
    baseline = Path(f"optimization/runs/{skill}/baseline")
    if baseline.exists():
        return baseline
    return None


def find_bundle(runs_dir: Path, scenario_id: str, scenario_name: str) -> Path | None:
    """
    Find the bundle directory for a scenario within a runs directory.

    Bundle directory format: <eval-id>-<name>/
    """
    # Try exact match first
    expected = runs_dir / f"{scenario_id}-{scenario_name}"
    if expected.exists() and expected.is_dir():
        return expected

    # Try finding any directory starting with scenario_id
    for item in runs_dir.iterdir():
        if item.is_dir() and item.name.startswith(f"{scenario_id}-"):
            return item

    return None


def run_decision_engine(skill: str, iteration: str, runs_dir: Path, judge_results: list, args: argparse.Namespace) -> dict[str, Any]:
    """
    Run autonomous decision engine.

    Returns:
        Dict with 'success': bool, 'decision': str | None, 'decision_data': dict | None, 'error': str | None
    """
    print(f"\n=== Iteration {iteration}: Decision Engine ===")

    # Collect check results from all bundles
    check_results = []
    scenario_meta = []

    scenarios_dir = Path(f"optimization/scenarios/{skill}")
    scenario_files = sorted(scenarios_dir.glob("eval-*.json"))

    for scenario_file in scenario_files:
        scenario = json.loads(scenario_file.read_text())
        scenario_id = scenario["id"]
        scenario_name = scenario.get("name", scenario_id)

        bundle_path = find_bundle(runs_dir, scenario_id, scenario_name)
        if bundle_path is None:
            continue

        # Load programmatic checks. The canonical shape (see
        # optimization/framework/checks/engine.py and optimization/scripts/run-public-eval.py) keys the list as
        # "checks", not "results"; consumers (decision engine, report
        # generator, judges) all walk c["result"] inside that list.
        checks_file = bundle_path / "programmatic-checks.json"
        if checks_file.exists():
            checks = json.loads(checks_file.read_text())
            check_entries = checks.get("checks", [])
            check_results.append({
                "scenario_id": scenario_id,
                "checks": check_entries,
                "all_passed": all(c.get("result") == "pass" for c in check_entries),
            })

        # Add scenario metadata
        scenario_meta.append({
            "scenario_id": scenario_id,
            "skill": skill,
            "current_hash": scenario_content_hash(scenario),
            "regression_critical": scenario.get("regression_critical", False),
        })

    # Write temporary files for decision CLI
    temp_dir = Path(f"optimization/results/{skill}/{iteration}/temp")
    temp_dir.mkdir(parents=True, exist_ok=True)

    check_results_file = temp_dir / "check-results.json"
    judge_results_file = temp_dir / "judge-results.json"
    scenario_meta_file = temp_dir / "scenario-meta.json"

    check_results_file.write_text(json.dumps(check_results, indent=2))
    judge_results_file.write_text(json.dumps(judge_results, indent=2))
    scenario_meta_file.write_text(json.dumps(scenario_meta, indent=2))

    # Run decision CLI
    cmd = [
        "python3", "optimization/scripts/make-decision.py",
        skill,
        iteration,
        "--check-results", str(check_results_file),
        "--judge-results", str(judge_results_file),
        "--scenario-meta", str(scenario_meta_file),
        "--baselines", "optimization/results/baselines.json",
        "--output", f"optimization/results/{skill}/{iteration}/decision.json",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(result.stdout)

        # Load decision result
        decision_file = Path(f"optimization/results/{skill}/{iteration}/decision.json")
        if not decision_file.exists():
            return {"success": False, "decision": None, "decision_data": None, "error": "Decision file not created"}

        decision_data = json.loads(decision_file.read_text())
        decision = decision_data.get("decision")

        print(f"  Decision: {decision}")
        print(f"  Rule: {decision_data.get('rule_fired')}")
        print(f"  Rationale: {decision_data.get('rationale')}")

        # Temp files are reused by the report generator immediately after.
        # The report step owns the final cleanup.

        return {"success": True, "decision": decision, "decision_data": decision_data, "error": None}

    except subprocess.CalledProcessError as e:
        error_msg = f"Decision engine failed: {e.stderr}"
        print(error_msg, file=sys.stderr)
        return {"success": False, "decision": None, "decision_data": None, "error": error_msg}


def run_report_generator(skill: str, iteration: str, decision_data: dict, args: argparse.Namespace) -> dict[str, Any]:
    """
    Generate iteration report.

    Returns:
        Dict with 'success': bool, 'error': str | None
    """
    print(f"\n=== Iteration {iteration}: Report Generator ===")

    results_dir = Path(f"optimization/results/{skill}/{iteration}")

    cmd = [
        "python3", "optimization/scripts/generate-report.py",
        skill,
        iteration,
        "--decision", str(results_dir / "decision.json"),
        "--check-results", str(results_dir / "temp" / "check-results.json"),
        "--judge-results", str(results_dir / "temp" / "judge-results.json"),
        "--scenarios", f"optimization/scenarios/{skill}",
        "--public-status", "optimization/results/public-status.json",
        "--output-dir", str(results_dir),
    ]

    # Note: temp files should exist from decision engine step
    # If they were cleaned up, we need to recreate them
    temp_dir = results_dir / "temp"
    if not temp_dir.exists():
        # Recreate temp files (this is a fallback)
        temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(result.stdout)

        # Clean up temp files if they still exist
        if temp_dir.exists():
            shutil.rmtree(temp_dir)

        return {"success": True, "error": None}

    except subprocess.CalledProcessError as e:
        error_msg = f"Report generator failed: {e.stderr}"
        print(error_msg, file=sys.stderr)
        return {"success": False, "error": error_msg}


def archive_iteration(skill: str, iteration: str, decision: str) -> None:
    """
    Archive iteration to optimization/history/<skill>/iteration-NNN/

    Archives the full iteration directory structure for reproducibility.
    """
    print(f"\n=== Archiving iteration {iteration} ===")

    history_dir = Path(f"optimization/history/{skill}/iteration-{iteration}")
    history_dir.mkdir(parents=True, exist_ok=True)

    # Copy decision and report
    results_dir = Path(f"optimization/results/{skill}/{iteration}")
    if results_dir.exists():
        for file in ["decision.json", "summary.md", "journal.jsonl"]:
            src = results_dir / file
            if src.exists():
                shutil.copy2(src, history_dir / file)

    # Record iteration metadata
    metadata = {
        "iteration": iteration,
        "decision": decision,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "runs_dir": f"optimization/runs/{skill}/{iteration}",
        "candidate_dir": f"optimization/candidates/{skill}/{iteration}",
        "generated_dir": f"optimization/generated/{skill}/{iteration}",
        "journal": f"optimization/history/{skill}/iteration-{iteration}/journal.jsonl",
    }

    (history_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

    print(f"  Archived to {history_dir}")


def mark_iteration_failed(
    skill: str,
    iteration: str,
    journal_path: Path,
    step: str,
    result: dict[str, Any],
) -> None:
    """Record a terminal iteration failure and archive the partial evidence."""
    write_journal_event(
        journal_path,
        "iteration_failed",
        skill=skill,
        iteration=iteration,
        step=step,
        result=result,
    )
    archive_iteration(skill, iteration, "FAILED")


def update_current_best(skill: str, iteration: str) -> None:
    """
    Update the current best skill file with the KEEP'd candidate.

    Copies optimization/candidates/<skill>/<iteration>/SKILL.md -> skills/<skill>/SKILL.md
    """
    candidate_path = Path(f"optimization/candidates/{skill}/{iteration}/SKILL.md")
    current_best_path = Path(f"skills/{skill}/SKILL.md")

    if not candidate_path.exists():
        print(f"  Warning: Candidate skill file not found: {candidate_path}", file=sys.stderr)
        return

    # Keep eval-loop backups inside eval history so skills/ stays readable.
    backup_dir = Path(f"optimization/history/{skill}/iteration-{iteration}")
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / "current-best-before.md"
    shutil.copy2(current_best_path, backup_path)

    # Update current best
    shutil.copy2(candidate_path, current_best_path)

    print(f"  Updated current best: {current_best_path}")
    print(f"  Backup saved: {backup_path}")


def check_stopping_condition(
    iterations_run: int,
    consecutive_ties: int,
    last_decision: str | None,
    args: argparse.Namespace
) -> tuple[bool, str | None]:
    """
    Check if a stopping condition has been met.

    Returns:
        (should_stop: bool, reason: str | None)
    """
    # Check SIGINT
    if _stop_requested:
        return (True, "SIGINT received")

    # Check max iterations
    if iterations_run >= args.max_iterations:
        return (True, f"Reached max iterations ({args.max_iterations})")

    # Check regression stop
    if args.stop_on == "regression" and last_decision == "REJECT":
        return (True, "First REJECT encountered (stop-on=regression)")

    # Check plateau stop
    if args.stop_on == "plateau":
        if consecutive_ties >= args.plateau_n:
            return (True, f"Plateau detected: {args.plateau_n} consecutive ties")

    # Continue
    return (False, None)


def run_loop(args: argparse.Namespace) -> int:
    """
    Run the autonomous evaluation loop.

    Returns:
        Exit code (0 for success, non-zero for error)
    """
    skill = args.skill

    print(f"=== Autonomous Evaluation Loop ===")
    print(f"Skill: {skill}")
    print(f"Max iterations: {args.max_iterations}")
    print(f"Stop condition: {args.stop_on}")
    if args.stop_on == "plateau":
        print(f"Plateau threshold: {args.plateau_n} consecutive ties")
    print()

    # Verify current best skill exists
    try:
        current_best = get_current_best_skill(skill)
        print(f"Current best skill: {current_best}")
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    baseline_result = ensure_current_best_baseline(skill, current_best, args)
    if not baseline_result["success"]:
        print(f"Error: {baseline_result['error']}", file=sys.stderr)
        return 1

    # Loop state
    iterations_run = 0
    consecutive_ties = 0
    last_decision = None

    while True:
        # Check stopping conditions
        should_stop, reason = check_stopping_condition(iterations_run, consecutive_ties, last_decision, args)
        if should_stop:
            print(f"\n=== Loop stopped: {reason} ===")
            break

        # Determine next iteration
        iteration = get_next_iteration(skill)
        print(f"\n{'='*60}")
        print(f"=== Starting iteration {iteration} ===")
        print(f"{'='*60}")

        journal_path = Path(f"optimization/results/{skill}/{iteration}/journal.jsonl")
        write_journal_event(
            journal_path,
            "iteration_started",
            skill=skill,
            iteration=iteration,
            current_best=current_best,
            max_iterations=args.max_iterations,
            stop_on=args.stop_on,
        )

        # Step 1: Propose candidate
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="proposer")
        proposer_result = run_proposer(skill, iteration, args)
        if not proposer_result["success"]:
            write_journal_event(
                journal_path,
                "step_failed",
                skill=skill,
                iteration=iteration,
                step="proposer",
                result=proposer_result,
            )
            mark_iteration_failed(skill, iteration, journal_path, "proposer", proposer_result)
            print(f"Error: {proposer_result['error']}", file=sys.stderr)
            return 1
        write_journal_event(
            journal_path,
            "step_completed",
            skill=skill,
            iteration=iteration,
            step="proposer",
            result=proposer_result,
        )

        candidate_path = proposer_result["candidate_path"]

        if _stop_requested:
            continue  # Check stopping condition at top of loop

        # Step 2: Skills adapter (generate code)
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="skills_adapter")
        adapter_result = run_skills_adapter(skill, iteration, candidate_path, args)
        if not adapter_result["success"]:
            write_journal_event(
                journal_path,
                "step_failed",
                skill=skill,
                iteration=iteration,
                step="skills_adapter",
                result=adapter_result,
            )
            mark_iteration_failed(skill, iteration, journal_path, "skills_adapter", adapter_result)
            print(f"Error: {adapter_result['error']}", file=sys.stderr)
            return 1
        write_journal_event(
            journal_path,
            "step_completed",
            skill=skill,
            iteration=iteration,
            step="skills_adapter",
            result=adapter_result,
        )

        if _stop_requested:
            continue

        # Step 3: Browser runner
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="browser_runner")
        runner_result = run_browser_eval(skill, iteration, args)
        if not runner_result["success"]:
            write_journal_event(
                journal_path,
                "step_failed",
                skill=skill,
                iteration=iteration,
                step="browser_runner",
                result=runner_result,
            )
            mark_iteration_failed(skill, iteration, journal_path, "browser_runner", runner_result)
            print(f"Error: {runner_result['error']}", file=sys.stderr)
            return 1
        write_journal_event(
            journal_path,
            "step_completed",
            skill=skill,
            iteration=iteration,
            step="browser_runner",
            result=runner_result,
        )

        runs_dir = runner_result["runs_dir"]

        if _stop_requested:
            continue

        # Step 4: Three-judge panel
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="judges")
        judges_result = run_judges(skill, iteration, runs_dir, args)
        if not judges_result["success"]:
            write_journal_event(
                journal_path,
                "step_failed",
                skill=skill,
                iteration=iteration,
                step="judges",
                result=judges_result,
            )
            mark_iteration_failed(skill, iteration, journal_path, "judges", judges_result)
            print(f"Error: {judges_result['error']}", file=sys.stderr)
            return 1
        write_journal_event(
            journal_path,
            "step_completed",
            skill=skill,
            iteration=iteration,
            step="judges",
            result=judges_result,
        )

        judge_results = judges_result["judge_results"]

        if _stop_requested:
            continue

        # Step 5: Decision engine
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="decision")
        decision_result = run_decision_engine(skill, iteration, runs_dir, judge_results, args)
        if not decision_result["success"]:
            write_journal_event(
                journal_path,
                "step_failed",
                skill=skill,
                iteration=iteration,
                step="decision",
                result=decision_result,
            )
            mark_iteration_failed(skill, iteration, journal_path, "decision", decision_result)
            print(f"Error: {decision_result['error']}", file=sys.stderr)
            return 1
        write_journal_event(
            journal_path,
            "step_completed",
            skill=skill,
            iteration=iteration,
            step="decision",
            result=decision_result,
        )

        decision = decision_result["decision"]
        decision_data = decision_result["decision_data"]

        if _stop_requested:
            continue

        # Step 6: Report generator
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="report")
        report_result = run_report_generator(skill, iteration, decision_data, args)
        if not report_result["success"]:
            write_journal_event(
                journal_path,
                "step_failed",
                skill=skill,
                iteration=iteration,
                step="report",
                result=report_result,
            )
            mark_iteration_failed(skill, iteration, journal_path, "report", report_result)
            print(f"Error: {report_result['error']}", file=sys.stderr)
            return 1
        write_journal_event(
            journal_path,
            "step_completed",
            skill=skill,
            iteration=iteration,
            step="report",
            result=report_result,
        )

        # Step 7: Archive iteration
        write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="archive")
        archive_iteration(skill, iteration, decision)
        write_journal_event(journal_path, "step_completed", skill=skill, iteration=iteration, step="archive")

        # Step 8: Update current best if KEEP
        if decision == "KEEP":
            write_journal_event(journal_path, "step_started", skill=skill, iteration=iteration, step="promote_current_best")
            update_current_best(skill, iteration)
            write_journal_event(journal_path, "step_completed", skill=skill, iteration=iteration, step="promote_current_best")
            consecutive_ties = 0  # Reset tie counter
        elif decision == "REJECT":
            consecutive_ties = 0  # Reset tie counter
        else:
            # TIE counts toward plateau detection
            consecutive_ties += 1

        last_decision = decision
        iterations_run += 1

        write_journal_event(
            journal_path,
            "iteration_completed",
            skill=skill,
            iteration=iteration,
            decision=decision,
            consecutive_ties=consecutive_ties,
        )
        archived_journal = Path(f"optimization/history/{skill}/iteration-{iteration}/journal.jsonl")
        if archived_journal.parent.exists():
            shutil.copy2(journal_path, archived_journal)

        print(f"\n=== Iteration {iteration} complete: {decision} ===")
        print(f"Consecutive ties: {consecutive_ties}")

    print(f"\n=== Loop completed ===")
    print(f"Total iterations: {iterations_run}")
    print(f"Final decision: {last_decision}")

    return 0


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        "skill",
        help="Skill name (e.g., cesiumjs-camera)"
    )

    parser.add_argument(
        "--max-iterations",
        type=int,
        default=10,
        help="Maximum number of iterations to run (default: 10)"
    )

    parser.add_argument(
        "--stop-on",
        choices=["plateau", "regression", "max"],
        default="max",
        help="Stopping condition: plateau (M consecutive ties), regression (first REJECT), max (only max-iterations) (default: max)"
    )

    parser.add_argument(
        "--plateau-n",
        type=int,
        default=3,
        help="Number of consecutive ties to trigger plateau stop (default: 3, only applies if --stop-on=plateau)"
    )

    # Proposer configuration
    parser.add_argument(
        "--proposer-model",
        default="claude-opus-4-7",
        help="Model for proposer (default: claude-opus-4-7)"
    )

    parser.add_argument(
        "--proposer-temperature",
        type=float,
        default=1.0,
        help="Temperature for proposer (default: 1.0)"
    )

    parser.add_argument(
        "--proposer-history",
        type=int,
        default=3,
        help="Number of historical iterations to include in proposer context (default: 3)"
    )

    parser.add_argument(
        "--proposer-decision-path",
        type=Path,
        help="Optional decision record to seed the proposer, for example a scorecard-derived focus decision."
    )

    # Eval adapter configuration
    parser.add_argument(
        "--eval-model",
        default="claude-opus-4-7",
        help="Model for code generation (default: claude-opus-4-7)"
    )

    parser.add_argument(
        "--eval-temperature",
        type=float,
        default=1.0,
        help="Temperature for code generation (default: 1.0)"
    )

    # Judge configuration
    parser.add_argument(
        "--judge-model",
        default="claude-opus-4-7",
        help="Model for judges (default: claude-opus-4-7)"
    )

    parser.add_argument(
        "--judge-protocol",
        default="pairwise-v1",
        help="Judge protocol version (default: pairwise-v1)"
    )

    args = parser.parse_args()

    # Validate environment: claude CLI for evals, Ion token for the browser runner.
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from optimization.framework.adapters.claude_cli import ClaudeCLINotFoundError, ensure_cli_available
        ensure_cli_available()
    except ClaudeCLINotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if not os.environ.get("CESIUM_ION_TOKEN"):
        print("Error: CESIUM_ION_TOKEN environment variable must be set", file=sys.stderr)
        return 1

    # Register signal handler
    signal.signal(signal.SIGINT, signal_handler)

    # Run loop
    return run_loop(args)


if __name__ == "__main__":
    sys.exit(main())
