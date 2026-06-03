#!/usr/bin/env python3
"""
Tests for the skills adapter implementation.

Tests cover:
- Input validation and error handling
- Safety scanning for Ion tokens and absolute paths
- CLI invocation and output generation
- Metadata collection and reproducibility
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from optimization.framework.adapters.skills_adapter import SkillsAdapter


class TestSkillsAdapter(unittest.TestCase):
    """Test suite for SkillsAdapter (claude CLI-backed)."""

    def setUp(self):
        """Set up test fixtures."""
        self.test_scenario = {
            "id": "eval-001",
            "name": "test-scenario",
            "prompt": "Create a simple Cesium viewer.",
            "expected_behaviors": ["Sets Ion.defaultAccessToken"],
        }

        self.test_skill_content = """# Cesium Viewer Setup Skill

## Creating a Basic Viewer

Use `new Cesium.Viewer('cesiumContainer')` to create a viewer.

Example:
```javascript
const viewer = new Cesium.Viewer('cesiumContainer');
```
"""

        # Create temporary skill file
        self.temp_dir = tempfile.mkdtemp()
        self.skill_path = Path(self.temp_dir) / "SKILL.md"
        self.skill_path.write_text(self.test_skill_content, encoding="utf-8")

        self.test_candidate = {
            "skill_path": str(self.skill_path)
        }

    def tearDown(self):
        """Clean up test fixtures."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_init_without_cli(self, mock_ensure):
        """Test that adapter raises ClaudeCLINotFoundError if the CLI isn't installed."""
        from optimization.framework.adapters.claude_cli import ClaudeCLINotFoundError
        mock_ensure.side_effect = ClaudeCLINotFoundError("claude CLI not found")
        with self.assertRaises(ClaudeCLINotFoundError):
            SkillsAdapter(skill="cesiumjs-viewer", iteration=1)

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_init_with_cli(self, mock_ensure):
        """Test successful initialization when the CLI is available."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(
            skill="cesiumjs-viewer",
            iteration=1,
            model_id="claude-sonnet-4-6",
            temperature=0.5
        )
        self.assertEqual(adapter.skill, "cesiumjs-viewer")
        self.assertEqual(adapter.iteration, 1)
        self.assertEqual(adapter.model_id, "claude-sonnet-4-6")
        self.assertEqual(adapter.temperature, 0.5)

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_prepare_validates_scenario(self, mock_ensure):
        """Test that prepare validates scenario structure."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)

        # Missing 'id' field
        with self.assertRaises(ValueError) as ctx:
            adapter.prepare({"prompt": "test"}, self.test_candidate)
        self.assertIn("id", str(ctx.exception))

        # Missing 'prompt' field
        with self.assertRaises(ValueError) as ctx:
            adapter.prepare({"id": "eval-001"}, self.test_candidate)
        self.assertIn("prompt", str(ctx.exception))

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_prepare_validates_candidate(self, mock_ensure):
        """Test that prepare validates candidate structure."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)

        # Missing 'skill_path' field
        with self.assertRaises(ValueError) as ctx:
            adapter.prepare(self.test_scenario, {})
        self.assertIn("skill_path", str(ctx.exception))

        # Skill file doesn't exist
        with self.assertRaises(ValueError) as ctx:
            adapter.prepare(self.test_scenario, {"skill_path": "/nonexistent/path"})
        self.assertIn("not found", str(ctx.exception))

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_prepare_reads_and_hashes_skill(self, mock_ensure):
        """Test that prepare reads skill content and computes hash."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)

        self.assertIsNotNone(adapter._skill_content)
        self.assertEqual(adapter._skill_content, self.test_skill_content)
        self.assertIsNotNone(adapter._skill_content_hash)
        self.assertEqual(len(adapter._skill_content_hash), 64)  # SHA-256 hex length

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_invoke_requires_prepare(self, mock_ensure):
        """Test that invoke raises error if prepare was not called."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)

        with self.assertRaises(RuntimeError) as ctx:
            adapter.invoke()
        self.assertIn("prepare()", str(ctx.exception))

    @patch('optimization.framework.adapters.skills_adapter.invoke_claude')
    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_invoke_calls_cli_and_writes_output(self, mock_ensure, mock_invoke):
        """Test that invoke calls the claude CLI and writes output files."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        mock_invoke.return_value = "const viewer = new Cesium.Viewer('cesiumContainer');"

        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)

        output_path = adapter.invoke()

        # Verify CLI was called with expected arguments
        mock_invoke.assert_called_once()
        call_kwargs = mock_invoke.call_args.kwargs
        self.assertEqual(call_kwargs["prompt"], self.test_scenario["prompt"])
        self.assertIn(self.test_skill_content, call_kwargs["system"])
        self.assertEqual(call_kwargs["model"], adapter.model_id)
        self.assertTrue(call_kwargs["disable_tools"])

        # Verify output files
        self.assertTrue(Path(output_path).exists())
        self.assertTrue(output_path.endswith("eval-001.js"))

        meta_path = output_path.replace(".js", ".meta.json")
        self.assertTrue(Path(meta_path).exists())
        metadata = json.loads(Path(meta_path).read_text())
        self.assertEqual(metadata["scenario_id"], "eval-001")
        self.assertEqual(metadata["skill"], "cesiumjs-viewer")
        self.assertEqual(metadata["iteration"], 1)
        self.assertIn("timestamp_utc", metadata)
        self.assertIn("skill_content_hash", metadata)

    @patch('optimization.framework.adapters.skills_adapter.invoke_claude')
    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_invoke_strips_code_fences(self, mock_ensure, mock_invoke):
        """Test that fenced code blocks are stripped from CLI output."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        mock_invoke.return_value = "```javascript\nconst viewer = new Cesium.Viewer('cesiumContainer');\n```"

        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)
        output_path = adapter.invoke()

        saved = Path(output_path).read_text()
        self.assertEqual(saved.strip(), "const viewer = new Cesium.Viewer('cesiumContainer');")

    @patch('optimization.framework.adapters.skills_adapter.invoke_claude')
    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_safety_scan_blocks_ion_token(self, mock_ensure, mock_invoke):
        """Test that safety scan blocks generated code containing Ion tokens."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        mock_invoke.return_value = """
