"""
Tests for optimization/framework/judges/panel.py - three-judge orchestration with majority vote.
"""

import unittest
from unittest.mock import patch, MagicMock
import tempfile
import os
import json
from pathlib import Path

# Import the module under test
from optimization.framework.judges.panel import judge_panel, _compute_majority, write_judge_verdicts


class TestComputeMajority(unittest.TestCase):
    """Test the majority voting logic for all possible vote combinations."""

    def test_unanimous_baseline(self):
        """3-0-0: All three judges vote BASELINE."""
        result = _compute_majority(['BASELINE', 'BASELINE', 'BASELINE'])
        self.assertEqual(result['verdict'], 'BASELINE')
        self.assertEqual(result['count'], 3)

    def test_unanimous_candidate(self):
        """0-3-0: All three judges vote CANDIDATE."""
        result = _compute_majority(['CANDIDATE', 'CANDIDATE', 'CANDIDATE'])
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['count'], 3)

    def test_unanimous_tie(self):
        """0-0-3: All three judges vote TIE."""
        result = _compute_majority(['TIE', 'TIE', 'TIE'])
        self.assertEqual(result['verdict'], 'TIE')
        self.assertEqual(result['count'], 3)

    def test_baseline_majority_over_candidate(self):
        """2-1-0: BASELINE wins with 2 votes against CANDIDATE."""
        result = _compute_majority(['BASELINE', 'BASELINE', 'CANDIDATE'])
        self.assertEqual(result['verdict'], 'BASELINE')
        self.assertEqual(result['count'], 2)

    def test_baseline_majority_over_tie(self):
        """2-0-1: BASELINE wins with 2 votes against TIE."""
        result = _compute_majority(['BASELINE', 'BASELINE', 'TIE'])
        self.assertEqual(result['verdict'], 'BASELINE')
        self.assertEqual(result['count'], 2)

    def test_candidate_majority_over_baseline(self):
        """1-2-0: CANDIDATE wins with 2 votes against BASELINE."""
        result = _compute_majority(['CANDIDATE', 'CANDIDATE', 'BASELINE'])
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['count'], 2)

    def test_candidate_majority_over_tie(self):
        """0-2-1: CANDIDATE wins with 2 votes against TIE."""
        result = _compute_majority(['CANDIDATE', 'CANDIDATE', 'TIE'])
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['count'], 2)

    def test_tie_majority_over_baseline(self):
        """1-0-2: TIE wins with 2 votes against BASELINE."""
        result = _compute_majority(['TIE', 'TIE', 'BASELINE'])
        self.assertEqual(result['verdict'], 'TIE')
        self.assertEqual(result['count'], 2)

    def test_tie_majority_over_candidate(self):
        """0-1-2: TIE wins with 2 votes against CANDIDATE."""
        result = _compute_majority(['TIE', 'TIE', 'CANDIDATE'])
        self.assertEqual(result['verdict'], 'TIE')
        self.assertEqual(result['count'], 2)

    def test_three_way_tie(self):
        """1-1-1: Three-way tie resolves to TIE."""
        result = _compute_majority(['BASELINE', 'CANDIDATE', 'TIE'])
        self.assertEqual(result['verdict'], 'TIE')
        self.assertEqual(result['count'], 1)

    def test_order_independence_1(self):
        """Test that vote order doesn't matter: BCC."""
        result = _compute_majority(['BASELINE', 'CANDIDATE', 'CANDIDATE'])
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['count'], 2)

    def test_order_independence_2(self):
        """Test that vote order doesn't matter: CBC."""
        result = _compute_majority(['CANDIDATE', 'BASELINE', 'CANDIDATE'])
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['count'], 2)

    def test_order_independence_3(self):
        """Test that vote order doesn't matter: CCB."""
        result = _compute_majority(['CANDIDATE', 'CANDIDATE', 'BASELINE'])
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['count'], 2)

    def test_invalid_verdict_count(self):
        """Test that only exactly 3 verdicts are accepted."""
        with self.assertRaises(ValueError):
            _compute_majority(['BASELINE', 'CANDIDATE'])

        with self.assertRaises(ValueError):
            _compute_majority(['BASELINE', 'CANDIDATE', 'TIE', 'BASELINE'])

    def test_all_27_combinations(self):
        """
        Comprehensive test of all 27 possible vote combinations.

        Each judge can vote BASELINE (B), CANDIDATE (C), or TIE (T).
        With 3 judges, we have 3^3 = 27 combinations.
        """
        # Define expected outcomes for all 27 combinations
        # Format: (votes, expected_verdict, expected_count)
        combinations = [
            # 3-0-0: All BASELINE
            (['BASELINE', 'BASELINE', 'BASELINE'], 'BASELINE', 3),

            # 2-1-0: BASELINE majority over CANDIDATE
            (['BASELINE', 'BASELINE', 'CANDIDATE'], 'BASELINE', 2),
            (['BASELINE', 'CANDIDATE', 'BASELINE'], 'BASELINE', 2),
            (['CANDIDATE', 'BASELINE', 'BASELINE'], 'BASELINE', 2),

            # 2-0-1: BASELINE majority over TIE
            (['BASELINE', 'BASELINE', 'TIE'], 'BASELINE', 2),
            (['BASELINE', 'TIE', 'BASELINE'], 'BASELINE', 2),
            (['TIE', 'BASELINE', 'BASELINE'], 'BASELINE', 2),

            # 1-2-0: CANDIDATE majority over BASELINE
            (['CANDIDATE', 'CANDIDATE', 'BASELINE'], 'CANDIDATE', 2),
            (['CANDIDATE', 'BASELINE', 'CANDIDATE'], 'CANDIDATE', 2),
            (['BASELINE', 'CANDIDATE', 'CANDIDATE'], 'CANDIDATE', 2),

            # 0-3-0: All CANDIDATE
            (['CANDIDATE', 'CANDIDATE', 'CANDIDATE'], 'CANDIDATE', 3),

            # 0-2-1: CANDIDATE majority over TIE
            (['CANDIDATE', 'CANDIDATE', 'TIE'], 'CANDIDATE', 2),
            (['CANDIDATE', 'TIE', 'CANDIDATE'], 'CANDIDATE', 2),
            (['TIE', 'CANDIDATE', 'CANDIDATE'], 'CANDIDATE', 2),

            # 1-0-2: TIE majority over BASELINE
            (['TIE', 'TIE', 'BASELINE'], 'TIE', 2),
            (['TIE', 'BASELINE', 'TIE'], 'TIE', 2),
            (['BASELINE', 'TIE', 'TIE'], 'TIE', 2),

            # 0-1-2: TIE majority over CANDIDATE
            (['TIE', 'TIE', 'CANDIDATE'], 'TIE', 2),
            (['TIE', 'CANDIDATE', 'TIE'], 'TIE', 2),
            (['CANDIDATE', 'TIE', 'TIE'], 'TIE', 2),

            # 0-0-3: All TIE
            (['TIE', 'TIE', 'TIE'], 'TIE', 3),

            # 1-1-1: Three-way tie (all different)
            (['BASELINE', 'CANDIDATE', 'TIE'], 'TIE', 1),
            (['BASELINE', 'TIE', 'CANDIDATE'], 'TIE', 1),
            (['CANDIDATE', 'BASELINE', 'TIE'], 'TIE', 1),
            (['CANDIDATE', 'TIE', 'BASELINE'], 'TIE', 1),
            (['TIE', 'BASELINE', 'CANDIDATE'], 'TIE', 1),
            (['TIE', 'CANDIDATE', 'BASELINE'], 'TIE', 1),
        ]

        # Verify all 27 combinations
        self.assertEqual(len(combinations), 27, "Must test all 27 combinations")

        for votes, expected_verdict, expected_count in combinations:
            with self.subTest(votes=votes):
                result = _compute_majority(votes)
                self.assertEqual(
                    result['verdict'],
                    expected_verdict,
                    f"Failed for votes {votes}"
                )
                self.assertEqual(
                    result['count'],
                    expected_count,
                    f"Failed count for votes {votes}"
                )


