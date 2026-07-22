#!/usr/bin/env python3
"""
Tests for optimization/scripts/propose-candidate.py

Tests cover:
- Input loading (skill, decision, history, coverage)
- Prompt building and template formatting
- Output writing (skill, hypothesis, metadata)
- API key validation
- Mocked model responses
"""

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# Import the script as a module
sys.path.insert(0, str(REPO_ROOT / "optimization" / "scripts"))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "propose_candidate", REPO_ROOT / "optimization" / "scripts" / "propose-candidate.py"
)
propose_candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(propose_candidate)


@pytest.fixture
def temp_workspace(tmp_path):
    """Create a temporary workspace with required directory structure."""
    # Create directories
    (tmp_path / "skills" / "test-skill").mkdir(parents=True)
    (tmp_path / "optimization" / "results" / "test-skill" / "001").mkdir(parents=True)
    (tmp_path / "optimization" / "results" / "test-skill" / "002").mkdir(parents=True)
    (tmp_path / "optimization" / "candidates" / "test-skill").mkdir(parents=True)
    (tmp_path / "optimization" / "prompts" / "proposer").mkdir(parents=True)

    # Create skill file
    skill_content = """---
name: test-skill
description: Test skill for proposer
---
# Test Skill

## Section 1
Content here.

## Section 2
More content.
"""
    (tmp_path / "skills" / "test-skill" / "SKILL.md").write_text(skill_content)

    # Create decision record
    decision = {
        "decision": "REJECT",
        "rule_fired": "rule_4_more_losses",
        "rationale": "Candidate had 2 losses vs 1 win",
        "counts": {"wins": 1, "losses": 2, "ties": 3},
    }
    decision_path = tmp_path / "optimization" / "results" / "test-skill" / "002" / "decision.json"
    decision_path.write_text(json.dumps(decision, indent=2))

    # Create per-bundle judge verdicts and check results for iteration 002 under
    # optimization/runs/<skill>/<iter>/<scenario-slug>/ — the canonical layout the
    # runner writes and the proposer walks.
    runs_root = tmp_path / "optimization" / "runs" / "test-skill"
    bundle_001 = runs_root / "002" / "eval-001-camera-orbit"
    bundle_002 = runs_root / "002" / "eval-002-camera-flyto"
    for b in (bundle_001, bundle_002):
        b.mkdir(parents=True, exist_ok=True)

    bundle_001_judge = {
        "scenario_id": "eval-001",
        "verdict": "BASELINE",
        "individual_verdicts": [
            {"verdict": "BASELINE", "rationale": "Baseline shows better camera positioning"},
            {"verdict": "BASELINE", "rationale": "Baseline has clearer view"},
            {"verdict": "BASELINE", "rationale": "Baseline is more accurate"},
        ],
    }
    (bundle_001 / "judge-verdicts.json").write_text(json.dumps(bundle_001_judge, indent=2))

    bundle_002_judge = {
        "scenario_id": "eval-002",
        "verdict": "CANDIDATE",
        "individual_verdicts": [
            {"verdict": "CANDIDATE", "rationale": "Candidate has smoother animation"},
            {"verdict": "CANDIDATE", "rationale": "Candidate is better"},
            {"verdict": "BASELINE", "rationale": "Baseline is acceptable"},
        ],
    }
    (bundle_002 / "judge-verdicts.json").write_text(json.dumps(bundle_002_judge, indent=2))

    # Per-bundle check results
    bundle_001_checks = {
        "scenario_id": "eval-001",
        "checks": [
            {"type": "code_runs", "result": "pass", "detail": "Code executed successfully"},
            {"type": "api_present", "result": "fail", "detail": "Missing camera.flyTo"},
        ],
    }
    (bundle_001 / "programmatic-checks.json").write_text(json.dumps(bundle_001_checks, indent=2))

    bundle_002_checks = {
        "scenario_id": "eval-002",
        "checks": [
            {"type": "code_runs", "result": "pass", "detail": "Code executed successfully"},
            {"type": "no_console_errors", "result": "pass", "detail": "No errors"},
        ],
    }
    (bundle_002 / "programmatic-checks.json").write_text(json.dumps(bundle_002_checks, indent=2))

    # (legacy block follows; trimmed)
    check_results_002 = {
        "scenarios": [
            {
                "eval_id": "eval-001",
                "checks": [
                    {"type": "code_runs", "result": "pass", "detail": "Code executed successfully"},
                    {"type": "api_present", "result": "fail", "detail": "Missing camera.flyTo"},
                ],
            },
            {
                "eval_id": "eval-002",
                "checks": [
                    {"type": "code_runs", "result": "pass", "detail": "Code executed successfully"},
                    {"type": "no_console_errors", "result": "pass", "detail": "No errors"},
                ],
            },
        ]
    }
    (tmp_path / "optimization" / "results" / "test-skill" / "002" / "programmatic-checks.json").write_text(
        json.dumps(check_results_002, indent=2)
    )

    # Per-bundle judge verdicts for iteration 001
    bundle_001_iter1 = runs_root / "001" / "eval-001-camera-orbit"
    bundle_001_iter1.mkdir(parents=True, exist_ok=True)
    (bundle_001_iter1 / "judge-verdicts.json").write_text(json.dumps({
        "scenario_id": "eval-001",
        "verdict": "TIE",
        "individual_verdicts": [
            {"verdict": "TIE", "rationale": "Both are equivalent"},
        ],
    }, indent=2))

    # Create coverage report
    coverage = {
        "skills": {
            "test-skill": {
                "uncovered_sections": ["Advanced Features", "Error Handling"],
                "uncovered_apis": ["viewer.scene.pick", "viewer.clock.onTick"],
            }
        }
    }
    (tmp_path / "optimization" / "results" / "coverage.json").write_text(json.dumps(coverage, indent=2))

    # Create prompt template
    template = """Current Skill:
{current_skill}

Decision: {last_decision}
Rule: {last_rule}
Rationale: {last_rationale}
Wins: {wins}, Losses: {losses}, Ties: {ties}

History ({history_count} iterations):
{evaluation_history}

Uncovered Sections ({uncovered_section_count}):
{uncovered_sections}

Uncovered APIs ({uncovered_api_count}):
{uncovered_apis}

Propose revised skill:
"""
    (tmp_path / "optimization" / "prompts" / "proposer" / "propose-v1.txt").write_text(template)

    return tmp_path


