#!/usr/bin/env python3
"""Tests for optimization/scripts/generate-report.py"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Import functions from generate-report script
import sys
import importlib.util

# Load the script as a module
script_path = Path(__file__).resolve().parents[2] / "optimization" / "scripts" / "generate-report.py"
spec = importlib.util.spec_from_file_location("generate_report", script_path)
generate_report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generate_report)

# Import functions
compute_scores = generate_report.compute_scores
count_wins_losses_ties = generate_report.count_wins_losses_ties
format_check_result = generate_report.format_check_result
generate_summary_md = generate_report.generate_summary_md
update_public_status = generate_report.update_public_status
validate_public_safety = generate_report.validate_public_safety


class TestComputeScores(unittest.TestCase):
    """Test score computation functions."""

    def test_empty_results(self):
        """Test with no results."""
        scores = compute_scores([], [], [])
        self.assertEqual(scores["programmatic_correctness"], 0.0)
        self.assertEqual(scores["api_accuracy"], 1.0)  # Default to 1.0 when no API checks exist
        self.assertEqual(scores["visual_win_rate"], 0.0)
        self.assertEqual(scores["coverage_delta"], 0.0)

    def test_all_checks_passing(self):
        """Test with all checks passing."""
        check_results = [
            {
                "scenario_id": "eval-001",
                "checks": [
                    {"type": "code_runs", "result": "pass"},
                    {"type": "no_console_errors", "result": "pass"}
                ]
            },
            {
                "scenario_id": "eval-002",
                "checks": [
                    {"type": "code_runs", "result": "pass"}
                ]
            }
        ]
        scores = compute_scores(check_results, [], [])
        self.assertEqual(scores["programmatic_correctness"], 1.0)

    def test_some_checks_failing(self):
        """Test with some checks failing."""
        check_results = [
            {
                "scenario_id": "eval-001",
                "checks": [
                    {"type": "code_runs", "result": "pass"},
                    {"type": "no_console_errors", "result": "fail"}
                ]
            },
            {
                "scenario_id": "eval-002",
                "checks": [
                    {"type": "code_runs", "result": "pass"}
                ]
            }
        ]
        scores = compute_scores(check_results, [], [])
        # Only 1 of 2 scenarios passes all checks
        self.assertEqual(scores["programmatic_correctness"], 0.5)

    def test_api_accuracy_all_passing(self):
        """Test API accuracy with all api_present checks passing."""
        check_results = [
            {
                "scenario_id": "eval-001",
                "checks": [
                    {"type": "api_present", "result": "pass"},
                    {"type": "code_runs", "result": "pass"}
                ]
            },
            {
                "scenario_id": "eval-002",
                "checks": [
                    {"type": "api_present", "result": "pass"}
                ]
            }
        ]
        scores = compute_scores(check_results, [], [])
        self.assertEqual(scores["api_accuracy"], 1.0)

    def test_api_accuracy_some_failing(self):
        """Test API accuracy with some api_present checks failing."""
        check_results = [
            {
                "scenario_id": "eval-001",
                "checks": [
                    {"type": "api_present", "result": "fail"},
                    {"type": "code_runs", "result": "pass"}
                ]
            },
            {
                "scenario_id": "eval-002",
                "checks": [
                    {"type": "api_present", "result": "pass"}
                ]
            }
        ]
        scores = compute_scores(check_results, [], [])
        # 1 of 2 scenarios with api_present checks passes
        self.assertEqual(scores["api_accuracy"], 0.5)

    def test_api_accuracy_no_api_checks(self):
        """Test API accuracy when no scenarios have api_present checks."""
        check_results = [
            {
                "scenario_id": "eval-001",
                "checks": [
                    {"type": "code_runs", "result": "pass"}
                ]
            }
        ]
        scores = compute_scores(check_results, [], [])
        # When no API checks exist, default to 1.0
        self.assertEqual(scores["api_accuracy"], 1.0)

    def test_visual_win_rate_all_wins(self):
        """Test visual win rate with all candidate wins."""
        judge_results = [
            {"scenario_id": "eval-001", "verdict": "CANDIDATE", "judge_unavailable": False},
            {"scenario_id": "eval-002", "verdict": "CANDIDATE", "judge_unavailable": False}
        ]
        scores = compute_scores([], judge_results, [])
        self.assertEqual(scores["visual_win_rate"], 1.0)

    def test_visual_win_rate_mixed(self):
        """Test visual win rate with mixed results."""
        judge_results = [
            {"scenario_id": "eval-001", "verdict": "CANDIDATE", "judge_unavailable": False},
            {"scenario_id": "eval-002", "verdict": "BASELINE", "judge_unavailable": False},
            {"scenario_id": "eval-003", "verdict": "TIE", "judge_unavailable": False}
        ]
        scores = compute_scores([], judge_results, [])
        # 1 win out of 3 judged scenarios
        self.assertAlmostEqual(scores["visual_win_rate"], 0.3333, places=4)

    def test_visual_win_rate_with_unavailable(self):
        """Test visual win rate excludes unavailable judges."""
        judge_results = [
            {"scenario_id": "eval-001", "verdict": "CANDIDATE", "judge_unavailable": False},
            {"scenario_id": "eval-002", "verdict": "BASELINE", "judge_unavailable": True},
            {"scenario_id": "eval-003", "verdict": "CANDIDATE", "judge_unavailable": False}
        ]
        scores = compute_scores([], judge_results, [])
        # 2 wins out of 2 judged scenarios (eval-002 excluded)
        self.assertEqual(scores["visual_win_rate"], 1.0)


class TestCountWinsLossesTies(unittest.TestCase):
    """Test win/loss/tie counting."""

    def test_all_wins(self):
        """Test counting all wins."""
        judge_results = [
            {"verdict": "CANDIDATE"},
            {"verdict": "CANDIDATE"}
        ]
        counts = count_wins_losses_ties(judge_results)
        self.assertEqual(counts["wins"], 2)
        self.assertEqual(counts["losses"], 0)
        self.assertEqual(counts["ties"], 0)

    def test_mixed_results(self):
        """Test counting mixed results."""
        judge_results = [
            {"verdict": "CANDIDATE"},
            {"verdict": "BASELINE"},
            {"verdict": "TIE"}
        ]
        counts = count_wins_losses_ties(judge_results)
        self.assertEqual(counts["wins"], 1)
        self.assertEqual(counts["losses"], 1)
        self.assertEqual(counts["ties"], 1)

    def test_exclude_unavailable(self):
        """Test that unavailable judges are excluded."""
        judge_results = [
            {"verdict": "CANDIDATE", "judge_unavailable": False},
            {"verdict": "BASELINE", "judge_unavailable": True},
            {"verdict": "TIE", "judge_unavailable": False}
        ]
        counts = count_wins_losses_ties(judge_results)
        self.assertEqual(counts["wins"], 1)
        self.assertEqual(counts["losses"], 0)
        self.assertEqual(counts["ties"], 1)


class TestFormatCheckResult(unittest.TestCase):
    """Test check result formatting."""

    def test_passing_check(self):
        """Test formatting a passing check."""
        check = {
            "result": "pass",
            "type": "code_runs",
            "description": "No runtime exceptions"
        }
        formatted = format_check_result(check)
        self.assertIn("✓", formatted)
        self.assertIn("code_runs", formatted)
        self.assertIn("No runtime exceptions", formatted)

    def test_failing_check(self):
        """Test formatting a failing check."""
        check = {
            "result": "fail",
            "type": "no_console_errors",
            "description": "Console errors detected"
        }
        formatted = format_check_result(check)
        self.assertIn("✗", formatted)
        self.assertIn("no_console_errors", formatted)


class TestGenerateSummaryMd(unittest.TestCase):
    """Test summary.md generation."""

    def test_basic_summary(self):
        """Test generating a basic summary."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "summary.md"

            decision_result = {
                "decision": "KEEP",
                "rule_fired": "rule_3_more_wins",
                "rationale": "Candidate has more wins",
                "counts": {"wins": 2, "losses": 0, "ties": 1}
            }

            check_results = [
                {
                    "scenario_id": "eval-001",
                    "checks": [
                        {"type": "code_runs", "result": "pass", "description": "No errors"}
                    ]
                }
            ]

            judge_results = [
                {
                    "scenario_id": "eval-001",
                    "verdict": "CANDIDATE",
                    "majority_count": 3
                }
            ]

            scenarios = [
                {"id": "eval-001", "name": "test-scenario"}
            ]

            scores = {
                "programmatic_correctness": 1.0,
                "api_accuracy": 1.0,
                "visual_win_rate": 1.0,
                "coverage_delta": 0.0
            }

            generate_summary_md(
                "test-skill",
                "001",
                decision_result,
                check_results,
                judge_results,
                scenarios,
                scores,
                output_path
            )

            self.assertTrue(output_path.exists())
            content = output_path.read_text()
            self.assertIn("test-skill", content)
            self.assertIn("KEEP", content)
            self.assertIn("eval-001", content)
            self.assertIn("test-scenario", content)
            self.assertIn("✓", content)  # Check mark for passing check

    def test_summary_with_rebaseline(self):
        """Test summary with rebaseline required."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "summary.md"

            decision_result = {
                "decision": "REJECT",
                "rule_fired": "rule_1_critical_check_failure",
                "rationale": "Critical check failed",
                "counts": {"wins": 0, "losses": 1, "ties": 0},
                "rebaseline_required": ["eval-002", "eval-003"]
            }

            generate_summary_md(
                "test-skill",
                "001",
                decision_result,
                [],
                [],
                [],
                {"programmatic_correctness": 0.0, "api_accuracy": 0.0, "visual_win_rate": 0.0, "coverage_delta": 0.0},
                output_path
            )

            content = output_path.read_text()
            self.assertIn("Rebaseline Required", content)
            self.assertIn("eval-002", content)
            self.assertIn("eval-003", content)


class TestUpdatePublicStatus(unittest.TestCase):
    """Test public-status.json updates."""

    def test_create_new_public_status(self):
        """Test creating a new public-status.json."""
        with tempfile.TemporaryDirectory() as tmpdir:
            public_status_path = Path(tmpdir) / "public-status.json"

            decision_result = {
                "decision": "KEEP",
                "counts": {"wins": 2, "losses": 0, "ties": 1},
                "rationale": "Test rationale"
            }

            scores = {
                "programmatic_correctness": 1.0,
                "api_accuracy": 1.0,
                "visual_win_rate": 0.67,
                "coverage_delta": 0.0
            }

            scenarios = [
                {"id": "eval-001", "runner_mode": "global-js"},
                {"id": "eval-002", "runner_mode": "global-js"}
            ]

            update_public_status(
                "test-skill",
                "001",
                decision_result,
                scores,
                scenarios,
                public_status_path
            )

            self.assertTrue(public_status_path.exists())
            with public_status_path.open() as f:
                data = json.load(f)

            self.assertEqual(data["schema_version"], "1.0")
            self.assertEqual(len(data["skills"]), 1)
            self.assertEqual(data["skills"][0]["skill"], "test-skill")
            self.assertEqual(data["skills"][0]["scenario_count"], 2)

    def test_update_existing_skill(self):
        """Test updating an existing skill in public-status.json."""
        with tempfile.TemporaryDirectory() as tmpdir:
            public_status_path = Path(tmpdir) / "public-status.json"

            # Create initial status
            initial_data = {
                "schema_version": "1.0",
                "summary_type": "public-sanitized-eval-status",
                "skills": [
                    {
                        "skill": "test-skill",
                        "scenario_count": 1,
                        "current_best": {"iteration": "000"},
                        "latest_reviewed_decision": {},
                        "runner_mode_counts": {}
                    }
                ]
            }
            with public_status_path.open("w") as f:
                json.dump(initial_data, f)

            decision_result = {
                "decision": "KEEP",
                "counts": {"wins": 2, "losses": 0, "ties": 1},
                "rationale": "Test rationale"
            }

            scores = {
                "programmatic_correctness": 1.0,
                "api_accuracy": 1.0,
                "visual_win_rate": 0.67,
                "coverage_delta": 0.0
            }

            scenarios = [
                {"id": "eval-001"},
                {"id": "eval-002"}
            ]

            update_public_status(
                "test-skill",
                "001",
                decision_result,
                scores,
                scenarios,
                public_status_path
            )

            with public_status_path.open() as f:
                data = json.load(f)

            # Should still have 1 skill (updated, not added)
            self.assertEqual(len(data["skills"]), 1)
            self.assertEqual(data["skills"][0]["scenario_count"], 2)
            self.assertEqual(data["skills"][0]["current_best"]["iteration"], "001")

    def test_reject_decision_no_best_update(self):
        """Test that REJECT decisions don't update current_best."""
        with tempfile.TemporaryDirectory() as tmpdir:
            public_status_path = Path(tmpdir) / "public-status.json"

            # Create initial status with current best
            initial_data = {
                "schema_version": "1.0",
                "summary_type": "public-sanitized-eval-status",
                "skills": [
                    {
                        "skill": "test-skill",
                        "scenario_count": 2,
                        "current_best": {"iteration": "000", "wins": 5},
                        "latest_reviewed_decision": {},
                        "runner_mode_counts": {}
                    }
                ]
            }
            with public_status_path.open("w") as f:
                json.dump(initial_data, f)

            decision_result = {
                "decision": "REJECT",
                "counts": {"wins": 0, "losses": 2, "ties": 0},
                "rationale": "Test rejection"
            }

            scores = {"programmatic_correctness": 0.0, "api_accuracy": 0.0, "visual_win_rate": 0.0, "coverage_delta": 0.0}

            update_public_status(
                "test-skill",
                "001",
                decision_result,
                scores,
                [],
                public_status_path
            )

            with public_status_path.open() as f:
                data = json.load(f)

            # current_best should still be iteration 000
            self.assertEqual(data["skills"][0]["current_best"]["iteration"], "000")
            self.assertEqual(data["skills"][0]["current_best"]["wins"], 5)

    def test_reject_decision_clears_same_iteration_best(self):
        """Test that a rejected iteration cannot remain current_best."""
        with tempfile.TemporaryDirectory() as tmpdir:
            public_status_path = Path(tmpdir) / "public-status.json"
            initial_data = {
                "schema_version": "1.0",
                "summary_type": "public-sanitized-eval-status",
                "skills": [
                    {
                        "skill": "test-skill",
                        "scenario_count": 2,
                        "current_best": {"iteration": "001", "wins": 5},
                        "latest_reviewed_decision": {},
                        "runner_mode_counts": {}
                    }
                ]
            }
            with public_status_path.open("w") as f:
                json.dump(initial_data, f)

            decision_result = {
                "decision": "REJECT",
                "counts": {"wins": 0, "losses": 2, "ties": 0},
                "rationale": "Test rejection"
            }
            scores = {"programmatic_correctness": 0.0, "api_accuracy": 0.0, "visual_win_rate": 0.0, "coverage_delta": 0.0}

            update_public_status(
                "test-skill",
                "001",
                decision_result,
                scores,
                [],
                public_status_path
            )

            with public_status_path.open() as f:
                data = json.load(f)

            self.assertEqual(data["skills"][0]["current_best"], {})


