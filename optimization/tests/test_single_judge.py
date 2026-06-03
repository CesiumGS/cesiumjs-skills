"""
Tests for the single pairwise judge module.
"""

import unittest
from unittest.mock import patch, MagicMock, mock_open
import json
import tempfile
import os
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from optimization.framework.judges.single import judge, _parse_verdict, _format_console, _format_checks, _load_evidence


class TestVerdicParser(unittest.TestCase):
    """Test verdict parsing from judge responses."""

    def test_parse_direct_json(self):
        """Test parsing direct JSON response."""
        response = '{"verdict": "A", "rationale": "Candidate A is better"}'
        result = _parse_verdict(response)
        self.assertEqual(result['verdict'], 'A')
        self.assertEqual(result['rationale'], 'Candidate A is better')

    def test_parse_json_with_whitespace(self):
        """Test parsing JSON with extra whitespace."""
        response = '''
        {
            "verdict": "B",
            "rationale": "Candidate B has no errors"
        }
        '''
        result = _parse_verdict(response)
        self.assertEqual(result['verdict'], 'B')
        self.assertEqual(result['rationale'], 'Candidate B has no errors')

    def test_parse_json_code_block(self):
        """Test parsing JSON from markdown code block."""
        response = '''
        Here is my verdict:

        ```json
        {
            "verdict": "TIE",
            "rationale": "Both implementations are equivalent"
        }
        ```
        '''
        result = _parse_verdict(response)
        self.assertEqual(result['verdict'], 'TIE')
        self.assertEqual(result['rationale'], 'Both implementations are equivalent')

    def test_parse_invalid_verdict_value(self):
        """Test that invalid verdict values are rejected."""
        response = '{"verdict": "INVALID", "rationale": "Test"}'
        with self.assertRaises(ValueError) as ctx:
            _parse_verdict(response)
        self.assertIn('Invalid verdict value', str(ctx.exception))

    def test_parse_missing_keys(self):
        """Test that missing required keys raise error."""
        response = '{"verdict": "A"}'
        with self.assertRaises(ValueError) as ctx:
            _parse_verdict(response)
        self.assertIn('Could not parse verdict', str(ctx.exception))

    def test_parse_invalid_json(self):
        """Test that invalid JSON raises error."""
        response = 'This is not JSON at all'
        with self.assertRaises(ValueError) as ctx:
            _parse_verdict(response)
        self.assertIn('Could not parse verdict', str(ctx.exception))


class TestFormattingHelpers(unittest.TestCase):
    """Test formatting helper functions."""

    def test_format_console_no_errors(self):
        """Test formatting console data with no errors."""
        console_data = {
            'errors': [],
            'console_messages': [
                {'type': 'log', 'text': 'Viewer initialized'}
            ]
        }
        result = _format_console(console_data)
        self.assertIn('Errors**: None', result)
        self.assertIn('Viewer initialized', result)

    def test_format_console_with_errors(self):
        """Test formatting console data with errors."""
        console_data = {
            'errors': [
                {'text': 'TypeError: cannot read property'},
                {'text': 'ReferenceError: undefined variable'}
            ],
            'console_messages': []
        }
        result = _format_console(console_data)
        self.assertIn('Errors (2)', result)
        self.assertIn('TypeError', result)
        self.assertIn('ReferenceError', result)

    def test_format_checks_all_passing(self):
        """Test formatting checks when all pass."""
        checks_data = {
            'checks': [
                {'check_id': 'code_runs_0', 'type': 'code_runs', 'result': 'pass', 'detail': 'Code executed successfully'},
                {'check_id': 'no_console_errors_0', 'type': 'no_console_errors', 'result': 'pass', 'detail': 'No errors'}
            ],
            'summary': {'total': 2, 'passed': 2, 'failed': 0}
        }
        result = _format_checks(checks_data)
        self.assertIn('[PASS]', result)
        self.assertIn('2/2 passed', result)

    def test_format_checks_some_failing(self):
        """Test formatting checks when some fail."""
        checks_data = {
            'checks': [
                {'check_id': 'code_runs_0', 'type': 'code_runs', 'result': 'pass', 'detail': 'Code executed successfully'},
                {'check_id': 'pattern_present_0', 'type': 'pattern_present', 'result': 'fail', 'detail': 'Pattern not found'}
            ],
            'summary': {'total': 2, 'passed': 1, 'failed': 1}
        }
        result = _format_checks(checks_data)
        self.assertIn('[PASS]', result)
        self.assertIn('[FAIL]', result)
        self.assertIn('1/2 passed', result)
        self.assertIn('1 failed', result)


