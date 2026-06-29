#!/usr/bin/env python3
"""Re-run judges + decision for an existing skill iteration without
re-doing the proposer/adapter/runner steps.

Used after we discovered the iter 001 trials had been poisoned by an invalid
Ion token: we re-ran the browser runner with the real token (so screenshots
and console.json are clean), and now we want fresh judge verdicts (with a
better model than haiku, which was hitting JSON truncation) plus a real
decision based on those.

Usage:
  python3 optimization/scripts/rejudge.py <skill> --baseline-iter 000 --candidate-iter 001 \
    --judge-model <provider/model> --output-iter 001
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from optimization.framework.judges.panel import judge_panel, write_judge_verdicts
from optimization.framework.adapters.agent_cli import (
    default_agent_harness,
    resolve_agent_harness,
    resolve_agent_model,
    resolve_agent_variant,
)


def find_current_bundle(runs_dir: Path, scenario: dict) -> Path | None:
    """Look up the bundle by the scenario's *current* name field.
    Falls back to any eval-<id>-* dir if the exact match misses, but prefers
    bundles whose console.json shows no Ion 401 errors (i.e., post-token-fix
    re-runs)."""
    expected = runs_dir / f"{scenario['id']}-{scenario['name']}"
    if expected.exists():
        return expected
    candidates = sorted(runs_dir.glob(f"{scenario['id']}-*"))
    # Prefer ones without Ion 401s in console
    def clean(p: Path) -> bool:
        cj = p / "console.json"
        if not cj.exists():
            return False
        d = json.loads(cj.read_text())
        return not any("401" in m.get("text", "") for m in d.get("console_messages", []))
    for c in candidates:
        if clean(c):
            return c
    return candidates[0] if candidates else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("skill")
    ap.add_argument("--baseline-iter", default="000")
    ap.add_argument("--candidate-iter", default="001")
    ap.add_argument("--judge-harness", default=default_agent_harness("judge"), choices=["opencode", "codex"])
    ap.add_argument("--judge-model", default="auto")
    ap.add_argument("--judge-variant", default="auto")
    ap.add_argument("--judge-protocol", default="pairwise-v1")
    ap.add_argument("--output-iter", default=None,
                    help="Where to write decision.json; defaults to --candidate-iter")
    args = ap.parse_args()
    args.judge_harness = resolve_agent_harness(args.judge_harness, "judge")
    args.judge_model = resolve_agent_model(args.judge_model, "judge", args.judge_harness)
    args.judge_variant = resolve_agent_variant(args.judge_variant, "judge", args.judge_harness)

    output_iter = args.output_iter or args.candidate_iter

    scenarios_dir = REPO / "optimization" / "scenarios" / args.skill
    scenarios = [json.loads(p.read_text()) for p in sorted(scenarios_dir.glob("eval-*.json"))]

    baseline_root = REPO / "optimization" / "runs" / args.skill / args.baseline_iter
    candidate_root = REPO / "optimization" / "runs" / args.skill / args.candidate_iter

    judge_config = {
        "harnesses": [args.judge_harness] * 3,
        "model_ids": [args.judge_model] * 3,
        "model_variants": [args.judge_variant] * 3,
        "protocol_version": args.judge_protocol,
        "seeds": [42, 123, 789],
    }

    print(
        f"== Re-judging {args.skill}: {args.baseline_iter} vs {args.candidate_iter} "
        f"with {args.judge_harness} model={args.judge_model or args.judge_harness + '-default'} "
        f"variant={args.judge_variant} =="
    )
    judge_results = []
    check_results = []
    scenario_meta = []
    for scen in scenarios:
        sid = scen["id"]
        baseline_bundle = find_current_bundle(baseline_root, scen)
        candidate_bundle = find_current_bundle(candidate_root, scen)
        if baseline_bundle is None or candidate_bundle is None:
            print(f"  ⊘ {sid}: missing bundle (baseline={baseline_bundle}, candidate={candidate_bundle})")
            judge_results.append({"scenario_id": sid, "verdict": "TIE", "judge_unavailable": True})
            continue

        print(f"  judging {sid} ({baseline_bundle.name} vs {candidate_bundle.name}) ...", flush=True)
        try:
            result = judge_panel(
                scenario=scen,
                baseline_bundle={"path": str(baseline_bundle)},
                candidate_bundle={"path": str(candidate_bundle)},
                judge_config=judge_config,
            )
            verdict_path = candidate_bundle / "judge-verdicts.json"
            write_judge_verdicts(result, verdict_path)
            print(f"    -> {result['verdict']} ({result['majority_count']}/3)")
            judge_results.append({
                "scenario_id": sid,
                "verdict": result["verdict"],
                "majority_count": result["majority_count"],
                "judge_unavailable": result.get("judge_unavailable", False),
            })
        except Exception as e:
            print(f"    !! {sid} judge error: {e}")
            judge_results.append({"scenario_id": sid, "verdict": "TIE", "judge_unavailable": True, "error": str(e)})

        # Pull checks from the candidate bundle so the decision engine sees them
        ck = json.loads((candidate_bundle / "programmatic-checks.json").read_text())
        check_entries = ck.get("checks", [])
        check_results.append({
            "scenario_id": sid,
            "checks": check_entries,
            "all_passed": all(c.get("result") == "pass" for c in check_entries),
        })
        scenario_meta.append({
            "scenario_id": sid,
            "regression_critical": scen.get("regression_critical", False),
            "skill": args.skill,
            "current_hash": "",  # decision engine will skip rebaseline check
        })

    # Make decision via the canonical engine.
    # Pass empty baselines so rebaseline_required is empty: we don't want to
    # skip scenarios just because their hash diverged from the baselines.json
    # entry — for a re-judge we trust whatever the runner produced.
    from optimization.framework.decision.engine import decide
    decision = decide(check_results, judge_results, scenario_meta, baselines={})
    out_dir = REPO / "optimization" / "results" / args.skill / output_iter
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "decision.json").write_text(json.dumps(decision, indent=2) + "\n")
    print(f"\nDecision: {decision['decision']} ({decision['rule_fired']})")
    print(f"Counts: {decision['counts']}")
    print(f"Rationale: {decision['rationale']}")
    print(f"\nWrote {out_dir / 'decision.json'}")
    return 0 if decision["decision"] != "REJECT" else 0  # exit 0 either way; consumer reads decision


if __name__ == "__main__":
    sys.exit(main())