class TestJudgePanel(unittest.TestCase):
    """Test the three-judge panel orchestration."""

    def setUp(self):
        """Set up test fixtures."""
        self.scenario = {
            'id': 'eval-001',
            'name': 'Test Scenario',
            'description': 'Test scenario for unit tests',
            'prompt': 'Test prompt',
            'expected_behaviors': ['behavior 1', 'behavior 2']
        }

        self.baseline_bundle = {'path': '/path/to/baseline'}
        self.candidate_bundle = {'path': '/path/to/candidate'}

        self.judge_config = {
            'model_ids': ['openai/gpt-5.5'] * 3,
            'protocol_version': 'pairwise-v1',
            'seeds': [100, 200, 300]
        }

    @patch('optimization.framework.judges.panel.single_judge')
    def test_unanimous_verdict(self, mock_single_judge):
        """Test panel with unanimous BASELINE verdict."""
        # Mock all three judges to return BASELINE
        mock_single_judge.return_value = {
            'verdict': 'BASELINE',
            'rationale': 'Test rationale',
            'model_id': 'openai/gpt-5.5',
            'protocol_version': 'pairwise-v1',
            'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
            'seed': 100
        }

        result = judge_panel(
            self.scenario,
            self.baseline_bundle,
            self.candidate_bundle,
            self.judge_config
        )

        # Verify result structure
        self.assertEqual(result['verdict'], 'BASELINE')
        self.assertEqual(result['majority_count'], 3)
        self.assertFalse(result['judge_unavailable'])
        self.assertEqual(len(result['individual_verdicts']), 3)
        self.assertEqual(result['scenario_id'], 'eval-001')

        # Verify single_judge was called 3 times with correct seeds
        self.assertEqual(mock_single_judge.call_count, 3)

    @patch('optimization.framework.judges.panel.single_judge')
    def test_majority_verdict(self, mock_single_judge):
        """Test panel with 2-1 majority."""
        # Mock judges to return 2 CANDIDATE, 1 BASELINE
        def mock_judge_side_effect(*args, **kwargs):
            seed = kwargs['seed']
            if seed in (100, 200):
                return {
                    'verdict': 'CANDIDATE',
                    'rationale': 'Test rationale',
                    'model_id': 'openai/gpt-5.5',
                    'protocol_version': 'pairwise-v1',
                    'label_mapping': {'A': 'CANDIDATE', 'B': 'BASELINE'},
                    'seed': seed
                }
            else:
                return {
                    'verdict': 'BASELINE',
                    'rationale': 'Test rationale',
                    'model_id': 'openai/gpt-5.5',
                    'protocol_version': 'pairwise-v1',
                    'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
                    'seed': seed
                }

        mock_single_judge.side_effect = mock_judge_side_effect

        result = judge_panel(
            self.scenario,
            self.baseline_bundle,
            self.candidate_bundle,
            self.judge_config
        )

        # Verify majority verdict
        self.assertEqual(result['verdict'], 'CANDIDATE')
        self.assertEqual(result['majority_count'], 2)
        self.assertFalse(result['judge_unavailable'])

    @patch('optimization.framework.judges.panel.single_judge')
    def test_three_way_tie_verdict(self, mock_single_judge):
        """Test panel with three-way tie (1-1-1)."""
        # Mock judges to return BASELINE, CANDIDATE, TIE
        def mock_judge_side_effect(*args, **kwargs):
            seed = kwargs['seed']
            verdicts = {100: 'BASELINE', 200: 'CANDIDATE', 300: 'TIE'}
            return {
                'verdict': verdicts[seed],
                'rationale': 'Test rationale',
                'model_id': 'openai/gpt-5.5',
                'protocol_version': 'pairwise-v1',
                'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
                'seed': seed
            }

        mock_single_judge.side_effect = mock_judge_side_effect

        result = judge_panel(
            self.scenario,
            self.baseline_bundle,
            self.candidate_bundle,
            self.judge_config
        )

        # Three-way tie resolves to TIE
        self.assertEqual(result['verdict'], 'TIE')
        self.assertEqual(result['majority_count'], 1)
        self.assertFalse(result['judge_unavailable'])

    @patch('optimization.framework.judges.panel.single_judge')
    def test_judge_failure_marks_unavailable(self, mock_single_judge):
        """Test that failures in judge calls mark panel as judge_unavailable."""
        # Mock first two judges to succeed, third to fail
        def mock_judge_side_effect(*args, **kwargs):
            seed = kwargs['seed']
            if seed == 300:
                raise RuntimeError("Judge API call failed")
            return {
                'verdict': 'BASELINE',
                'rationale': 'Test rationale',
                'model_id': 'openai/gpt-5.5',
                'protocol_version': 'pairwise-v1',
                'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
                'seed': seed
            }

        mock_single_judge.side_effect = mock_judge_side_effect

        result = judge_panel(
            self.scenario,
            self.baseline_bundle,
            self.candidate_bundle,
            self.judge_config
        )

        # Should mark as judge_unavailable since only 2 of 3 succeeded
        self.assertIsNone(result['verdict'])
        self.assertTrue(result['judge_unavailable'])
        self.assertEqual(result['majority_count'], 0)

        # Verify individual verdicts include the error
        error_verdict = [v for v in result['individual_verdicts'] if 'error' in v][0]
        self.assertIn('Judge API call failed', error_verdict['error'])

    @patch('optimization.framework.judges.panel.single_judge')
    def test_all_judges_fail(self, mock_single_judge):
        """Test panel when all three judges fail."""
        mock_single_judge.side_effect = RuntimeError("API unavailable")

        result = judge_panel(
            self.scenario,
            self.baseline_bundle,
            self.candidate_bundle,
            self.judge_config
        )

        # Should mark as judge_unavailable
        self.assertIsNone(result['verdict'])
        self.assertTrue(result['judge_unavailable'])
        self.assertEqual(len(result['individual_verdicts']), 3)

        # All verdicts should have errors
        for verdict in result['individual_verdicts']:
            self.assertIsNone(verdict['verdict'])
            self.assertIn('error', verdict)

    def test_invalid_config_wrong_model_count(self):
        """Test that invalid judge_config raises ValueError."""
        bad_config = {
            'model_ids': ['model1', 'model2'],  # Only 2 models
            'protocol_version': 'pairwise-v1',
            'seeds': [100, 200, 300]
        }

        with self.assertRaises(ValueError) as ctx:
            judge_panel(
                self.scenario,
                self.baseline_bundle,
                self.candidate_bundle,
                bad_config
            )

        self.assertIn('exactly 3 model_ids', str(ctx.exception))

    def test_invalid_config_wrong_seed_count(self):
        """Test that invalid seed count raises ValueError."""
        bad_config = {
            'model_ids': ['model1'] * 3,
            'protocol_version': 'pairwise-v1',
            'seeds': [100, 200]  # Only 2 seeds
        }

        with self.assertRaises(ValueError) as ctx:
            judge_panel(
                self.scenario,
                self.baseline_bundle,
                self.candidate_bundle,
                bad_config
            )

        self.assertIn('exactly 3 seeds', str(ctx.exception))

    def test_invalid_config_duplicate_seeds(self):
        """Test that duplicate seeds raise ValueError."""
        bad_config = {
            'model_ids': ['model1'] * 3,
            'protocol_version': 'pairwise-v1',
            'seeds': [100, 100, 200]  # Duplicate seed
        }

        with self.assertRaises(ValueError) as ctx:
            judge_panel(
                self.scenario,
                self.baseline_bundle,
                self.candidate_bundle,
                bad_config
            )

        self.assertIn('must all be different', str(ctx.exception))

    @patch('optimization.framework.judges.panel.single_judge')
    def test_different_model_ids(self, mock_single_judge):
        """Test panel with three different model IDs."""
        mock_single_judge.return_value = {
            'verdict': 'BASELINE',
            'rationale': 'Test rationale',
            'model_id': 'test-model',
            'protocol_version': 'pairwise-v1',
            'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
            'seed': 100
        }

        config = {
            'model_ids': ['model-1', 'model-2', 'model-3'],
            'protocol_version': 'pairwise-v1',
            'seeds': [100, 200, 300]
        }

        result = judge_panel(
            self.scenario,
            self.baseline_bundle,
            self.candidate_bundle,
            config
        )

        # Verify different models were used
        self.assertEqual(mock_single_judge.call_count, 3)
        calls = mock_single_judge.call_args_list
        self.assertEqual(calls[0][1]['judge_model_id'], 'model-1')
        self.assertEqual(calls[1][1]['judge_model_id'], 'model-2')
        self.assertEqual(calls[2][1]['judge_model_id'], 'model-3')


