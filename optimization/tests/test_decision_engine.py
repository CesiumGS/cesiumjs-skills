#!/usr/bin/env python3
"""Tests for the autonomous decision engine.

Tests cover:
- All five decision rules
- Rebaseline exclusion logic
- Edge cases (no scenarios, all judge_unavailable, etc.)
- Manual override functionality
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from optimization.framework.decision.engine import decide, load_baselines, check_rebaseline_required


class TestLoadBaselines(unittest.TestCase):
    """Tests for load_baselines()."""

    def test_load_baselines_success(self):
        """Test loading baselines from a valid file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({
                'schema_version': '1.0',
                'scenarios': {
                    'cesiumjs-camera': {
                        'eval-001': 'abc123',
                        'eval-002': 'def456'
                    }
                }
            }, f)
            temp_path = Path(f.name)

        try:
            baselines = load_baselines(temp_path)
            self.assertEqual(baselines['cesiumjs-camera']['eval-001'], 'abc123')
            self.assertEqual(baselines['cesiumjs-camera']['eval-002'], 'def456')
        finally:
            temp_path.unlink()

    def test_load_baselines_missing_file(self):
        """Test loading baselines when file doesn't exist."""
        baselines = load_baselines(Path('/nonexistent/path.json'))
        self.assertEqual(baselines, {})


class TestCheckRebaselineRequired(unittest.TestCase):
    """Tests for check_rebaseline_required()."""

    def setUp(self):
        """Set up test baselines."""
        self.baselines = {
            'cesiumjs-camera': {
                'eval-001': 'hash-001',
                'eval-002': 'hash-002'
            }
        }

    def test_hash_matches_baseline(self):
        """Test scenario with matching hash (no rebaseline needed)."""
        result = check_rebaseline_required(
            'eval-001', 'cesiumjs-camera', 'hash-001', self.baselines
        )
        self.assertFalse(result)

    def test_hash_differs_from_baseline(self):
        """Test scenario with different hash (rebaseline needed)."""
        result = check_rebaseline_required(
            'eval-001', 'cesiumjs-camera', 'hash-999', self.baselines
        )
        self.assertTrue(result)

    def test_scenario_not_in_baselines(self):
        """Test scenario not yet in baselines (no rebaseline needed)."""
        result = check_rebaseline_required(
            'eval-999', 'cesiumjs-camera', 'hash-999', self.baselines
        )
        self.assertFalse(result)

    def test_skill_not_in_baselines(self):
        """Test skill not yet in baselines (no rebaseline needed)."""
        result = check_rebaseline_required(
            'eval-001', 'cesiumjs-new-skill', 'hash-001', self.baselines
        )
        self.assertFalse(result)


