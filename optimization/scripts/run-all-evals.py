#!/usr/bin/env python3
"""Run the autonomous eval loop across every skill scenario group."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_ROOT = REPO_ROOT / "optimization" / "scenarios"
FOCUS_TMP_ROOT = REPO_ROOT / "optimization" / "tmp" / "scorecard-focus"

sys.path.insert(0, str(REPO_ROOT))
from optimization.framework.scorecard_focus import build_focus, focus_to_decision  # noqa: E402


def discover_skills() -> list[str]:
    """Return skill ids that have scenario manifests."""
    return [
        path.name
        for path in sorted(SCENARIOS_ROOT.iterdir())
        if path.is_dir() and any(path.glob("eval-*.json"))
    ]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skills",
        default=None,
        help="Comma-separated skill ids, or 'all' for every eval scenario group. Defaults to recommended skills when --from-scorecard/--from-focus is used, otherwise all skills.",
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--from-scorecard",
        type=Path,
        help="Read evaluation scorecard JSON, derive failed-skill focus, and seed each proposer with a scorecard decision.",
    )
    source.add_argument(
        "--from-focus",
        type=Path,
        help="Read optimization scorecard-focus JSON and seed each proposer with a scorecard decision.",
    )
    parser.add_argument("--max-iterations", type=int, default=1)
    parser.add_argument(
        "--stop-on",
        choices=["plateau", "regression", "max"],
        default="max",
    )
    parser.add_argument("--plateau-n", type=int, default=3)
    parser.add_argument("--proposer-model", default="claude-opus-4-7")
    parser.add_argument("--eval-model", default="claude-opus-4-7")
    parser.add_argument("--judge-model", default="claude-opus-4-7")
    parser.add_argument(
        "--continue-on-failure",
        action="store_true",
        help="Continue evaluating remaining skills after one skill fails",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the run-loop commands without executing them",
    )
    return parser.parse_args(argv)


def selected_skills(value: str | None) -> list[str]:
    if value is None or value == "all":
        return discover_skills()
    skills = [item.strip() for item in value.split(",") if item.strip()]
    known = set(discover_skills())
    unknown = sorted(set(skills) - known)
    if unknown:
        raise SystemExit(f"Unknown skill(s): {', '.join(unknown)}")
    return skills


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def focus_from_args(args: argparse.Namespace) -> dict[str, Any] | None:
    if args.from_scorecard:
        return build_focus(load_json(args.from_scorecard))
    if args.from_focus:
        return load_json(args.from_focus)
    return None


def recommended_skills(focus: dict[str, Any]) -> list[str]:
    skills = [
        str(item["skill"])
        for item in focus.get("skills", [])
        if item.get("skill")
    ]
    if not skills:
        skills = [
            str(case["skill"])
            for case in focus.get("cases", [])
            if case.get("skill")
        ]
    known = set(discover_skills())
    deduped = []
    for skill in skills:
        if skill in known and skill not in deduped:
            deduped.append(skill)
    return deduped


def selected_skills_from_args(args: argparse.Namespace, focus: dict[str, Any] | None) -> list[str]:
    if args.skills:
        return selected_skills(args.skills)
    if focus is None:
        return selected_skills(None)
    return recommended_skills(focus)


def decision_dir_for_focus(focus: dict[str, Any]) -> Path:
    run_id = str(focus.get("source_run_id") or "unknown-scorecard")
    safe_run_id = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in run_id)
    return FOCUS_TMP_ROOT / safe_run_id


def write_focus_decision(skill: str, focus: dict[str, Any]) -> Path:
    out_dir = decision_dir_for_focus(focus)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{skill}-decision.json"
    payload = json.dumps(focus_to_decision(focus, skill=skill), indent=2, sort_keys=True)
    path.write_text(payload + "\n", encoding="utf-8")
    return path


def build_command(skill: str, args: argparse.Namespace, decision_path: Path | None = None) -> list[str]:
    cmd = [
        sys.executable,
        "optimization/scripts/run-loop.py",
        skill,
        "--max-iterations",
        str(args.max_iterations),
        "--stop-on",
        args.stop_on,
        "--plateau-n",
        str(args.plateau_n),
        "--proposer-model",
        args.proposer_model,
        "--eval-model",
        args.eval_model,
        "--judge-model",
        args.judge_model,
    ]
    if decision_path is not None:
        cmd.extend(["--proposer-decision-path", str(decision_path)])
    return cmd


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    focus = focus_from_args(args)
    skills = selected_skills_from_args(args, focus)
    if not skills:
        if focus is not None:
            print("[run-all-evals] No optimization recommended by the scorecard focus.")
            return 0
        print("No eval scenario groups found", file=sys.stderr)
        return 1

    focus_decisions: dict[str, Path] = {}
    if focus is not None:
        for skill in skills:
            focus_decisions[skill] = write_focus_decision(skill, focus)
        print("[run-all-evals] Scorecard focus selected skills:")
        for skill in skills:
            print(f"  {skill}: {focus_decisions[skill]}")

    failures: list[tuple[str, int]] = []
    for index, skill in enumerate(skills, 1):
        cmd = build_command(skill, args, focus_decisions.get(skill))
        printable = " ".join(cmd)
        print(f"\n=== [{index}/{len(skills)}] {skill} ===", flush=True)
        print(printable, flush=True)
        if args.dry_run:
            continue

        result = subprocess.run(cmd, cwd=REPO_ROOT, check=False)
        if result.returncode != 0:
            failures.append((skill, result.returncode))
            if not args.continue_on_failure:
                break

    if failures:
        print("\n[run-all-evals] FAIL:")
        for skill, returncode in failures:
            print(f"  {skill}: run-loop exited {returncode}")
        return 1

    print("\n[run-all-evals] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
