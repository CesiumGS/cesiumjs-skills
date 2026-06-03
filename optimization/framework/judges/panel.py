"""
Three-judge panel orchestration with majority vote for CesiumJS skills evaluation.

This module implements a three-judge panel that invokes the single judge function
three times with different seeds and computes a majority verdict.
"""

import json
from typing import Dict, Any, List, Literal
from pathlib import Path

from .single import judge as single_judge


def judge_panel(
    scenario: Dict[str, Any],
    baseline_bundle: Dict[str, Any],
    candidate_bundle: Dict[str, Any],
    judge_config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Invoke three independent judges and compute majority verdict.

    Args:
        scenario: The scenario manifest dict
        baseline_bundle: Dict with keys: 'path' (str, bundle directory path)
        candidate_bundle: Dict with keys: 'path' (str, bundle directory path)
        judge_config: Dict with keys:
            - model_ids: List[str] with 3 model IDs (or single ID repeated 3 times)
            - protocol_version: str (e.g., 'pairwise-v1')
            - seeds: List[int] with 3 different seeds

    Returns:
        Dict with keys:
            - verdict: 'BASELINE' | 'CANDIDATE' | 'TIE' (majority vote)
            - individual_verdicts: List[Dict] with all three judge results
            - majority_count: int (how many judges voted for the winning verdict)
            - judge_unavailable: bool (True if fewer than 3 verdicts obtained)
            - scenario_id: str
            - protocol_version: str

    Raises:
        ValueError: If judge_config is invalid (wrong number of models/seeds)
    """
    # Validate configuration
    model_ids = judge_config.get('model_ids', [])
    seeds = judge_config.get('seeds', [])
    protocol_version = judge_config.get('protocol_version', 'pairwise-v1')

    if len(model_ids) != 3:
        raise ValueError(
            f"judge_config must specify exactly 3 model_ids, got {len(model_ids)}"
        )

    if len(seeds) != 3:
        raise ValueError(
            f"judge_config must specify exactly 3 seeds, got {len(seeds)}"
        )

    # Ensure seeds are all different
    if len(set(seeds)) != 3:
        raise ValueError(
            f"judge_config seeds must all be different, got {seeds}"
        )

    # Invoke three judges
    individual_verdicts = []
    for i in range(3):
        try:
            verdict = single_judge(
                scenario=scenario,
                baseline_bundle=baseline_bundle,
                candidate_bundle=candidate_bundle,
                judge_model_id=model_ids[i],
                judge_protocol_version=protocol_version,
                seed=seeds[i]
            )
            individual_verdicts.append({
                'judge_index': i,
                'verdict': verdict['verdict'],
                'rationale': verdict['rationale'],
                'model_id': verdict['model_id'],
                'protocol_version': verdict['protocol_version'],
                'label_mapping': verdict['label_mapping'],
                'seed': verdict['seed']
            })
        except Exception as e:
            # Record the failure but continue
            individual_verdicts.append({
                'judge_index': i,
                'verdict': None,
                'error': str(e),
                'model_id': model_ids[i],
                'seed': seeds[i]
            })

    # Check if we have at least 3 valid verdicts
    valid_verdicts = [v for v in individual_verdicts if v['verdict'] is not None]

    if len(valid_verdicts) < 3:
        # Mark as judge_unavailable
        return {
            'verdict': None,
            'individual_verdicts': individual_verdicts,
            'majority_count': 0,
            'judge_unavailable': True,
            'scenario_id': scenario['id'],
            'protocol_version': protocol_version
        }

    # Compute majority verdict
    majority_result = _compute_majority([v['verdict'] for v in valid_verdicts])

    return {
        'verdict': majority_result['verdict'],
        'individual_verdicts': individual_verdicts,
        'majority_count': majority_result['count'],
        'judge_unavailable': False,
        'scenario_id': scenario['id'],
        'protocol_version': protocol_version
    }


def _compute_majority(verdicts: List[str]) -> Dict[str, Any]:
    """
    Compute the majority verdict from a list of verdicts.

    Args:
        verdicts: List of verdict strings ('BASELINE', 'CANDIDATE', or 'TIE')

    Returns:
        Dict with keys:
            - verdict: str (majority verdict, or 'TIE' for three-way tie)
            - count: int (number of votes for the majority verdict)

    Rules:
        - Simple majority (2 or 3 out of 3) wins
        - Three-way tie (1-1-1) resolves to 'TIE'
    """
    if len(verdicts) != 3:
        raise ValueError(f"Expected exactly 3 verdicts, got {len(verdicts)}")

    # Count votes
    from collections import Counter
    vote_counts = Counter(verdicts)

    # Get the most common verdict
    most_common = vote_counts.most_common()

    # Check for three-way tie (all three verdicts different)
    if len(most_common) == 3:
        # Three-way tie: 1-1-1
        return {'verdict': 'TIE', 'count': 1}

    # Simple majority (2 or 3 votes)
    winning_verdict = most_common[0][0]
    winning_count = most_common[0][1]

    return {'verdict': winning_verdict, 'count': winning_count}


def write_judge_verdicts(
    panel_result: Dict[str, Any],
    output_path: str
) -> None:
    """
    Write judge verdicts to judge-verdicts.json file.

    Args:
        panel_result: Result dict from judge_panel()
        output_path: Path to write judge-verdicts.json

    The output JSON includes:
        - All three individual verdicts with rationales, model IDs, seeds, label randomizations
        - Final majority verdict
        - Protocol version
        - Judge availability status
    """
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump(panel_result, f, indent=2)