class TestLabelRandomization(unittest.TestCase):
    """Test label randomization with different seeds."""

    def setUp(self):
        """Set up test fixtures."""
        # Create temporary bundle directories with minimal evidence
        self.temp_dir = tempfile.mkdtemp()

        # Create baseline bundle
        self.baseline_dir = Path(self.temp_dir) / 'baseline'
        self.baseline_dir.mkdir()

        # Create candidate bundle
        self.candidate_dir = Path(self.temp_dir) / 'candidate'
        self.candidate_dir.mkdir()

        # Create minimal evidence files for both bundles
        for bundle_dir in [self.baseline_dir, self.candidate_dir]:
            # console.json
            with open(bundle_dir / 'console.json', 'w') as f:
                json.dump({'errors': [], 'console_messages': []}, f)

            # programmatic-checks.json
            with open(bundle_dir / 'programmatic-checks.json', 'w') as f:
                json.dump({
                    'checks': [
                        {'check_id': 'code_runs_0', 'type': 'code_runs', 'result': 'pass', 'detail': 'OK'}
                    ],
                    'summary': {'total': 1, 'passed': 1, 'failed': 0}
                }, f)

            # scene-state.json
            with open(bundle_dir / 'scene-state.json', 'w') as f:
                json.dump({'available': True, 'camera': {'position': [0, 0, 0]}}, f)

            # screenshot.png (empty file)
            (bundle_dir / 'screenshot.png').touch()

    def tearDown(self):
        """Clean up test fixtures."""
        import shutil
        shutil.rmtree(self.temp_dir)

    @patch('optimization.framework.judges.single.ensure_cli_available', return_value='/usr/local/bin/claude')
    @patch('optimization.framework.judges.single.invoke_claude')
    def test_label_randomization_seed_1(self, mock_invoke, mock_ensure):
        """Test that seed 1 produces consistent label mapping."""
        mock_invoke.return_value = '{"verdict": "A", "rationale": "A is better"}'

        scenario = {
            'id': 'eval-001',
            'name': 'test',
            'description': 'Test scenario',
            'prompt': 'Test prompt',
            'expected_behaviors': ['Test behavior'],
            'visual_expectations': 'Test expectations'
        }

        result = judge(
            scenario,
            {'path': str(self.baseline_dir)},
            {'path': str(self.candidate_dir)},
            'sonnet',
            'pairwise-v1',
            seed=1
        )

        self.assertIn('label_mapping', result)
        self.assertEqual(result['seed'], 1)
        self.assertIn('A', result['label_mapping'])
        self.assertIn('B', result['label_mapping'])
        expected_verdict = result['label_mapping']['A']
        self.assertEqual(result['verdict'], expected_verdict)

    @patch('optimization.framework.judges.single.ensure_cli_available', return_value='/usr/local/bin/claude')
    @patch('optimization.framework.judges.single.invoke_claude')
    def test_label_randomization_seed_2(self, mock_invoke, mock_ensure):
        """Test that seed 2 produces consistent but different label mapping."""
        mock_invoke.return_value = '{"verdict": "A", "rationale": "A is better"}'

        scenario = {
            'id': 'eval-001',
            'name': 'test',
            'description': 'Test scenario',
            'prompt': 'Test prompt',
            'expected_behaviors': ['Test behavior'],
            'visual_expectations': 'Test expectations'
        }

        result = judge(
            scenario,
            {'path': str(self.baseline_dir)},
            {'path': str(self.candidate_dir)},
            'sonnet',
            'pairwise-v1',
            seed=2
        )

        self.assertIn('label_mapping', result)
        self.assertEqual(result['seed'], 2)

    @patch('optimization.framework.judges.single.ensure_cli_available', return_value='/usr/local/bin/claude')
    @patch('optimization.framework.judges.single.invoke_claude')
    def test_multiple_calls_same_seed_consistent(self, mock_invoke, mock_ensure):
        """Test that same seed produces same label mapping across calls."""
        mock_invoke.return_value = '{"verdict": "A", "rationale": "A is better"}'

        scenario = {
            'id': 'eval-001',
            'name': 'test',
            'description': 'Test scenario',
            'prompt': 'Test prompt',
            'expected_behaviors': ['Test behavior'],
            'visual_expectations': 'Test expectations'
        }

        result1 = judge(
            scenario,
            {'path': str(self.baseline_dir)},
            {'path': str(self.candidate_dir)},
            'sonnet',
            'pairwise-v1',
            seed=42
        )
        result2 = judge(
            scenario,
            {'path': str(self.baseline_dir)},
            {'path': str(self.candidate_dir)},
            'sonnet',
            'pairwise-v1',
            seed=42
        )

        self.assertEqual(result1['label_mapping'], result2['label_mapping'])

    @patch('optimization.framework.judges.single.ensure_cli_available', return_value='/usr/local/bin/claude')
    @patch('optimization.framework.judges.single.invoke_claude')
    def test_tie_verdict_not_remapped(self, mock_invoke, mock_ensure):
        """Test that TIE verdict is not remapped."""
        mock_invoke.return_value = '{"verdict": "TIE", "rationale": "Both equal"}'

        scenario = {
            'id': 'eval-001',
            'name': 'test',
            'description': 'Test scenario',
            'prompt': 'Test prompt',
            'expected_behaviors': ['Test behavior'],
            'visual_expectations': 'Test expectations'
        }

        result = judge(
            scenario,
            {'path': str(self.baseline_dir)},
            {'path': str(self.candidate_dir)},
            'sonnet',
            'pairwise-v1',
            seed=1
        )

        self.assertEqual(result['verdict'], 'TIE')