def test_load_skill(temp_workspace):
    """Test loading skill content from file."""
    skill_path = temp_workspace / "skills" / "test-skill" / "SKILL.md"
    content = propose_candidate.load_skill(skill_path)

    assert "name: test-skill" in content
    assert "# Test Skill" in content


def test_load_skill_missing_file():
    """Test loading skill with missing file raises error."""
    with pytest.raises(FileNotFoundError):
        propose_candidate.load_skill(Path("/nonexistent/skill.md"))


def test_load_decision(temp_workspace):
    """Test loading decision record."""
    decision_path = temp_workspace / "optimization" / "results" / "test-skill" / "002" / "decision.json"
    decision = propose_candidate.load_decision(decision_path)

    assert decision["decision"] == "REJECT"
    assert decision["rule_fired"] == "rule_4_more_losses"
    assert decision["counts"]["wins"] == 1
    assert decision["counts"]["losses"] == 2


def test_load_decision_missing_file():
    """Test loading decision with missing file returns baseline."""
    decision = propose_candidate.load_decision(Path("/nonexistent/decision.json"))

    assert decision["decision"] == "BASELINE"
    assert decision["rule_fired"] == "initial"
    assert decision["counts"]["wins"] == 0


def test_load_evaluation_history(temp_workspace):
    """Test loading evaluation history from multiple iterations."""
    results_dir = temp_workspace / "optimization" / "results"
    history = propose_candidate.load_evaluation_history("test-skill", 5, results_dir)

    assert len(history) == 2  # iterations 002 and 001
    assert history[0]["iteration"] == "002"
    assert len(history[0]["scenarios"]) == 2

    scenario = history[0]["scenarios"][0]
    assert scenario["eval_id"] == "eval-001"
    assert scenario["verdict"] == "BASELINE"
    assert "camera positioning" in scenario["rationale"]
    assert len(scenario["checks"]) == 2