const viewer = new Cesium.Viewer('cesiumContainer');
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.AAAABBBBCCCC.DDDDEEEEFFFFF';
"""

        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)

        with self.assertRaises(ValueError) as ctx:
            adapter.invoke()
        self.assertIn("Ion token", str(ctx.exception))
        self.assertIn("SAFETY VIOLATION", str(ctx.exception))

    @patch('optimization.framework.adapters.skills_adapter.invoke_claude')
    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_safety_scan_blocks_absolute_paths(self, mock_ensure, mock_invoke):
        """Test that safety scan blocks generated code containing absolute paths."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        mock_invoke.return_value = """
const viewer = new Cesium.Viewer('cesiumContainer');
// Debug: path is /Users/alice/secret/data.json
"""

        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)

        with self.assertRaises(ValueError) as ctx:
            adapter.invoke()
        self.assertIn("absolute", str(ctx.exception).lower())
        self.assertIn("SAFETY VIOLATION", str(ctx.exception))

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_collect_output_requires_invoke(self, mock_ensure):
        """Test that collect_output raises error if invoke was not called."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)

        with self.assertRaises(RuntimeError) as ctx:
            adapter.collect_output()
        self.assertIn("invoke()", str(ctx.exception))

    @patch('optimization.framework.adapters.skills_adapter.invoke_claude')
    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_collect_output_returns_path_and_metadata(self, mock_ensure, mock_invoke):
        """Test that collect_output returns correct path and metadata."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        mock_invoke.return_value = "const viewer = new Cesium.Viewer('cesiumContainer');"

        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)
        output_path = adapter.invoke()

        collected_path, metadata = adapter.collect_output()

        self.assertEqual(collected_path, output_path)
        self.assertEqual(metadata["scenario_id"], "eval-001")
        self.assertEqual(metadata["skill"], "cesiumjs-viewer")
        self.assertEqual(metadata["iteration"], 1)
        self.assertIn("timestamp_utc", metadata)
        self.assertIn("skill_content_hash", metadata)
        self.assertIn("model_id", metadata)
        self.assertIn("temperature", metadata)

    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_runtime_metadata(self, mock_ensure):
        """Test that runtime_metadata returns correct structure."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        adapter = SkillsAdapter(
            skill="cesiumjs-viewer",
            iteration=1,
            model_id="claude-sonnet-4-6",
            temperature=0.7
        )

        metadata = adapter.runtime_metadata()

        self.assertEqual(metadata["adapter_type"], "skills")
        self.assertIn("adapter_version", metadata)
        self.assertEqual(metadata["runtime_name"], "claude-cli")
        self.assertEqual(metadata["model_id"], "claude-sonnet-4-6")
        self.assertEqual(metadata["temperature"], 0.7)

    @patch('optimization.framework.adapters.skills_adapter.invoke_claude')
    @patch('optimization.framework.adapters.skills_adapter.ensure_cli_available')
    def test_full_workflow(self, mock_ensure, mock_invoke):
        """Test full adapter workflow: prepare -> invoke -> collect_output."""
        mock_ensure.return_value = "/usr/local/bin/claude"
        generated_code = """const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    timeline: false
});"""
        mock_invoke.return_value = generated_code

        adapter = SkillsAdapter(skill="cesiumjs-viewer", iteration=1)
        adapter.prepare(self.test_scenario, self.test_candidate)
        output_path = adapter.invoke()
        collected_path, metadata = adapter.collect_output()
        runtime_meta = adapter.runtime_metadata()

        self.assertEqual(output_path, collected_path)
        self.assertTrue(Path(output_path).exists())

        saved_code = Path(output_path).read_text()
        self.assertEqual(saved_code, generated_code)

        self.assertIsNotNone(metadata["skill_content_hash"])
        self.assertIsNotNone(metadata["timestamp_utc"])

        self.assertEqual(runtime_meta["adapter_type"], "skills")


if __name__ == "__main__":
    unittest.main()
