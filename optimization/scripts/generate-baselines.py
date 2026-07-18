#!/usr/bin/env python3
"""Generate baseline JS code for all scenarios across all skills.

Walks optimization/scenarios/<skill>/*.json and uses SkillsAdapter to generate code
for each scenario against the current best SKILL.md, writing into
optimization/generated/<skill>/baseline/.

Designed to be re-runnable: skips scenarios where the .js already exists,
so partial failures can be resumed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from optimization.framework.adapters.skills_adapter import SkillsAdapter  # noqa: E402
from optimization.framework.adapters.agent_cli import (  # noqa: E402
    default_agent_harness,
    resolve_agent_harness,
    resolve_agent_model,
    resolve_agent_variant,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill", help="Only generate for this skill", default=None)
    parser.add_argument("--iteration", default="baseline", help="Output iteration label")
    parser.add_argument("--harness", default=default_agent_harness("eval"), choices=["opencode", "codex"])
    parser.add_argument(
        "--model",
        default="auto",
        help="Model id (default: GPT-5.6 Sol at low effort, on either harness)",
    )
    parser.add_argument(
        "--model-variant",
        default="auto",
        help="Model variant/reasoning effort (default: low, on either harness)",
    )
    parser.add_argument("--force", action="store_true", help="Re-generate even if .js exists")
    parser.add_argument("--only", default="", help="Comma-separated scenario ids to generate")
    args = parser.parse_args()
    args.harness = resolve_agent_harness(args.harness, "eval")
    args.model = resolve_agent_model(args.model, "eval", args.harness)
    args.model_variant = resolve_agent_variant(args.model_variant, "eval", args.harness)

    scenarios_root = REPO_ROOT / "optimization" / "scenarios"
    if args.skill:
        skill_dirs = [scenarios_root / args.skill]
    else:
        skill_dirs = sorted([d for d in scenarios_root.iterdir() if d.is_dir()])

    only_ids = {s.strip() for s in args.only.split(",") if s.strip()}

    total_done = 0
    total_skipped = 0
    total_failed = 0
    total_attempted = 0

    for skill_dir in skill_dirs:
        skill = skill_dir.name
        skill_md = REPO_ROOT / "skills" / skill / "SKILL.md"
        if not skill_md.exists():
            print(f"[skip] no SKILL.md for {skill}: expected {skill_md}")
            continue

        out_dir = REPO_ROOT / "optimization" / "generated" / skill / args.iteration
        out_dir.mkdir(parents=True, exist_ok=True)

        scenario_files = sorted(skill_dir.glob("eval-*.json"))
        print(f"=== {skill}: {len(scenario_files)} scenarios ===")

        try:
            adapter = SkillsAdapter(
                skill=skill,
                iteration=args.iteration,
                model_id=args.model,
                model_variant=args.model_variant,
                harness=args.harness,
                temperature=1.0,
            )
        except Exception as e:
            print(f"  ! adapter init failed for {skill}: {e}")
            continue

        for scenario_file in scenario_files:
            scenario = json.loads(scenario_file.read_text())
            scenario_id = scenario["id"]

            if only_ids and scenario_id not in only_ids:
                continue

            if scenario.get("runner_mode") == "review-only":
                print(f"  - {scenario_id}: review-only, skipping")
                total_skipped += 1
                continue

            out_js = out_dir / f"{scenario_id}.js"
            if out_js.exists() and not args.force:
                print(f"  - {scenario_id}: exists, skipping (use --force to regenerate)")
                total_skipped += 1
                continue

            print(f"  ... generating {scenario_id}", flush=True)
            total_attempted += 1
            t0 = time.time()
            try:
                adapter.prepare(scenario, {"skill_path": str(skill_md)})
                adapter.invoke()
                path, meta = adapter.collect_output()
                dt = time.time() - t0
                print(f"  + {scenario_id} -> {path} ({dt:.1f}s)")
                total_done += 1
            except Exception as e:
                dt = time.time() - t0
                print(f"  ! {scenario_id} FAILED after {dt:.1f}s: {e}")
                total_failed += 1

    print(
        f"\n=== Done: {total_done} generated, {total_skipped} skipped, "
        f"{total_failed} failed (attempted {total_attempted}) ==="
    )
    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
