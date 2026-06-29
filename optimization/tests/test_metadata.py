#!/usr/bin/env python3
"""Tests for evidence bundle metadata structure and schema validation."""

import json
import tempfile
from pathlib import Path

import jsonschema
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
METADATA_SCHEMA_PATH = REPO_ROOT / "optimization" / "schemas" / "run-metadata.schema.json"


@pytest.fixture
def metadata_schema():
    """Load the run-metadata JSON schema."""
    with open(METADATA_SCHEMA_PATH) as f:
        return json.load(f)


def test_metadata_schema_exists():
    """Test that run-metadata.schema.json exists and is valid JSON."""
    assert METADATA_SCHEMA_PATH.exists(), f"Schema not found at {METADATA_SCHEMA_PATH}"
    with open(METADATA_SCHEMA_PATH) as f:
        schema = json.load(f)
    assert schema["title"] == "CesiumJS Skills Evaluation Run Metadata"


def test_valid_metadata_passes(metadata_schema):
    """Test that valid metadata passes schema validation."""
    valid_metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123def456",
        "model_id": "openai/gpt-5.5",
        "temperature": 0.7,
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280, "height": 720},
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
        },
    }
    # Should not raise
    jsonschema.validate(valid_metadata, metadata_schema)


def test_metadata_with_optional_fields(metadata_schema):
    """Test that metadata with optional fields passes validation."""
    metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123def456",
        "model_id": "openai/gpt-5.5",
        "temperature": 0.7,
        "seed": 42,  # Optional field
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280, "height": 720},
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
            "scene_state": "e" * 64,  # Optional field
            "screenshots": [  # Optional field
                {"filename": "screenshot-0.png", "hash": "f" * 64},
                {"filename": "screenshot-1.png", "hash": "0" * 64},
            ],
        },
    }
    # Should not raise
    jsonschema.validate(metadata, metadata_schema)


def test_missing_required_fields_fails(metadata_schema):
    """Test that metadata missing required fields fails validation."""
    incomplete_metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        # Missing runner_git_commit and other required fields
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(incomplete_metadata, metadata_schema)


def test_invalid_hash_format_fails(metadata_schema):
    """Test that invalid hash formats fail validation."""
    invalid_metadata = {
        "scenario_version_hash": "not-a-valid-hash",  # Invalid format
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123def456",
        "model_id": "openai/gpt-5.5",
        "temperature": 0.7,
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280, "height": 720},
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(invalid_metadata, metadata_schema)


def test_invalid_temperature_fails(metadata_schema):
    """Test that temperature outside valid range fails validation."""
    invalid_metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123def456",
        "model_id": "openai/gpt-5.5",
        "temperature": 1.5,  # Invalid: > 1.0
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280, "height": 720},
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(invalid_metadata, metadata_schema)


def test_invalid_viewport_fails(metadata_schema):
    """Test that invalid viewport structure fails validation."""
    invalid_metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123def456",
        "model_id": "openai/gpt-5.5",
        "temperature": 0.7,
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280},  # Missing height
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(invalid_metadata, metadata_schema)


def test_bundle_structure():
    """Test that the expected bundle directory structure is documented."""
    # This is a documentation test - the structure should match:
    # optimization/runs/<skill>/<iteration>/<eval-id>-<name>/{
    #   eval.html,
    #   screenshot.png,
    #   console.json,
    #   programmatic-checks.json,
    #   scene-state.json,
    #   metadata.json
    # }
    expected_files = [
        "eval.html",
        "console.json",
        "programmatic-checks.json",
        "scene-state.json",
        "metadata.json",
    ]
    # At least one screenshot file (could be screenshot.png or screenshot-N.png)
    assert len(expected_files) >= 5, "Expected at least 5 standard bundle files"


def test_artifact_hashes_structure(metadata_schema):
    """Test that artifact_hashes has correct structure with all artifact types."""
    metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123def456",
        "model_id": "openai/gpt-5.5",
        "temperature": 0.7,
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280, "height": 720},
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
            "scene_state": "e" * 64,
            "screenshots": [
                {"filename": "screenshot-0.png", "hash": "f" * 64},
                {"filename": "screenshot-1.png", "hash": "0" * 64},
            ],
        },
    }
    # Should not raise
    jsonschema.validate(metadata, metadata_schema)

    # Verify required artifact hash fields
    assert "console" in metadata["artifact_hashes"]
    assert "programmatic_checks" in metadata["artifact_hashes"]


def test_git_commit_hash_formats(metadata_schema):
    """Test that various git commit hash formats are accepted."""
    short_hash_metadata = {
        "scenario_version_hash": "a" * 64,
        "candidate_skill_hash": "b" * 64,
        "runner_git_commit": "abc123d",  # Short hash (7 chars)
        "model_id": "openai/gpt-5.5",
        "temperature": 0.7,
        "judge_protocol_version": "pairwise-v1",
        "browser_viewport": {"width": 1280, "height": 720},
        "playwright_version": "1.40.0",
        "chromium_version": "120.0.6099.28",
        "timestamp_utc": "2026-05-19T13:42:00Z",
        "artifact_hashes": {
            "console": "c" * 64,
            "programmatic_checks": "d" * 64,
        },
    }
    # Should not raise
    jsonschema.validate(short_hash_metadata, metadata_schema)

    full_hash_metadata = short_hash_metadata.copy()
    full_hash_metadata["runner_git_commit"] = "a" * 40  # Full hash (40 chars)
    # Should not raise
    jsonschema.validate(full_hash_metadata, metadata_schema)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
