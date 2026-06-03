#!/usr/bin/env python3
"""Tests for scenario content hashing and re-baseline functionality."""

import hashlib
import json
import tempfile
from pathlib import Path
import sys

# Add parent directory to path to import from scripts
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def compute_scenario_hash(path: Path) -> str:
    """Compute SHA-256 hash of normalized scenario JSON."""
    with path.open() as f:
        data = json.load(f)
    normalized = json.dumps(data, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def test_hash_computation_is_deterministic():
    """Test that the same content produces the same hash."""
    scenario_data = {
        "id": "eval-001",
        "name": "Test Scenario",
        "difficulty": "medium",
        "description": "Test description",
        "prompt": "Test prompt",
        "expected_behaviors": ["behavior1", "behavior2"],
        "visual_expectations": "Visual test",
        "programmatic_checks": [
            {"type": "code_runs", "description": "Code should run"}
        ],
        "screenshots": [
            {"timing": "after-load", "delay_ms": 1000, "description": "Initial view"}
        ],
        "regression_critical": False
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "test-scenario.json"

        # Write with different formatting
        path.write_text(json.dumps(scenario_data, indent=2))
        hash1 = compute_scenario_hash(path)

        path.write_text(json.dumps(scenario_data, indent=4))
        hash2 = compute_scenario_hash(path)

        path.write_text(json.dumps(scenario_data))
        hash3 = compute_scenario_hash(path)

        # All should produce the same hash
        assert hash1 == hash2 == hash3, "Hash should be deterministic regardless of formatting"
        print(f"✓ Hash computation is deterministic: {hash1[:12]}...")


def test_hash_changes_with_content():
    """Test that different content produces different hashes."""
    base_data = {
        "id": "eval-001",
        "name": "Test Scenario",
        "difficulty": "medium",
        "description": "Test description",
        "prompt": "Test prompt",
        "expected_behaviors": ["behavior1"],
        "visual_expectations": "Visual test",
        "programmatic_checks": [
            {"type": "code_runs", "description": "Code should run"}
        ],
        "screenshots": [
            {"timing": "after-load", "delay_ms": 1000, "description": "Initial view"}
        ],
        "regression_critical": False
    }

    modified_data = base_data.copy()
    modified_data["description"] = "Modified description"

    with tempfile.TemporaryDirectory() as tmpdir:
        path1 = Path(tmpdir) / "scenario1.json"
        path2 = Path(tmpdir) / "scenario2.json"

        path1.write_text(json.dumps(base_data))
        path2.write_text(json.dumps(modified_data))

        hash1 = compute_scenario_hash(path1)
        hash2 = compute_scenario_hash(path2)

        assert hash1 != hash2, "Different content should produce different hashes"
        print(f"✓ Hash changes with content: {hash1[:12]}... != {hash2[:12]}...")


def test_rebaseline_state_transitions():
    """Test the state transitions for re-baseline workflow."""
    # Initial state: no baseline recorded
    scenario_id = "eval-001"
    skill = "cesiumjs-test"

    # Simulate first hash (baseline)
    baseline_hash = "abc123" * 10  # 60 chars

    # Simulate scenario change
    modified_hash = "def456" * 10  # 60 chars

    # State 1: no baseline -> no rebaseline_required
    baselines = {}
    needs_rebaseline = (
        skill in baselines
        and scenario_id in baselines[skill]
        and baselines[skill][scenario_id] != modified_hash
    )
    assert not needs_rebaseline, "No baseline should not trigger rebaseline_required"
    print("✓ State 1: No baseline -> not flagged")

    # State 2: baseline exists and matches -> no rebaseline_required
    baselines = {skill: {scenario_id: baseline_hash}}
    needs_rebaseline = (
        skill in baselines
        and scenario_id in baselines[skill]
        and baselines[skill][scenario_id] != baseline_hash
    )
    assert not needs_rebaseline, "Matching baseline should not trigger rebaseline_required"
    print("✓ State 2: Matching baseline -> not flagged")

    # State 3: baseline exists but doesn't match -> rebaseline_required
    needs_rebaseline = (
        skill in baselines
        and scenario_id in baselines[skill]
        and baselines[skill][scenario_id] != modified_hash
    )
    assert needs_rebaseline, "Mismatched baseline should trigger rebaseline_required"
    print("✓ State 3: Mismatched baseline -> flagged for rebaseline")

    # State 4: after rebaseline -> no rebaseline_required
    baselines[skill][scenario_id] = modified_hash
    needs_rebaseline = (
        skill in baselines
        and scenario_id in baselines[skill]
        and baselines[skill][scenario_id] != modified_hash
    )
    assert not needs_rebaseline, "After rebaseline should clear flag"
    print("✓ State 4: After rebaseline -> flag cleared")


if __name__ == "__main__":
    print("\n=== Testing Scenario Hashing ===\n")
    test_hash_computation_is_deterministic()
    test_hash_changes_with_content()
    test_rebaseline_state_transitions()
    print("\n✓ All tests passed\n")
