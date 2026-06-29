"""
Tests for optimization/scripts/run-loop.py - autonomous iteration loop.
"""

import json
import sys
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import importlib.util

import pytest


def load_run_loop():
    """Load run-loop.py as a module."""
    script_path = Path(__file__).resolve().parents[2] / "optimization" / "scripts" / "run-loop.py"
    spec = importlib.util.spec_from_file_location("run_loop", script_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_loop"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def run_loop():
    """Provide run_loop module."""
    return load_run_loop()


@pytest.fixture
def mock_args(run_loop):
    """Provide mock arguments namespace."""
    return run_loop.argparse.Namespace(
        skill="cesiumjs-camera",
        max_iterations=5,
        stop_on="max",
        plateau_n=3,
        proposer_model="openai/gpt-5.5",
        proposer_variant="high",
        proposer_temperature=1.0,
        proposer_history=3,
        eval_model="openai/gpt-5.5",
        eval_variant="medium",
        eval_temperature=1.0,
        judge_model="openai/gpt-5.5",
        judge_variant="medium",
        judge_protocol="pairwise-v1",
    )


class TestGetNextIteration:
    """Tests for get_next_iteration()."""

    def test_first_iteration_no_directory(self, run_loop, tmp_path):
        """First iteration when candidates directory doesn't exist."""
        with patch("run_loop.Path", return_value=tmp_path / "nonexistent"):
            result = run_loop.get_next_iteration("cesiumjs-camera")
            assert result == "001"

    def test_first_iteration_empty_directory(self, run_loop, tmp_path):
        """First iteration when candidates directory is empty."""
        candidates_dir = tmp_path / "optimization" / "candidates" / "cesiumjs-camera"
        candidates_dir.mkdir(parents=True)

        with patch("run_loop.Path") as mock_path:
            mock_path.return_value = candidates_dir
            result = run_loop.get_next_iteration("cesiumjs-camera")
            assert result == "001"

    def test_next_iteration(self, run_loop, tmp_path, monkeypatch):
        """Next iteration increments from existing."""
        candidates_dir = tmp_path / "optimization" / "candidates" / "cesiumjs-camera"
        candidates_dir.mkdir(parents=True)
        (candidates_dir / "001").mkdir()
        (candidates_dir / "002").mkdir()

        # Mock Path constructor to return our tmp_path-based directory
        original_path = Path

        def mock_path_constructor(path_str):
            if "cesiumjs-camera" in str(path_str):
                return candidates_dir
            return original_path(path_str)

        with patch("run_loop.Path", side_effect=mock_path_constructor):
            result = run_loop.get_next_iteration("cesiumjs-camera")
            assert result == "003"

    def test_non_sequential_iterations(self, run_loop, tmp_path):
        """Next iteration handles non-sequential existing iterations."""
        candidates_dir = tmp_path / "optimization" / "candidates" / "cesiumjs-camera"
        candidates_dir.mkdir(parents=True)
        (candidates_dir / "001").mkdir()
        (candidates_dir / "005").mkdir()
        (candidates_dir / "003").mkdir()

        original_path = Path

        def mock_path_constructor(path_str):
            if "cesiumjs-camera" in str(path_str):
                return candidates_dir
            return original_path(path_str)

        with patch("run_loop.Path", side_effect=mock_path_constructor):
            result = run_loop.get_next_iteration("cesiumjs-camera")
            assert result == "006"  # Max + 1


class TestStoppingConditions:
    """Tests for check_stopping_condition()."""

    def test_max_iterations_not_reached(self, run_loop, mock_args):
        """Continue when max iterations not reached."""
        should_stop, reason = run_loop.check_stopping_condition(3, 0, None, mock_args)
        assert should_stop is False
        assert reason is None

    def test_max_iterations_reached(self, run_loop, mock_args):
        """Stop when max iterations reached."""
        should_stop, reason = run_loop.check_stopping_condition(5, 0, None, mock_args)
        assert should_stop is True
        assert "max iterations" in reason.lower()

    def test_plateau_not_triggered(self, run_loop, mock_args):
        """Continue when plateau threshold not reached."""
        mock_args.stop_on = "plateau"
        should_stop, reason = run_loop.check_stopping_condition(2, 2, "TIE", mock_args)
        assert should_stop is False

    def test_plateau_triggered(self, run_loop, mock_args):
        """Stop when plateau threshold reached."""
        mock_args.stop_on = "plateau"
        should_stop, reason = run_loop.check_stopping_condition(3, 3, "TIE", mock_args)
        assert should_stop is True
        assert "plateau" in reason.lower()

    def test_regression_not_triggered(self, run_loop, mock_args):
        """Continue when no rejection."""
        mock_args.stop_on = "regression"
        should_stop, reason = run_loop.check_stopping_condition(2, 0, "KEEP", mock_args)
        assert should_stop is False

    def test_regression_triggered(self, run_loop, mock_args):
        """Stop on first REJECT when stop_on=regression."""
        mock_args.stop_on = "regression"
        should_stop, reason = run_loop.check_stopping_condition(2, 0, "REJECT", mock_args)
        assert should_stop is True
        assert "reject" in reason.lower()

    def test_sigint_flag(self, run_loop, mock_args):
        """Stop when SIGINT flag set."""
        run_loop._stop_requested = True
        should_stop, reason = run_loop.check_stopping_condition(2, 0, None, mock_args)
        assert should_stop is True
        assert "sigint" in reason.lower()
        # Reset flag
        run_loop._stop_requested = False


class TestGetBaselineDir:
    """Tests for get_baseline_dir()."""

    def test_first_iteration_no_baseline(self, run_loop, tmp_path, monkeypatch):
        """First iteration has no baseline."""
        monkeypatch.chdir(tmp_path)
        result = run_loop.get_baseline_dir("cesiumjs-camera", "001")
        assert result is None

    def test_first_iteration_uses_current_best_baseline(self, run_loop, tmp_path, monkeypatch):
        """First iteration uses precomputed current-best baseline evidence."""
        monkeypatch.chdir(tmp_path)
        baseline_dir = tmp_path / "optimization" / "runs" / "cesiumjs-camera" / "baseline"
        baseline_dir.mkdir(parents=True)

        result = run_loop.get_baseline_dir("cesiumjs-camera", "001")

        assert result == Path("optimization/runs/cesiumjs-camera/baseline")

    def test_second_iteration_no_history(self, run_loop, tmp_path):
        """Second iteration with no history returns None."""
        with patch("run_loop.Path") as mock_path:
            mock_path.return_value = tmp_path / "nonexistent"
            result = run_loop.get_baseline_dir("cesiumjs-camera", "002")
            assert result is None

    def test_finds_most_recent_keep(self, run_loop, tmp_path, monkeypatch):
        """Finds most recent KEEP'd iteration as baseline."""
        monkeypatch.chdir(tmp_path)

        history_dir = tmp_path / "optimization" / "history" / "cesiumjs-camera"
        history_dir.mkdir(parents=True)

        # Create iteration-001 with KEEP
        iter_001 = history_dir / "iteration-001"
        iter_001.mkdir()
        (iter_001 / "decision.json").write_text(json.dumps({"decision": "KEEP"}))

        # Create iteration-002 with REJECT
        iter_002 = history_dir / "iteration-002"
        iter_002.mkdir()
        (iter_002 / "decision.json").write_text(json.dumps({"decision": "REJECT"}))

        # Create corresponding runs directories
        runs_dir = tmp_path / "optimization" / "runs" / "cesiumjs-camera"
        runs_dir.mkdir(parents=True)
        (runs_dir / "001").mkdir()
        (runs_dir / "002").mkdir()

        result = run_loop.get_baseline_dir("cesiumjs-camera", "003")
        # Should find iteration-001 (most recent KEEP)
        assert result is not None
        assert "001" in str(result)


class TestFindBundle:
    """Tests for find_bundle()."""

    def test_exact_match(self, run_loop, tmp_path):
        """Finds bundle with exact name match."""
        runs_dir = tmp_path / "runs"
        runs_dir.mkdir()
        bundle = runs_dir / "eval-001-test-scenario"
        bundle.mkdir()

        result = run_loop.find_bundle(runs_dir, "eval-001", "test-scenario")
        assert result == bundle

    def test_prefix_match(self, run_loop, tmp_path):
        """Finds bundle with scenario_id prefix."""
        runs_dir = tmp_path / "runs"
        runs_dir.mkdir()
        bundle = runs_dir / "eval-001-some-other-name"
        bundle.mkdir()

        result = run_loop.find_bundle(runs_dir, "eval-001", "test-scenario")
        assert result == bundle

    def test_not_found(self, run_loop, tmp_path):
        """Returns None when bundle not found."""
        runs_dir = tmp_path / "runs"
        runs_dir.mkdir()

        result = run_loop.find_bundle(runs_dir, "eval-001", "test-scenario")
        assert result is None


class TestArchiveIteration:
    """Tests for archive_iteration()."""

    def test_archives_successfully(self, run_loop, tmp_path, monkeypatch):
        """Archives iteration files to history directory."""
        monkeypatch.chdir(tmp_path)

        # Setup source files
        results_dir = tmp_path / "optimization" / "results" / "cesiumjs-camera" / "001"
        results_dir.mkdir(parents=True)
        (results_dir / "decision.json").write_text(json.dumps({"decision": "KEEP"}))
        (results_dir / "summary.md").write_text("# Summary\n")
        (results_dir / "journal.jsonl").write_text('{"event":"iteration_started"}\n')

        # Run archive
        run_loop.archive_iteration("cesiumjs-camera", "001", "KEEP")

        # Check archive created
        history_dir = tmp_path / "optimization" / "history" / "cesiumjs-camera" / "iteration-001"
        assert history_dir.exists()
        assert (history_dir / "decision.json").exists()
        assert (history_dir / "summary.md").exists()
        assert (history_dir / "journal.jsonl").exists()
        assert (history_dir / "metadata.json").exists()

        # Check metadata content
        metadata = json.loads((history_dir / "metadata.json").read_text())
        assert metadata["iteration"] == "001"
        assert metadata["decision"] == "KEEP"
        assert "timestamp_utc" in metadata
        assert metadata["journal"] == "optimization/history/cesiumjs-camera/iteration-001/journal.jsonl"


class TestUpdateCurrentBest:
    """Tests for update_current_best()."""

    def test_updates_skill_file(self, run_loop, tmp_path, monkeypatch):
        """Updates current best skill file with candidate."""
        monkeypatch.chdir(tmp_path)

        # Setup candidate
        candidate_dir = tmp_path / "optimization" / "candidates" / "cesiumjs-camera" / "001"
        candidate_dir.mkdir(parents=True)
        candidate_path = candidate_dir / "SKILL.md"
        candidate_path.write_text("# New Skill Content\n")

        # Setup current best
        skills_dir = tmp_path / "skills" / "cesiumjs-camera"
        skills_dir.mkdir(parents=True)
        current_best_path = skills_dir / "SKILL.md"
        current_best_path.write_text("# Old Skill Content\n")

        # Run update
        run_loop.update_current_best("cesiumjs-camera", "001")

        # Check update
        assert current_best_path.read_text() == "# New Skill Content\n"

        # Check backup created under eval history, not in the skill source tree.
        backup_path = tmp_path / "optimization" / "history" / "cesiumjs-camera" / "iteration-001" / "current-best-before.md"
        assert backup_path.exists()
        assert backup_path.read_text() == "# Old Skill Content\n"
        assert not (skills_dir / "SKILL.md.backup").exists()


class TestRunProposer:
    """Tests for run_proposer()."""

    def test_success(self, run_loop, mock_args, tmp_path, monkeypatch):
        """Proposer runs successfully."""
        monkeypatch.chdir(tmp_path)

        # Mock subprocess
        mock_result = Mock()
        mock_result.stdout = "Proposer output"
        mock_result.returncode = 0

        # Create expected output
        candidate_dir = tmp_path / "optimization" / "candidates" / "cesiumjs-camera" / "001"
        candidate_dir.mkdir(parents=True)
        (candidate_dir / "SKILL.md").write_text("# Candidate\n")

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            result = run_loop.run_proposer("cesiumjs-camera", "001", mock_args)

        assert result["success"] is True
        # Function returns a relative path
        assert result["candidate_path"] == Path("optimization/candidates/cesiumjs-camera/001/SKILL.md")
        assert result["error"] is None
        cmd = mock_run.call_args.args[0]
        assert "--iteration" in cmd
        assert cmd[cmd.index("--iteration") + 1] == "001"
        assert "--model-id" in cmd
        assert cmd[cmd.index("--model-id") + 1] == mock_args.proposer_model
        assert "--model-variant" in cmd
        assert cmd[cmd.index("--model-variant") + 1] == mock_args.proposer_variant
        assert "--model" not in cmd

    def test_failure(self, run_loop, mock_args):
        """Proposer fails with error."""
        from subprocess import CalledProcessError

        mock_error = CalledProcessError(1, "cmd")
        mock_error.stderr = "API key missing"

        with patch("subprocess.run", side_effect=mock_error):
            result = run_loop.run_proposer("cesiumjs-camera", "001", mock_args)

        assert result["success"] is False
        assert result["error"] is not None


class TestBaselineEvidence:
    """Tests for current-best baseline evidence handling."""

    def test_evidence_dir_complete(self, run_loop, tmp_path):
        runs_dir = tmp_path / "runs"
        bundle = runs_dir / "eval-001-test"
        bundle.mkdir(parents=True)
        for name in [
            "console.json",
            "programmatic-checks.json",
            "scene-state.json",
            "metadata.json",
            "screenshot-quality.json",
            "screenshot.png",
        ]:
            (bundle / name).write_text("{}")

        assert run_loop.evidence_dir_complete(runs_dir, expected_count=1) is True

    def test_ensure_current_best_baseline_reuses_complete_evidence(self, run_loop, mock_args, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        runs_dir = tmp_path / "optimization" / "runs" / "cesiumjs-camera" / "baseline"
        bundle = runs_dir / "eval-001-test"
        bundle.mkdir(parents=True)
        for name in [
            "console.json",
            "programmatic-checks.json",
            "scene-state.json",
            "metadata.json",
            "screenshot-quality.json",
            "screenshot.png",
        ]:
            (bundle / name).write_text("{}")

        with patch.object(run_loop, "expected_bundle_count", return_value=1), \
             patch.object(run_loop, "run_skills_adapter") as adapter, \
             patch.object(run_loop, "run_browser_eval") as browser:
            result = run_loop.ensure_current_best_baseline(
                "cesiumjs-camera",
                Path("skills/cesiumjs-camera/SKILL.md"),
                mock_args,
            )

        assert result["success"] is True
        assert result["reused"] is True
        adapter.assert_not_called()
        browser.assert_not_called()


class TestJsonSafeRedaction:
    """Tests for _json_safe() secret redaction of persisted journal/history strings."""

    def test_redacts_home_path_and_localhost_url(self, run_loop):
        """A string carrying a user-home path and a localhost URL is scrubbed."""
        leaked = "Proposer failed: /Users/alice/secret crashed at http://localhost:8080/x"
        result = run_loop._json_safe(leaked)

        assert "/Users/alice/secret" not in result
        assert "http://localhost:8080/x" not in result
        assert "<redacted-path>" in result
        assert "<redacted-local-url>" in result

    def test_redacts_nested_in_result_dict(self, run_loop):
        """Strings nested inside result dicts (as journaled) are redacted recursively."""
        event = {"error": "boom at /home/bob/run and http://127.0.0.1:9999/api", "code": 1}
        result = run_loop._json_safe(event)

        assert "/home/bob/" not in result["error"]
        assert "127.0.0.1:9999" not in result["error"]
        assert "<redacted-path>" in result["error"]
        assert "<redacted-local-url>" in result["error"]
        # Non-string structured data is preserved untouched.
        assert result["code"] == 1

    def test_clean_string_passes_through(self, run_loop):
        """Strings without secrets are returned unchanged."""
        assert run_loop._json_safe("all good here") == "all good here"


class TestMainLoop:
    """Integration tests for main loop logic."""

    def test_main_validates_environment(self, run_loop):
        """Main validates required environment variables."""
        with patch.dict("os.environ", {}, clear=True):
            with patch("sys.argv", ["run-loop.py", "cesiumjs-camera"]):
                result = run_loop.main()
                assert result == 1  # Should fail without API key

    def test_stopping_on_max_iterations(self, run_loop, mock_args, tmp_path, monkeypatch):
        """Loop stops after max iterations."""
        monkeypatch.chdir(tmp_path)
        mock_args.max_iterations = 2

        # Mock all subprocess calls to succeed quickly
        with patch("subprocess.run") as mock_run, \
             patch.object(run_loop, "get_current_best_skill", return_value=Path("skills/cesiumjs-camera/SKILL.md")), \
             patch.object(run_loop, "ensure_current_best_baseline", return_value={"success": True, "runs_dir": Path("baseline"), "reused": True, "error": None}), \
             patch.object(run_loop, "get_next_iteration", side_effect=["001", "002", "003"]), \
             patch.object(run_loop, "run_proposer", return_value={"success": True, "candidate_path": Path("candidate"), "error": None}), \
             patch.object(run_loop, "run_skills_adapter", return_value={"success": True, "generated_count": 5, "error": None}), \
             patch.object(run_loop, "run_browser_eval", return_value={"success": True, "runs_dir": Path("runs"), "error": None}), \
             patch.object(run_loop, "run_judges", return_value={"success": True, "judge_results": [], "error": None}), \
             patch.object(run_loop, "run_decision_engine", return_value={"success": True, "decision": "KEEP", "decision_data": {}, "error": None}), \
             patch.object(run_loop, "run_report_generator", return_value={"success": True, "error": None}), \
             patch.object(run_loop, "archive_iteration"), \
             patch.object(run_loop, "update_current_best"):

            result = run_loop.run_loop(mock_args)
            assert result == 0
            journal_path = tmp_path / "optimization" / "results" / "cesiumjs-camera" / "001" / "journal.jsonl"
            assert journal_path.exists()
            events = [json.loads(line)["event"] for line in journal_path.read_text().splitlines()]
            assert "iteration_started" in events
            assert "iteration_completed" in events

    def test_stopping_on_plateau(self, run_loop, mock_args, tmp_path, monkeypatch):
        """Loop stops after consecutive ties."""
        monkeypatch.chdir(tmp_path)
        mock_args.stop_on = "plateau"
        mock_args.plateau_n = 2
        mock_args.max_iterations = 10

        decision_sequence = ["TIE", "TIE", "KEEP"]  # Should stop after 2 TIEs

        with patch.object(run_loop, "get_current_best_skill", return_value=Path("skills/cesiumjs-camera/SKILL.md")), \
             patch.object(run_loop, "ensure_current_best_baseline", return_value={"success": True, "runs_dir": Path("baseline"), "reused": True, "error": None}), \
             patch.object(run_loop, "get_next_iteration", side_effect=["001", "002", "003"]), \
             patch.object(run_loop, "run_proposer", return_value={"success": True, "candidate_path": Path("candidate"), "error": None}), \
             patch.object(run_loop, "run_skills_adapter", return_value={"success": True, "generated_count": 5, "error": None}), \
             patch.object(run_loop, "run_browser_eval", return_value={"success": True, "runs_dir": Path("runs"), "error": None}), \
             patch.object(run_loop, "run_judges", return_value={"success": True, "judge_results": [], "error": None}), \
             patch.object(run_loop, "run_decision_engine", side_effect=[
                 {"success": True, "decision": "TIE", "decision_data": {"decision": "TIE"}, "error": None},
                 {"success": True, "decision": "TIE", "decision_data": {"decision": "TIE"}, "error": None},
             ]), \
             patch.object(run_loop, "run_report_generator", return_value={"success": True, "error": None}), \
             patch.object(run_loop, "archive_iteration"), \
             patch.object(run_loop, "update_current_best"):

            result = run_loop.run_loop(mock_args)
            assert result == 0

    def test_stopping_on_regression(self, run_loop, mock_args, tmp_path, monkeypatch):
        """Loop stops on first REJECT."""
        monkeypatch.chdir(tmp_path)
        mock_args.stop_on = "regression"
        mock_args.max_iterations = 10

        with patch.object(run_loop, "get_current_best_skill", return_value=Path("skills/cesiumjs-camera/SKILL.md")), \
             patch.object(run_loop, "ensure_current_best_baseline", return_value={"success": True, "runs_dir": Path("baseline"), "reused": True, "error": None}), \
             patch.object(run_loop, "get_next_iteration", return_value="001"), \
             patch.object(run_loop, "run_proposer", return_value={"success": True, "candidate_path": Path("candidate"), "error": None}), \
             patch.object(run_loop, "run_skills_adapter", return_value={"success": True, "generated_count": 5, "error": None}), \
             patch.object(run_loop, "run_browser_eval", return_value={"success": True, "runs_dir": Path("runs"), "error": None}), \
             patch.object(run_loop, "run_judges", return_value={"success": True, "judge_results": [], "error": None}), \
             patch.object(run_loop, "run_decision_engine", return_value={"success": True, "decision": "REJECT", "decision_data": {"decision": "REJECT"}, "error": None}), \
             patch.object(run_loop, "run_report_generator", return_value={"success": True, "error": None}), \
             patch.object(run_loop, "archive_iteration"), \
             patch.object(run_loop, "update_current_best"):

            result = run_loop.run_loop(mock_args)
            assert result == 0