class TestDecisionRules(unittest.TestCase):
    """Tests for the five decision rules in decide()."""

    def setUp(self):
        """Set up common test data."""
        self.baselines = {}  # Empty baselines for most tests

    def test_rule_1_check_failure(self):
        """Test Rule 1: Deterministic check failures -> REJECT."""
        check_results = [
            {
                'scenario_id': 'eval-001',
                'checks': [
                    {'check_id': 'code_runs', 'result': 'fail', 'detail': 'Runtime error'}
                ]
            }
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {
                'scenario_id': 'eval-001',
                'skill': 'cesiumjs-camera',
                'current_hash': 'hash-001',
                'regression_critical': True
            }
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        self.assertEqual(result['decision'], 'REJECT')
        self.assertEqual(result['rule_fired'], 'rule_1_check_failure')
        self.assertIn('eval-001', result['rationale'])

    def test_rule_2_critical_judge_loss(self):
        """Test Rule 2: Critical judge losses -> REJECT."""
        check_results = [
            {
                'scenario_id': 'eval-001',
                'checks': [
                    {'check_id': 'code_runs', 'result': 'pass', 'detail': ''}
                ]
            }
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'BASELINE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {
                'scenario_id': 'eval-001',
                'skill': 'cesiumjs-camera',
                'current_hash': 'hash-001',
                'regression_critical': True
            }
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        self.assertEqual(result['decision'], 'REJECT')
        self.assertEqual(result['rule_fired'], 'rule_2_critical_judge_loss')
        self.assertIn('eval-001', result['rationale'])

    def test_rule_3_more_wins(self):
        """Test Rule 3: Candidate wins > baseline wins -> KEEP."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},
            {'scenario_id': 'eval-002', 'checks': []},
            {'scenario_id': 'eval-003', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'CANDIDATE', 'judge_unavailable': False},
            {'scenario_id': 'eval-003', 'verdict': 'BASELINE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'h1', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'h2', 'regression_critical': False},
            {'scenario_id': 'eval-003', 'skill': 'cesiumjs-camera', 'current_hash': 'h3', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_3_more_wins')
        self.assertEqual(result['counts']['wins'], 2)
        self.assertEqual(result['counts']['losses'], 1)

    def test_rule_4_more_losses(self):
        """Test Rule 4: Baseline wins > candidate wins -> REJECT."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},
            {'scenario_id': 'eval-002', 'checks': []},
            {'scenario_id': 'eval-003', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'BASELINE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'BASELINE', 'judge_unavailable': False},
            {'scenario_id': 'eval-003', 'verdict': 'CANDIDATE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'h1', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'h2', 'regression_critical': False},
            {'scenario_id': 'eval-003', 'skill': 'cesiumjs-camera', 'current_hash': 'h3', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        self.assertEqual(result['decision'], 'REJECT')
        self.assertEqual(result['rule_fired'], 'rule_4_more_losses')
        self.assertEqual(result['counts']['wins'], 1)
        self.assertEqual(result['counts']['losses'], 2)

    def test_rule_5_tie_keep_current(self):
        """Test Rule 5: Tie -> KEEP CURRENT BEST."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},
            {'scenario_id': 'eval-002', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'BASELINE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'h1', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'h2', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_5_tie_keep_current')
        self.assertEqual(result['counts']['wins'], 1)
        self.assertEqual(result['counts']['losses'], 1)

    def test_rule_5_all_ties(self):
        """Test Rule 5 with all TIE verdicts."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},
            {'scenario_id': 'eval-002', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'TIE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'TIE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'h1', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'h2', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_5_tie_keep_current')
        self.assertEqual(result['counts']['wins'], 0)
        self.assertEqual(result['counts']['losses'], 0)
        self.assertEqual(result['counts']['ties'], 2)


class TestRebaselineExclusion(unittest.TestCase):
    """Tests for rebaseline exclusion logic."""

    def setUp(self):
        """Set up baselines with one scenario changed."""
        self.baselines = {
            'cesiumjs-camera': {
                'eval-001': 'hash-001-old',
                'eval-002': 'hash-002'
            }
        }

    def test_rebaseline_scenarios_excluded_from_counts(self):
        """Test that scenarios needing rebaseline are excluded from win/loss counts."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},  # Changed hash - excluded
            {'scenario_id': 'eval-002', 'checks': []},  # Unchanged hash - counted
            {'scenario_id': 'eval-003', 'checks': []}   # New scenario - counted
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'BASELINE', 'judge_unavailable': False},
            {'scenario_id': 'eval-003', 'verdict': 'CANDIDATE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'hash-001-new', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'hash-002', 'regression_critical': False},
            {'scenario_id': 'eval-003', 'skill': 'cesiumjs-camera', 'current_hash': 'hash-003', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        # eval-001 should be excluded, so only eval-002 (loss) and eval-003 (win) count
        self.assertEqual(result['counts']['wins'], 1)
        self.assertEqual(result['counts']['losses'], 1)
        self.assertIn('eval-001', result['rebaseline_required'])
        self.assertEqual(len(result['rebaseline_required']), 1)

    def test_critical_rebaseline_scenario_not_rejected(self):
        """Test that critical scenarios needing rebaseline don't trigger rejection."""
        check_results = [
            {
                'scenario_id': 'eval-001',
                'checks': [{'check_id': 'code_runs', 'result': 'fail', 'detail': 'Error'}]
            },
            {'scenario_id': 'eval-002', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'BASELINE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'CANDIDATE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {
                'scenario_id': 'eval-001',
                'skill': 'cesiumjs-camera',
                'current_hash': 'hash-001-new',
                'regression_critical': True  # Critical but needs rebaseline
            },
            {
                'scenario_id': 'eval-002',
                'skill': 'cesiumjs-camera',
                'current_hash': 'hash-002',
                'regression_critical': False
            }
        ]

        result = decide(check_results, judge_results, scenario_meta, self.baselines)

        # eval-001 is excluded, so only eval-002 (win) counts
        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_3_more_wins')
        self.assertEqual(result['counts']['wins'], 1)
        self.assertEqual(result['counts']['losses'], 0)


class TestEdgeCases(unittest.TestCase):
    """Tests for edge cases."""

    def test_no_scenarios(self):
        """Test decision with no scenarios."""
        result = decide([], [], [], {})

        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_5_tie_keep_current')
        self.assertEqual(result['counts']['wins'], 0)
        self.assertEqual(result['counts']['losses'], 0)

    def test_all_judge_unavailable(self):
        """Test decision when all judges are unavailable."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},
            {'scenario_id': 'eval-002', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'TIE', 'judge_unavailable': True},
            {'scenario_id': 'eval-002', 'verdict': 'TIE', 'judge_unavailable': True}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'h1', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'h2', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, {})

        # With all judges unavailable, no wins/losses should be counted
        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_5_tie_keep_current')
        self.assertEqual(result['counts']['wins'], 0)
        self.assertEqual(result['counts']['losses'], 0)

    def test_mixed_judge_availability(self):
        """Test decision with some judges available and some unavailable."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []},
            {'scenario_id': 'eval-002', 'checks': []},
            {'scenario_id': 'eval-003', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False},
            {'scenario_id': 'eval-002', 'verdict': 'TIE', 'judge_unavailable': True},
            {'scenario_id': 'eval-003', 'verdict': 'BASELINE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {'scenario_id': 'eval-001', 'skill': 'cesiumjs-camera', 'current_hash': 'h1', 'regression_critical': False},
            {'scenario_id': 'eval-002', 'skill': 'cesiumjs-camera', 'current_hash': 'h2', 'regression_critical': False},
            {'scenario_id': 'eval-003', 'skill': 'cesiumjs-camera', 'current_hash': 'h3', 'regression_critical': False}
        ]

        result = decide(check_results, judge_results, scenario_meta, {})

        # Only eval-001 (win) and eval-003 (loss) should be counted
        self.assertEqual(result['decision'], 'KEEP')
        self.assertEqual(result['rule_fired'], 'rule_5_tie_keep_current')
        self.assertEqual(result['counts']['wins'], 1)
        self.assertEqual(result['counts']['losses'], 1)

    def test_non_critical_check_failure_rejects(self):
        """Test that deterministic check failures reject even on non-critical scenarios."""
        check_results = [
            {
                'scenario_id': 'eval-001',
                'checks': [{'check_id': 'code_runs', 'result': 'fail', 'detail': 'Error'}]
            }
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {
                'scenario_id': 'eval-001',
                'skill': 'cesiumjs-camera',
                'current_hash': 'h1',
                'regression_critical': False  # Not critical
            }
        ]

        result = decide(check_results, judge_results, scenario_meta, {})

        self.assertEqual(result['decision'], 'REJECT')
        self.assertEqual(result['rule_fired'], 'rule_1_check_failure')
        self.assertEqual(result['counts']['check_failures'], 1)

    def test_non_critical_judge_loss_doesnt_reject(self):
        """Test that non-critical judge losses don't trigger Rule 2."""
        check_results = [
            {'scenario_id': 'eval-001', 'checks': []}
        ]
        judge_results = [
            {'scenario_id': 'eval-001', 'verdict': 'BASELINE', 'judge_unavailable': False}
        ]
        scenario_meta = [
            {
                'scenario_id': 'eval-001',
                'skill': 'cesiumjs-camera',
                'current_hash': 'h1',
                'regression_critical': False  # Not critical
            }
        ]

        result = decide(check_results, judge_results, scenario_meta, {})

        # Should not reject due to Rule 2 (non-critical)
        self.assertEqual(result['decision'], 'REJECT')
        self.assertEqual(result['rule_fired'], 'rule_4_more_losses')


if __name__ == '__main__':
    unittest.main()