class TestJudgeFunction(unittest.TestCase):
    """Test the main judge function."""

    @patch('optimization.framework.judges.single.ensure_cli_available')
    def test_missing_cli(self, mock_ensure):
        """Test that missing claude CLI raises ClaudeCLINotFoundError."""
        from optimization.framework.adapters.claude_cli import ClaudeCLINotFoundError
        mock_ensure.side_effect = ClaudeCLINotFoundError("claude not found")
        with self.assertRaises(ClaudeCLINotFoundError):
            judge(
                {},
                {'path': '/fake/baseline'},
                {'path': '/fake/candidate'},
                'sonnet',
                'pairwise-v1',
                seed=1
            )

    @patch('optimization.framework.judges.single.ensure_cli_available', return_value='/usr/local/bin/claude')
    def test_invalid_protocol_version(self, mock_ensure):
        """Test that invalid protocol version raises error."""
        with self.assertRaises(ValueError) as ctx:
            judge(
                {},
                {'path': '/fake/baseline'},
                {'path': '/fake/candidate'},
                'sonnet',
                'invalid-v99',
                seed=1
            )
        self.assertIn('Unsupported protocol version', str(ctx.exception))

    @patch('optimization.framework.judges.single.ensure_cli_available', return_value='/usr/local/bin/claude')
    def test_missing_bundle_directory(self, mock_ensure):
        """Test that missing bundle directory raises error."""
        scenario = {
            'id': 'eval-001',
            'name': 'test',
            'description': 'Test scenario',
            'prompt': 'Test prompt',
            'expected_behaviors': [],
            'visual_expectations': 'Test'
        }
        with self.assertRaises(ValueError) as ctx:
            judge(
                scenario,
                {'path': '/nonexistent/baseline'},
                {'path': '/nonexistent/candidate'},
                'sonnet',
                'pairwise-v1',
                seed=1
            )
        self.assertIn('not found', str(ctx.exception))