class TestWriteJudgeVerdicts(unittest.TestCase):
    """Test writing judge verdicts to file."""

    def test_write_complete_verdicts(self):
        """Test writing complete panel results to file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, 'judge-verdicts.json')

            panel_result = {
                'verdict': 'BASELINE',
                'individual_verdicts': [
                    {
                        'judge_index': 0,
                        'verdict': 'BASELINE',
                        'rationale': 'Test 1',
                        'model_id': 'model-1',
                        'protocol_version': 'pairwise-v1',
                        'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
                        'seed': 100
                    },
                    {
                        'judge_index': 1,
                        'verdict': 'BASELINE',
                        'rationale': 'Test 2',
                        'model_id': 'model-2',
                        'protocol_version': 'pairwise-v1',
                        'label_mapping': {'A': 'CANDIDATE', 'B': 'BASELINE'},
                        'seed': 200
                    },
                    {
                        'judge_index': 2,
                        'verdict': 'BASELINE',
                        'rationale': 'Test 3',
                        'model_id': 'model-3',
                        'protocol_version': 'pairwise-v1',
                        'label_mapping': {'A': 'BASELINE', 'B': 'CANDIDATE'},
                        'seed': 300
                    }
                ],
                'majority_count': 3,
                'judge_unavailable': False,
                'scenario_id': 'eval-001',
                'protocol_version': 'pairwise-v1'
            }

            write_judge_verdicts(panel_result, output_path)

            # Verify file was created
            self.assertTrue(os.path.exists(output_path))

            # Verify content
            with open(output_path, 'r') as f:
                loaded = json.load(f)

            self.assertEqual(loaded['verdict'], 'BASELINE')
            self.assertEqual(len(loaded['individual_verdicts']), 3)
            self.assertEqual(loaded['majority_count'], 3)
            self.assertFalse(loaded['judge_unavailable'])

    def test_write_creates_directory(self):
        """Test that write_judge_verdicts creates parent directories."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, 'deep', 'nested', 'path', 'judge-verdicts.json')

            panel_result = {
                'verdict': 'TIE',
                'individual_verdicts': [],
                'majority_count': 3,
                'judge_unavailable': False,
                'scenario_id': 'eval-001',
                'protocol_version': 'pairwise-v1'
            }

            write_judge_verdicts(panel_result, output_path)

            # Verify file was created in nested directory
            self.assertTrue(os.path.exists(output_path))


if __name__ == '__main__':
    unittest.main()