def test_load_evaluation_history_no_results():
    """Test loading history with no results directory."""
    history = propose_candidate.load_evaluation_history("nonexistent", 5, Path("/tmp/nonexistent"))
    assert history == []


def test_load_coverage(temp_workspace):
    """Test loading coverage report for skill."""
    coverage_path = temp_workspace / "optimization" / "results" / "coverage.json"
    coverage = propose_candidate.load_coverage(coverage_path, "test-skill")

    assert len(coverage["uncovered_sections"]) == 2
    assert "Advanced Features" in coverage["uncovered_sections"]
    assert len(coverage["uncovered_apis"]) == 2
    assert "viewer.scene.pick" in coverage["uncovered_apis"]


def test_load_coverage_missing_file():
    """Test loading coverage with missing file returns empty."""
    coverage = propose_candidate.load_coverage(Path("/nonexistent/coverage.json"), "test-skill")

    assert coverage["uncovered_sections"] == []
    assert coverage["uncovered_apis"] == []


def test_load_coverage_missing_skill(temp_workspace):
    """Test loading coverage for skill not in report."""
    coverage_path = temp_workspace / "optimization" / "results" / "coverage.json"
    coverage = propose_candidate.load_coverage(coverage_path, "nonexistent-skill")

    assert coverage["uncovered_sections"] == []
    assert coverage["uncovered_apis"] == []


def test_format_evaluation_history(temp_workspace):
    """Test formatting evaluation history for prompt."""
    results_dir = temp_workspace / "optimization" / "results"
    history = propose_candidate.load_evaluation_history("test-skill", 5, results_dir)
    formatted = propose_candidate.format_evaluation_history(history)

    assert "### Iteration 002" in formatted
    assert "**eval-001** - Verdict: BASELINE" in formatted
    assert "Checks: some failures" in formatted
    assert "FAIL: api_present" in formatted
    assert "camera positioning" in formatted


def test_format_evaluation_history_empty():
    """Test formatting empty history."""
    formatted = propose_candidate.format_evaluation_history([])
    assert formatted == "No evaluation history available."


def test_format_coverage_gaps(temp_workspace):
    """Test formatting coverage gaps."""
    coverage = {
        "uncovered_sections": ["Section A", "Section B", "Section C"],
        "uncovered_apis": ["api.method1", "api.method2"],
    }
    sections, apis = propose_candidate.format_coverage_gaps(coverage)

    assert "- Section A" in sections
    assert "- Section B" in sections
    assert "- api.method1" in apis
    assert "- api.method2" in apis


def test_format_coverage_gaps_truncation():
    """Test formatting coverage gaps with truncation."""
    coverage = {
        "uncovered_sections": [f"Section {i}" for i in range(30)],
        "uncovered_apis": [f"api.method{i}" for i in range(50)],
    }
    sections, apis = propose_candidate.format_coverage_gaps(coverage)

    assert "Section 0" in sections
    assert "Section 19" in sections
    assert "... and 10 more" in sections

    assert "api.method0" in apis
    assert "api.method29" in apis
    assert "... and 20 more" in apis


def test_format_coverage_gaps_empty():
    """Test formatting empty coverage gaps."""
    coverage = {"uncovered_sections": [], "uncovered_apis": []}
    sections, apis = propose_candidate.format_coverage_gaps(coverage)

    assert sections == "None"
    assert apis == "None"


