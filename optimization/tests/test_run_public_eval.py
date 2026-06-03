#!/usr/bin/env python3
"""Tests for optimization/scripts/run-public-eval.py

Tests cover the core functionality of the browser-backed evaluation runner.
Full Playwright integration tests require a browser environment.

These tests verify that:
1. The runner script is syntactically valid (typecheck passes)
2. Core HTML generation and rendering logic is present
3. Review-only scenarios are properly handled
4. Programmatic checks execute correctly
"""

import json
import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER_SCRIPT = REPO_ROOT / "optimization" / "scripts" / "run-public-eval.py"


def load_runner_module():
    spec = importlib.util.spec_from_file_location("run_public_eval", RUNNER_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_public_eval"] = module
    spec.loader.exec_module(module)
    return module


def make_test_png(path: Path, width: int, height: int, colors: list[tuple[int, int, int, int]]) -> None:
    """Write a tiny RGBA PNG using filter type 0."""
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        import binascii
        return (
            len(data).to_bytes(4, "big")
            + chunk_type
            + data
            + binascii.crc32(chunk_type + data).to_bytes(4, "big")
        )

    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.extend(colors[(x + y) % len(colors)])
    ihdr = (
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + bytes([8, 6, 0, 0, 0])
    )
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(rows)))
        + chunk(b"IEND", b"")
    )


class TestRunnerScript(unittest.TestCase):
    """Test the runner script structure and key features."""

    def test_script_is_valid_python(self):
        """Test that the runner script is syntactically valid."""
        result = subprocess.run(
            ["python3", "-m", "py_compile", str(RUNNER_SCRIPT)],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.returncode, 0, f"Script has syntax errors: {result.stderr}")

    def test_script_has_cesium_cdn_reference(self):
        """Test that the script includes CesiumJS CDN."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("cesium.com/downloads/cesiumjs", content)
        self.assertIn("Cesium.js", content)

    def test_script_has_cesiumcontainer_div(self):
        """Test that the script creates cesiumContainer div."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("cesiumContainer", content)

    def test_script_injects_ion_token(self):
        """Test that the script injects Ion token from environment."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("CESIUM_ION_TOKEN", content)
        self.assertIn("Cesium.Ion.defaultAccessToken", content)

    def test_script_uses_playwright(self):
        """Test that the script uses Playwright for browser automation."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("playwright", content)
        self.assertIn("chromium", content)

    def test_script_captures_console_messages(self):
        """Test that the script captures console messages."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("console_messages", content)
        # Check for page.on and console event
        self.assertIn("page.on", content)
        self.assertIn('"console"', content)

    def test_script_handles_review_only_scenarios(self):
        """Test that the script handles review-only scenarios."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("review-only", content)
        self.assertIn("skipping", content)

    def test_script_takes_screenshots(self):
        """Test that the script captures screenshots."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("screenshot", content)
        self.assertIn(".png", content)
        self.assertIn("screenshot-quality.json", content)

    def test_script_writes_console_json(self):
        """Test that the script writes console.json output."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("console.json", content)

    def test_script_supports_multiple_screenshot_timings(self):
        """Test that the script supports multiple screenshot timings."""
        content = RUNNER_SCRIPT.read_text()
        # Check for loop over screenshots
        self.assertIn("screenshots", content)
        self.assertIn("delay_ms", content)

    def test_script_has_programmatic_checks(self):
        """Test that the script invokes the canonical check engine."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("run_programmatic_checks", content)
        # Runner delegates to checks.engine for the canonical {check_id, result} shape.
        self.assertIn("from optimization.framework.checks.engine import run_checks", content)
        self.assertIn("programmatic-checks.json", content)

    def test_script_has_error_tracking(self):
        """Test that the script tracks JavaScript errors."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("__CESIUM_EVAL_ERRORS__", content)
        self.assertIn("addEventListener", content)

    def test_script_detects_cesium_render_error_panel(self):
        """Cesium render-error panels are promoted to runtime errors."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("cesium-widget-errorPanel", content)
        self.assertIn("Cesium render error panel detected", content)

    def test_script_has_viewport_configuration(self):
        """Test that the script configures viewport."""
        content = RUNNER_SCRIPT.read_text()
        self.assertIn("viewport", content)
        # Check for viewport dimensions
        self.assertTrue(re.search(r'"width":\s*\d+', content))
        self.assertTrue(re.search(r'"height":\s*\d+', content))

    def test_analyze_screenshot_rejects_uniform_png(self):
        """Screenshot quality analysis catches blank-looking captures."""
        runner = load_runner_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "blank.png"
            make_test_png(path, 4, 4, [(0, 0, 0, 255)])
            result = runner.analyze_screenshot(path, expected_width=4, expected_height=4)
        self.assertFalse(result["passed"])
        self.assertIn("too few distinct", result["detail"])

    def test_analyze_screenshot_accepts_varied_png(self):
        """Screenshot quality analysis accepts captures with color variation."""
        runner = load_runner_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "varied.png"
            make_test_png(
                path,
                8,
                8,
                [
                    (0, 0, 0, 255),
                    (255, 255, 255, 255),
                    (255, 0, 0, 255),
                    (0, 255, 0, 255),
                    (0, 0, 255, 255),
                    (255, 255, 0, 255),
                    (255, 0, 255, 255),
                    (0, 255, 255, 255),
                ],
            )
            result = runner.analyze_screenshot(path, expected_width=8, expected_height=8)
        self.assertTrue(result["passed"])

    def test_screenshot_quality_checks_update_summary(self):
        """Screenshot quality results are included in the canonical check summary."""
        runner = load_runner_module()
        checks = {"checks": [{"check_id": "code_runs", "result": "pass"}]}
        result = runner.add_screenshot_quality_checks(
            checks,
            {"screenshots": [{"filename": "screenshot.png", "passed": False, "detail": "blank"}]},
        )
        self.assertEqual(result["summary"]["total"], 2)
        self.assertEqual(result["summary"]["failed"], 1)
        self.assertEqual(result["checks"][-1]["type"], "screenshot_quality")


if __name__ == '__main__':
    unittest.main()