class TestValidatePublicSafety(unittest.TestCase):
    """Test public safety validation."""

    @patch('subprocess.run')
    def test_validation_passes(self, mock_run):
        """Test successful validation."""
        mock_run.return_value = MagicMock(returncode=0)
        result = validate_public_safety(Path("/tmp/test.json"))
        self.assertTrue(result)

    @patch('subprocess.run')
    def test_validation_fails(self, mock_run):
        """Test failed validation."""
        mock_run.return_value = MagicMock(returncode=1)
        result = validate_public_safety(Path("/tmp/test.json"))
        self.assertFalse(result)

    @patch('subprocess.run')
    def test_validation_exception(self, mock_run):
        """Test validation with exception."""
        mock_run.side_effect = Exception("Test exception")
        result = validate_public_safety(Path("/tmp/test.json"))
        self.assertFalse(result)


class TestScoreRounding(unittest.TestCase):
    """Test that scores are properly rounded to 4 decimal places."""

    def test_score_rounding(self):
        """Test score rounding."""
        check_results = [
            {"scenario_id": "eval-001", "checks": [{"result": "pass"}]},
            {"scenario_id": "eval-002", "checks": [{"result": "fail"}]},
            {"scenario_id": "eval-003", "checks": [{"result": "pass"}]}
        ]
        scores = compute_scores(check_results, [], [])
        # 2/3 = 0.6666...
        self.assertEqual(scores["programmatic_correctness"], 0.6667)


if __name__ == "__main__":
    unittest.main()
