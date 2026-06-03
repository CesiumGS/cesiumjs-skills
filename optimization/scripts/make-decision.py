#!/usr/bin/env python3
"""CLI wrapper for the autonomous decision engine.

Reads check results, judge results, and scenario metadata to make a
deterministic keep/reject decision.

Optional --override flag allows manual override with rationale.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from optimization.framework.decision.engine import decide, load_baselines


def main() -> int:
    """Run the decision engine CLI."""
    parser = argparse.ArgumentParser(
        description='Make autonomous keep/reject decision for skill candidate'
    )
    parser.add_argument(
        'skill',
        help='Skill name (e.g., cesiumjs-camera)'
    )
    parser.add_argument(
        'iteration',
        help='Iteration number'
    )
    parser.add_argument(
        '--check-results',
        required=True,
        help='Path to aggregated check results JSON file'
    )
    parser.add_argument(
        '--judge-results',
        required=True,
        help='Path to aggregated judge results JSON file'
    )
    parser.add_argument(
        '--scenario-meta',
        required=True,
        help='Path to scenario metadata JSON file'
    )
    parser.add_argument(
        '--baselines',
        default='optimization/results/baselines.json',
        help='Path to baselines.json (default: optimization/results/baselines.json)'
    )
    parser.add_argument(
        '--output',
        help='Output path for decision.json (default: optimization/results/<skill>/<iteration>/decision.json)'
    )
    parser.add_argument(
        '--override',
        metavar='RATIONALE',
        help='Override automatic decision with manual decision. Provide rationale string.'
    )
    parser.add_argument(
        '--override-decision',
        choices=['KEEP', 'REJECT'],
        help='Decision to use when --override is specified (required with --override)'
    )

    args = parser.parse_args()

    # Validate override arguments
    if args.override and not args.override_decision:
        print('ERROR: --override-decision is required when using --override', file=sys.stderr)
        return 1
    if args.override_decision and not args.override:
        print('ERROR: --override is required when using --override-decision', file=sys.stderr)
        return 1

    # Load inputs
    try:
        with open(args.check_results) as f:
            check_results = json.load(f)
        with open(args.judge_results) as f:
            judge_results = json.load(f)
        with open(args.scenario_meta) as f:
            scenario_meta = json.load(f)
    except FileNotFoundError as e:
        print(f'ERROR: Input file not found: {e}', file=sys.stderr)
        return 1
    except json.JSONDecodeError as e:
        print(f'ERROR: Invalid JSON in input file: {e}', file=sys.stderr)
        return 1

    # Load baselines
    baselines_path = Path(args.baselines)
    baselines = load_baselines(baselines_path)

    # Make decision (or use override)
    if args.override:
        decision_result = {
            'decision': args.override_decision,
            'rule_fired': 'manual_override',
            'counts': {'wins': 0, 'losses': 0, 'ties': 0, 'critical_failures': 0},
            'rationale': f'MANUAL OVERRIDE: {args.override}',
            'rebaseline_required': []
        }
        print(f'Using manual override: {args.override_decision}')
        print(f'Rationale: {args.override}')
    else:
        decision_result = decide(check_results, judge_results, scenario_meta, baselines)
        print(f'Decision: {decision_result["decision"]}')
        print(f'Rule: {decision_result["rule_fired"]}')
        print(f'Rationale: {decision_result["rationale"]}')
        print(f'Counts: {decision_result["counts"]}')
        if decision_result['rebaseline_required']:
            print(f'Scenarios requiring re-baseline: {decision_result["rebaseline_required"]}')

    # Determine output path
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = Path('optimization') / 'results' / args.skill / args.iteration / 'decision.json'

    # Create parent directories if needed
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write decision result
    with output_path.open('w') as f:
        json.dump(decision_result, f, indent=2)

    print(f'Decision written to: {output_path}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
