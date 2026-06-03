#!/usr/bin/env python3
"""Decision engine for autonomous keep/reject of skill candidates.

This module will implement the rule-based decision logic from US-011.
Currently stubbed to document the rebaseline_required behavior from US-003.

The decision engine will:
1. Load scenario baseline hashes from optimization/results/baselines.json
2. Compare against current scenario content hashes
3. Tag scenarios with hash mismatches as 'rebaseline_required'
4. Exclude rebaseline_required scenarios from win/loss totals
5. Apply rule-based keep/reject logic to eligible scenarios
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TypedDict


class DecisionResult(TypedDict):
    """Result of the decision engine."""
    decision: str  # 'KEEP' | 'REJECT'
    rule_fired: str
    counts: dict[str, int]
    rationale: str
    rebaseline_required: list[str]  # scenarios needing re-baseline


def load_baselines(baselines_path: Path) -> dict[str, dict[str, str]]:
    """Load baseline hashes for all scenarios."""
    if not baselines_path.exists():
        return {}
    with baselines_path.open() as f:
        data = json.load(f)
    return data.get("scenarios", {})


def check_rebaseline_required(
    scenario_id: str,
    skill: str,
    current_hash: str,
    baselines: dict[str, dict[str, str]]
) -> bool:
    """Check if a scenario requires re-baseline.

    Returns True if the current scenario content hash does not match
    the recorded baseline hash.

    Args:
        scenario_id: Scenario identifier (e.g., 'eval-001')
        skill: Skill name (e.g., 'cesiumjs-camera')
        current_hash: Current content hash of the scenario manifest
        baselines: Baseline hashes loaded from baselines.json

    Returns:
        True if scenario needs re-baseline, False otherwise
    """
    if skill not in baselines:
        return False
    if scenario_id not in baselines[skill]:
        return False
    return baselines[skill][scenario_id] != current_hash


def decide(
    check_results: list[dict[str, Any]],
    judge_results: list[dict[str, Any]],
    scenario_meta: dict[str, Any],
    baselines: dict[str, dict[str, str]]
) -> DecisionResult:
    """Make a keep/reject decision based on checks, judges, and baselines.

    The decision engine:
    1. Identifies scenarios requiring re-baseline
    2. Excludes rebaseline_required scenarios from win/loss totals
    3. Applies the five-rule cascade:
       - Rule 1: Deterministic check failures -> REJECT
       - Rule 2: Critical judge losses -> REJECT
       - Rule 3: Candidate wins > baseline wins -> KEEP
       - Rule 4: Baseline wins > candidate wins -> REJECT
       - Rule 5: Tie -> KEEP CURRENT BEST

    Args:
        check_results: List of programmatic check results per scenario
                       Each dict contains: {scenario_id, checks: [...]}
        judge_results: List of judge verdict results per scenario
                       Each dict contains: {scenario_id, verdict, judge_unavailable}
        scenario_meta: Metadata about scenarios including {scenario_id: {regression_critical, skill, current_hash}}
        baselines: Baseline hashes from baselines.json

    Returns:
        DecisionResult with decision, rationale, and rebaseline flags
    """
    # Track scenarios requiring re-baseline
    rebaseline_required = []

    # Build scenario metadata index for fast lookup
    scenario_index = {s['scenario_id']: s for s in scenario_meta}

    # Identify scenarios needing re-baseline (exclude from win/loss totals)
    for scenario_id, meta in scenario_index.items():
        skill = meta.get('skill', '')
        current_hash = meta.get('current_hash', '')
        if check_rebaseline_required(scenario_id, skill, current_hash, baselines):
            rebaseline_required.append(scenario_id)

    # Initialize counters
    wins = 0
    losses = 0
    ties = 0
    critical_failures = 0
    check_failures = 0

    environment_invalid = []
    # Process each scenario
    for check_result, judge_result in zip(check_results, judge_results):
        scenario_id = check_result.get('scenario_id')

        # Skip scenarios that need re-baseline
        if scenario_id in rebaseline_required:
            continue

        # Skip scenarios where the run was environment-invalid (e.g., Ion
        # auth failed mid-run). The ion_auth_failure check is synthesized by
        # run-public-eval and means the trial's screenshot/console don't
        # reflect candidate quality. Treating these as critical regressions
        # is what poisoned iteration 001.
        checks = check_result.get('checks', [])
        if any(c.get('type') == 'ion_auth_failure' for c in checks):
            environment_invalid.append(scenario_id)
            continue

        # Get scenario metadata
        meta = scenario_index.get(scenario_id, {})
        is_critical = meta.get('regression_critical', False)

        # Rule 1: Deterministic check failures -> REJECT (excluding ion_auth_failure).
        #
        # Judges are visual/semantic arbiters, but they should never be allowed
        # to promote a candidate whose browser bundle failed deterministic
        # execution or screenshot checks. This keeps KEEP decisions from
        # advancing artifacts that are known broken even when the visual vote is
        # favorable overall.
        non_env_checks = [c for c in checks if c.get('type') != 'ion_auth_failure']
        any_check_failed = any(c.get('result') == 'fail' for c in non_env_checks)
        if any_check_failed:
            check_failures += 1
            if is_critical:
                critical_failures += 1
            return {
                'decision': 'REJECT',
                'rule_fired': 'rule_1_check_failure',
                'counts': {
                    'wins': wins,
                    'losses': losses,
                    'ties': ties,
                    'critical_failures': critical_failures,
                    'check_failures': check_failures,
                },
                'rationale': f'REJECT: Programmatic check failed on scenario {scenario_id}',
                'rebaseline_required': rebaseline_required
            }

        # Rule 2: Critical judge losses -> REJECT
        verdict = judge_result.get('verdict')
        judge_unavailable = judge_result.get('judge_unavailable', False)

        # Only count judge results if judges were available
        if not judge_unavailable:
            if is_critical and verdict == 'BASELINE':
                return {
                    'decision': 'REJECT',
                    'rule_fired': 'rule_2_critical_judge_loss',
                    'counts': {
                    'wins': wins,
                    'losses': losses + 1,
                    'ties': ties,
                    'critical_failures': critical_failures,
                    'check_failures': check_failures,
                },
                    'rationale': f'REJECT: Judge loss on regression-critical scenario {scenario_id}',
                    'rebaseline_required': rebaseline_required
                }

            # Count wins, losses, ties
            if verdict == 'CANDIDATE':
                wins += 1
            elif verdict == 'BASELINE':
                losses += 1
            elif verdict == 'TIE':
                ties += 1

    # Rules 3, 4, 5: Compare win/loss counts
    counts = {
        'wins': wins,
        'losses': losses,
        'ties': ties,
        'critical_failures': critical_failures,
        'check_failures': check_failures,
    }

    # Rule 3: Candidate wins > baseline wins -> KEEP
    if wins > losses:
        return {
            'decision': 'KEEP',
            'rule_fired': 'rule_3_more_wins',
            'counts': counts,
            'rationale': f'KEEP: Candidate won {wins} scenarios vs {losses} baseline wins',
            'rebaseline_required': rebaseline_required
        }

    # Rule 4: Baseline wins > candidate wins -> REJECT
    if losses > wins:
        return {
            'decision': 'REJECT',
            'rule_fired': 'rule_4_more_losses',
            'counts': counts,
            'rationale': f'REJECT: Baseline won {losses} scenarios vs {wins} candidate wins',
            'rebaseline_required': rebaseline_required
        }

    # Rule 5: Tie -> KEEP CURRENT BEST
    return {
        'decision': 'KEEP',
        'rule_fired': 'rule_5_tie_keep_current',
        'counts': counts,
        'rationale': f'KEEP: Tie ({wins} wins, {losses} losses, {ties} ties) - keeping current best',
        'rebaseline_required': rebaseline_required
    }