def test_build_prompt(temp_workspace):
    """Test building prompt from template and inputs."""
    template_path = temp_workspace / "optimization" / "prompts" / "proposer" / "propose-v1.txt"
    current_skill = "# Test Skill\nContent here"
    decision = {
        "decision": "REJECT",
        "rule_fired": "rule_4",
        "rationale": "Too many losses",
        "counts": {"wins": 1, "losses": 2, "ties": 0},
    }
    history = [
        {
            "iteration": "002",
            "scenarios": [
                {
                    "eval_id": "eval-001",
                    "verdict": "BASELINE",
                    "rationale": "Baseline better",
                    "checks": [],
                }
            ],
        }
    ]
    coverage = {
        "uncovered_sections": ["Section A"],
        "uncovered_apis": ["api.method1"],
    }

    prompt = propose_candidate.build_prompt(template_path, current_skill, decision, history, coverage)

    assert "# Test Skill" in prompt
    assert "Decision: REJECT" in prompt
    assert "Rule: rule_4" in prompt
    assert "Wins: 1, Losses: 2, Ties: 0" in prompt
    assert "History (1 iterations)" in prompt
    assert "Uncovered Sections (1)" in prompt
    assert "Uncovered APIs (1)" in prompt


def test_compute_content_hash():
    """Test computing SHA-256 hash of content."""
    content = "Test content for hashing"
    hash1 = propose_candidate.compute_content_hash(content)
    hash2 = propose_candidate.compute_content_hash(content)

    assert hash1 == hash2
    assert len(hash1) == 64  # SHA-256 produces 64 hex characters

    # Different content produces different hash
    hash3 = propose_candidate.compute_content_hash(content + " modified")
    assert hash3 != hash1


def test_generate_hypothesis():
    """Test generating hypothesis document."""
    decision = {
        "decision": "REJECT",
        "rule_fired": "rule_4_more_losses",
        "rationale": "Candidate lost 2 scenarios",
        "counts": {"wins": 1, "losses": 2, "ties": 1},
    }
    history = [
        {
            "iteration": "002",
            "scenarios": [
                {
                    "eval_id": "eval-001",
                    "verdict": "BASELINE",
                    "rationale": "Baseline shows better camera positioning with correct altitude",
                    "checks": [],
                }
            ],
        }
    ]
    coverage = {
        "uncovered_sections": ["Advanced Features"],
        "uncovered_apis": ["viewer.scene.pick"],
    }

    hypothesis = propose_candidate.generate_hypothesis(decision, history, coverage)

    assert "# Candidate Skill Hypothesis" in hypothesis
    assert "Last decision: REJECT" in hypothesis
    assert "Rule fired: rule_4_more_losses" in hypothesis
    assert "Candidate lost 2 scenarios" in hypothesis
    assert "## Recent Evaluation Losses" in hypothesis
    assert "eval-001" in hypothesis
    assert "better camera positioning" in hypothesis
    assert "## Coverage Gaps" in hypothesis
    assert "1 uncovered sections" in hypothesis
    assert "1 uncovered APIs" in hypothesis


def test_generate_hypothesis_no_losses():
    """Test generating hypothesis with no losses."""
    decision = {
        "decision": "KEEP",
        "rule_fired": "rule_3_more_wins",
        "rationale": "Candidate won 3 scenarios",
        "counts": {"wins": 3, "losses": 0, "ties": 2},
    }
    history = [
        {
            "iteration": "001",
            "scenarios": [
                {
                    "eval_id": "eval-001",
                    "verdict": "CANDIDATE",
                    "rationale": "Candidate better",
                    "checks": [],
                }
            ],
        }
    ]
    coverage = {"uncovered_sections": [], "uncovered_apis": []}

    hypothesis = propose_candidate.generate_hypothesis(decision, history, coverage)

    assert "No significant losses in recent history" in hypothesis


def test_write_outputs(tmp_path):
    """Test writing candidate skill, hypothesis, and metadata."""
    output_dir = tmp_path / "output"
    candidate_skill = "# Revised Skill\nNew content"
    hypothesis = "# Hypothesis\nChanges explained"
    metadata = {
        "skill": "test-skill",
        "iteration": "003",
        "model_id": "openai/gpt-5.5",
    }

    propose_candidate.write_outputs(output_dir, candidate_skill, hypothesis, metadata)

    assert (output_dir / "SKILL.md").exists()
    assert (output_dir / "hypothesis.md").exists()
    assert (output_dir / "proposer-metadata.json").exists()

    assert (output_dir / "SKILL.md").read_text() == candidate_skill
    assert (output_dir / "hypothesis.md").read_text() == hypothesis

    metadata_loaded = json.loads((output_dir / "proposer-metadata.json").read_text())
    assert metadata_loaded["skill"] == "test-skill"
    assert metadata_loaded["iteration"] == "003"