class TestLoadEvidence(unittest.TestCase):
    """Test evidence loading from bundle directories."""

    def setUp(self):
        """Set up test bundle."""
        self.temp_dir = tempfile.mkdtemp()
        self.bundle_dir = Path(self.temp_dir) / 'bundle'
        self.bundle_dir.mkdir()

    def tearDown(self):
        """Clean up test bundle."""
        import shutil
        shutil.rmtree(self.temp_dir)

    def test_load_complete_evidence(self):
        """Test loading a complete evidence bundle."""
        # Create all required files
        with open(self.bundle_dir / 'console.json', 'w') as f:
            json.dump({'errors': [], 'console_messages': []}, f)

        with open(self.bundle_dir / 'programmatic-checks.json', 'w') as f:
            json.dump({'checks': [], 'summary': {}}, f)

        with open(self.bundle_dir / 'scene-state.json', 'w') as f:
            json.dump({'available': True}, f)

        (self.bundle_dir / 'screenshot.png').touch()

        # Load evidence
        evidence = _load_evidence(str(self.bundle_dir))

        self.assertIn('console', evidence)
        self.assertIn('checks', evidence)
        self.assertIn('scene_state', evidence)
        self.assertIn('screenshots', evidence)
        self.assertEqual(len(evidence['screenshots']), 1)

    def test_load_multiple_screenshots(self):
        """Test loading bundle with multiple screenshots."""
        # Create required files
        with open(self.bundle_dir / 'console.json', 'w') as f:
            json.dump({'errors': [], 'console_messages': []}, f)

        with open(self.bundle_dir / 'programmatic-checks.json', 'w') as f:
            json.dump({'checks': [], 'summary': {}}, f)

        # Create multiple screenshots
        (self.bundle_dir / 'screenshot-0.png').touch()
        (self.bundle_dir / 'screenshot-1.png').touch()
        (self.bundle_dir / 'screenshot-2.png').touch()

        # Load evidence
        evidence = _load_evidence(str(self.bundle_dir))

        self.assertEqual(len(evidence['screenshots']), 3)

    def test_load_missing_console(self):
        """Test that missing console.json raises error."""
        with self.assertRaises(ValueError) as ctx:
            _load_evidence(str(self.bundle_dir))
        self.assertIn('console.json not found', str(ctx.exception))

    def test_load_missing_checks(self):
        """Test that missing programmatic-checks.json raises error."""
        # Create console.json but not checks
        with open(self.bundle_dir / 'console.json', 'w') as f:
            json.dump({'errors': [], 'console_messages': []}, f)

        with self.assertRaises(ValueError) as ctx:
            _load_evidence(str(self.bundle_dir))
        self.assertIn('programmatic-checks.json not found', str(ctx.exception))

    def test_load_missing_screenshots(self):
        """Test that missing screenshots raises error."""
        # Create console and checks but no screenshots
        with open(self.bundle_dir / 'console.json', 'w') as f:
            json.dump({'errors': [], 'console_messages': []}, f)

        with open(self.bundle_dir / 'programmatic-checks.json', 'w') as f:
            json.dump({'checks': [], 'summary': {}}, f)

        with self.assertRaises(ValueError) as ctx:
            _load_evidence(str(self.bundle_dir))
        self.assertIn('No screenshots found', str(ctx.exception))

    def test_load_optional_scene_state(self):
        """Test that missing scene-state.json uses fallback."""
        # Create required files but not scene-state.json
        with open(self.bundle_dir / 'console.json', 'w') as f:
            json.dump({'errors': [], 'console_messages': []}, f)

        with open(self.bundle_dir / 'programmatic-checks.json', 'w') as f:
            json.dump({'checks': [], 'summary': {}}, f)

        (self.bundle_dir / 'screenshot.png').touch()

        # Load evidence
        evidence = _load_evidence(str(self.bundle_dir))

        # Should have fallback scene state
        self.assertEqual(evidence['scene_state'], {'available': False})


if __name__ == '__main__':
    unittest.main()
