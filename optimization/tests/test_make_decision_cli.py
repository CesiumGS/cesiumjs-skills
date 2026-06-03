#!/usr/bin/env python3
"""Tests for the make-decision.py CLI wrapper.

Tests cover:
- CLI argument parsing and validation
- Input file loading
- Override functionality
- Output file creation
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TestMakeDecisionCLI(unittest.TestCase):
    """Tests for make-decision.py CLI."""

    def setUp(self):
        """Create temporary test files."""
        self.temp_dir = tempfile.mkdtemp()
        self.temp_path = Path(self.temp_dir)

        # Create test input files
        self.check_results_file = self.temp_path / 'check-results.json'
        self.check_results_file.write_text(json.dumps([
            {
                'scenario_id': 'eval-001',
                'checks': [
                    {'check_id': 'code_runs', 'result': 'pass', 'detail': ''}
                ]
            }
        ]))

        self.judge_results_file = self.temp_path / 'judge-results.json'
        self.judge_results_file.write_text(json.dumps([
            {'scenario_id': 'eval-001', 'verdict': 'CANDIDATE', 'judge_unavailable': False}
        ]))

        self.scenario_meta_file = self.temp_path / 'scenario-meta.json'
        self.scenario_meta_file.write_text(json.dumps([
            {
                'scenario_id': 'eval-001',
                'skill': 'cesiumjs-camera',
                'current_hash': 'hash-001',
                'regression_critical': False
            }
        ]))

        self.baselines_file = self.temp_path / 'baselines.json'
        self.baselines_file.write_text(json.dumps({
            'schema_version': '1.0',
            'scenarios': {}
        }))

        self.output_file = self.temp_path / 'decision.json'

        self.cli_path = (
            Path(__file__).resolve().parents[2]
            / 'optimization'
            / 'scripts'
            / 'make-decision.py'
        )

    def test_basic_decision(self):
        """Test making a basic decision without override."""
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', str(self.check_results_file),
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file),
            '--output', str(self.output_file)
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 0)
        self.assertTrue(self.output_file.exists())

        with self.output_file.open() as f:
            decision = json.load(f)

        self.assertEqual(decision['decision'], 'KEEP')
        self.assertEqual(decision['rule_fired'], 'rule_3_more_wins')
        self.assertEqual(decision['counts']['wins'], 1)
        self.assertEqual(decision['counts']['losses'], 0)

    def test_override_keep(self):
        """Test manual override with KEEP decision."""
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', str(self.check_results_file),
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file),
            '--output', str(self.output_file),
            '--override', 'Manual approval due to special circumstances',
            '--override-decision', 'KEEP'
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 0)
        self.assertTrue(self.output_file.exists())

        with self.output_file.open() as f:
            decision = json.load(f)

        self.assertEqual(decision['decision'], 'KEEP')
        self.assertEqual(decision['rule_fired'], 'manual_override')
        self.assertIn('Manual approval', decision['rationale'])
        self.assertIn('MANUAL OVERRIDE', decision['rationale'])

    def test_override_reject(self):
        """Test manual override with REJECT decision."""
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', str(self.check_results_file),
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file),
            '--output', str(self.output_file),
            '--override', 'Rejecting due to security concerns',
            '--override-decision', 'REJECT'
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 0)
        self.assertTrue(self.output_file.exists())

        with self.output_file.open() as f:
            decision = json.load(f)

        self.assertEqual(decision['decision'], 'REJECT')
        self.assertEqual(decision['rule_fired'], 'manual_override')
        self.assertIn('security concerns', decision['rationale'])

    def test_override_without_decision_fails(self):
        """Test that --override requires --override-decision."""
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', str(self.check_results_file),
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file),
            '--output', str(self.output_file),
            '--override', 'Some rationale'
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 1)
        self.assertIn('--override-decision is required', result.stderr)

    def test_override_decision_without_override_fails(self):
        """Test that --override-decision requires --override."""
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', str(self.check_results_file),
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file),
            '--output', str(self.output_file),
            '--override-decision', 'KEEP'
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 1)
        self.assertIn('--override is required', result.stderr)

    def test_missing_input_file_fails(self):
        """Test that missing input file produces error."""
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', '/nonexistent/file.json',
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file),
            '--output', str(self.output_file)
        ], capture_output=True, text=True)

        self.assertEqual(result.returncode, 1)
        self.assertIn('Input file not found', result.stderr)

    def test_default_output_path(self):
        """Test default output path creation."""
        # Use a different working directory for this test
        result = subprocess.run([
            'python3',
            str(self.cli_path),
            'cesiumjs-camera',
            '001',
            '--check-results', str(self.check_results_file),
            '--judge-results', str(self.judge_results_file),
            '--scenario-meta', str(self.scenario_meta_file),
            '--baselines', str(self.baselines_file)
        ], capture_output=True, text=True, cwd=str(self.temp_path))

        self.assertEqual(result.returncode, 0)

        # Check that decision.json was created in default path
        default_path = self.temp_path / 'optimization' / 'results' / 'cesiumjs-camera' / '001' / 'decision.json'
        self.assertTrue(default_path.exists())


if __name__ == '__main__':
    unittest.main()