def test_call_proposer_mocked():
    """Test calling proposer with mocked CLI response."""
    prompt = "Test prompt"
    model_id = "openai/gpt-5.5"
    model_variant = "high"
    temperature = 1.0

    with patch.object(propose_candidate, "invoke_agent", return_value="# Revised Skill\nMocked response") as mock_invoke:
        response = propose_candidate.call_proposer(prompt, model_id, model_variant, temperature)

        assert response == "# Revised Skill\nMocked response"
        mock_invoke.assert_called_once()
        kwargs = mock_invoke.call_args.kwargs
        assert kwargs["prompt"] == prompt
        assert kwargs["role"] == "proposer"
        assert kwargs["model"] == model_id
        assert kwargs["variant"] == model_variant
        assert kwargs["allowed_tools"] == ["Read", "Grep", "Glob"]
        assert set(kwargs["add_dirs"]).issubset({"skills", "optimization", "wiki"})


def test_proposer_prompt_requires_research_pass():
    """The proposer prompt should require evidence-backed research before edits."""
    prompt_path = REPO_ROOT / "optimization" / "prompts" / "proposer" / "propose-v1.txt"
    prompt = prompt_path.read_text()
    assert "private research pass" in prompt
    assert "research/sub-agent tooling" in prompt
    assert "Cesium API correctness" in prompt


def test_main_missing_cli(temp_workspace, monkeypatch, capsys):
    """Test main() when the selected agent CLI is not on PATH."""
    monkeypatch.chdir(temp_workspace)

    sys.argv = ["propose-candidate.py", "test-skill"]

    not_found = propose_candidate.AgentCLINotFoundError[-1]("agent CLI not found on PATH")
    with patch.object(propose_candidate, "ensure_cli_available", side_effect=not_found):
        result = propose_candidate.main()

    assert result == 1
    captured = capsys.readouterr()
    assert "agent CLI not found" in captured.err


def test_main_missing_template(temp_workspace, monkeypatch, capsys):
    """Test main() with missing prompt template."""
    monkeypatch.chdir(temp_workspace)

    # Remove template
    (temp_workspace / "optimization" / "prompts" / "proposer" / "propose-v1.txt").unlink()

    sys.argv = ["propose-candidate.py", "test-skill"]

    with patch.object(propose_candidate, "ensure_cli_available", return_value="/usr/local/bin/agent"):
        result = propose_candidate.main()

    assert result == 1
    captured = capsys.readouterr()
    assert "Prompt template not found" in captured.err


def test_main_success(temp_workspace, monkeypatch, capsys):
    """Test main() with successful execution (CLI mocked)."""
    monkeypatch.chdir(temp_workspace)

    sys.argv = [
        "propose-candidate.py",
        "test-skill",
        "--iteration",
        "003",
    ]

    with patch.object(propose_candidate, "ensure_cli_available", return_value="/usr/local/bin/agent"), \
         patch.object(propose_candidate, "invoke_agent", return_value="---\nname: test-skill\n---\n# Revised Skill"):
        result = propose_candidate.main()

        assert result == 0
        captured = capsys.readouterr()
        assert "Proposal complete for iteration 003" in captured.out

        # Verify output files exist
        output_dir = temp_workspace / "optimization" / "candidates" / "test-skill" / "003"
        assert (output_dir / "SKILL.md").exists()
        assert (output_dir / "hypothesis.md").exists()
        assert (output_dir / "proposer-metadata.json").exists()

        # Verify metadata
        metadata = json.loads((output_dir / "proposer-metadata.json").read_text())
        assert metadata["skill"] == "test-skill"
        assert metadata["iteration"] == "003"
        assert metadata["model_id"] == propose_candidate.DEFAULT_MODEL_ID
        assert "timestamp_utc" in metadata


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
