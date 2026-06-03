#!/usr/bin/env python3
"""Re-baseline a specific scenario by recording its current content hash.

Usage:
    optimization/scripts/rebaseline-scenario.py <skill> <eval-id> [--dry-run]

Examples:
    optimization/scripts/rebaseline-scenario.py cesiumjs-camera eval-001
    optimization/scripts/rebaseline-scenario.py cesiumjs-camera eval-001 --dry-run
    optimization/scripts/rebaseline-scenario.py cesiumjs-entities eval-003

This updates optimization/results/baselines.json to record the current scenario content hash
as the new baseline, clearing any 'rebaseline_required' flag for this scenario.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_ROOT = REPO_ROOT / "optimization" / "scenarios"
BASELINES_PATH = REPO_ROOT / "optimization" / "results" / "baselines.json"


def fail(message: str) -> None:
    print(f"[rebaseline-scenario] ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        fail(f"{path} not found")
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid JSON: {exc}")


def compute_scenario_hash(scenario_path: Path) -> str:
    """Compute SHA-256 hash of normalized scenario JSON."""
    import hashlib
    data = load_json(scenario_path)
    normalized = json.dumps(data, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def find_scenario_file(skill: str, eval_id: str) -> Path:
    """Find the scenario file for the given skill and eval_id."""
    skill_dir = SCENARIOS_ROOT / skill
    if not skill_dir.is_dir():
        fail(f"skill directory not found: {skill_dir}")

    # Look for eval-NNN-*.json pattern
    matches = list(skill_dir.glob(f"{eval_id}-*.json"))
    if not matches:
        fail(f"no scenario file found for {skill}/{eval_id}")
    if len(matches) > 1:
        fail(f"multiple scenario files found for {skill}/{eval_id}: {matches}")

    return matches[0]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Record a scenario's current content hash in optimization/results/baselines.json.",
    )
    parser.add_argument("skill", help="Skill name, such as cesiumjs-camera")
    parser.add_argument("eval_id", help="Scenario id in eval-NNN format")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and report the baseline change without writing baselines.json",
    )
    return parser.parse_args(argv)


def print_result(
    skill: str,
    eval_id: str,
    old_hash: str | None,
    current_hash: str,
    *,
    dry_run: bool,
) -> None:
    prefix = "[rebaseline-scenario]"
    if old_hash == current_hash:
        print(f"{prefix} ✓ Baseline unchanged for {skill}/{eval_id}")
    elif old_hash:
        verb = "Would update" if dry_run else "Updated"
        print(f"{prefix} ✓ {verb} baseline for {skill}/{eval_id}")
        print(f"                      Old: {old_hash[:12]}...")
        print(f"                      New: {current_hash[:12]}...")
    else:
        verb = "Would record" if dry_run else "Recorded"
        print(f"{prefix} ✓ {verb} new baseline for {skill}/{eval_id}")


def main() -> None:
    args = parse_args(sys.argv[1:])
    skill = args.skill
    eval_id = args.eval_id

    # Validate eval_id format
    import re
    if not re.fullmatch(r"eval-[0-9]{3}", eval_id):
        fail(f"eval_id must match pattern eval-NNN, got: {eval_id}")

    # Find scenario file
    scenario_path = find_scenario_file(skill, eval_id)
    print(f"[rebaseline-scenario] Found scenario: {scenario_path.relative_to(REPO_ROOT)}")

    # Compute current hash
    current_hash = compute_scenario_hash(scenario_path)
    print(f"[rebaseline-scenario] Current hash: {current_hash}")

    # Load existing baselines
    if BASELINES_PATH.exists():
        baselines = load_json(BASELINES_PATH)
    else:
        baselines = {
            "schema_version": "1.0",
            "description": "Content hashes for scenario manifests to detect changes requiring re-baseline",
            "scenarios": {}
        }

    # Update baseline for this scenario
    if skill not in baselines["scenarios"]:
        baselines["scenarios"][skill] = {}

    old_hash = baselines["scenarios"][skill].get(eval_id)
    baselines["scenarios"][skill][eval_id] = current_hash

    if args.dry_run:
        print_result(skill, eval_id, old_hash, current_hash, dry_run=True)
        print("[rebaseline-scenario] Dry run; baselines.json was not modified")
        return

    # Save updated baselines
    BASELINES_PATH.parent.mkdir(parents=True, exist_ok=True)
    BASELINES_PATH.write_text(json.dumps(baselines, indent=2) + "\n")

    print_result(skill, eval_id, old_hash, current_hash, dry_run=False)
    print(f"[rebaseline-scenario] Baselines saved to {BASELINES_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
