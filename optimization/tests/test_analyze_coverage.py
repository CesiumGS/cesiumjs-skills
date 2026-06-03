#!/usr/bin/env python3
"""Tests for optimization/scripts/analyze-coverage.py"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Import the module
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import importlib.util
spec = importlib.util.spec_from_file_location(
    "analyze_coverage",
    Path(__file__).resolve().parents[2] / "optimization" / "scripts" / "analyze-coverage.py"
)
analyze_coverage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyze_coverage)


class TestParseSkillMarkdown(unittest.TestCase):
    """Test parse_skill_markdown function."""

    def test_extract_headings(self):
        """Test extraction of markdown headings."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("""# Skill Title
## Camera Fundamentals
Some content here.
### Nested Section
More content.
## setView -- Instant Placement
Code examples.
""")
            f.flush()
            temp_path = f.name

        try:
            headings, apis = analyze_coverage.parse_skill_markdown(temp_path)
            self.assertIn("Camera Fundamentals", headings)
            self.assertIn("Nested Section", headings)
            self.assertIn("setView -- Instant Placement", headings)
            # H1 should not be included
            self.assertNotIn("Skill Title", headings)
        finally:
            os.unlink(temp_path)

    def test_extract_apis_from_code_blocks(self):
        """Test extraction of API references from code blocks."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("""## Example

```javascript
viewer.camera.setView({
  destination: Cartesian3.fromDegrees(-75.0, 40.0, 1000.0)
});

const entity = viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(-75.0, 40.0)
});
```
""")
            f.flush()
            temp_path = f.name

        try:
            headings, apis = analyze_coverage.parse_skill_markdown(temp_path)
            self.assertIn("viewer.camera.setView", apis)
            self.assertIn("Cartesian3.fromDegrees", apis)
            self.assertIn("viewer.entities.add", apis)
            self.assertIn("Cesium.Cartesian3.fromDegrees", apis)
        finally:
            os.unlink(temp_path)

    def test_extract_apis_from_inline_code(self):
        """Test extraction of API references from inline backticks."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("""## Example

Use `viewer.camera.flyTo` to animate the camera. The `Cartesian3.fromDegrees`
method converts coordinates.
""")
            f.flush()
            temp_path = f.name

        try:
            headings, apis = analyze_coverage.parse_skill_markdown(temp_path)
            self.assertIn("viewer.camera.flyTo", apis)
            self.assertIn("Cartesian3.fromDegrees", apis)
        finally:
            os.unlink(temp_path)

    def test_nonexistent_file(self):
        """Test handling of nonexistent file."""
        headings, apis = analyze_coverage.parse_skill_markdown("/nonexistent/path.md")
        self.assertEqual(headings, [])
        self.assertEqual(apis, set())

    def test_remove_markdown_formatting(self):
        """Test removal of markdown formatting from headings."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("""## `Camera.flyTo` Method
## [Link Text](http://example.com)
""")
            f.flush()
            temp_path = f.name

        try:
            headings, apis = analyze_coverage.parse_skill_markdown(temp_path)
            self.assertIn("Camera.flyTo Method", headings)
            self.assertIn("Link Text", headings)
        finally:
            os.unlink(temp_path)


class TestExtractScenarioApis(unittest.TestCase):
    """Test extract_scenario_apis function."""

    def test_extract_from_expected_behaviors(self):
        """Test extraction from expected_behaviors."""
        scenario = {
            "expected_behaviors": [
                "Uses viewer.camera.flyTo to animate",
                "Should call Cartesian3.fromDegrees with coordinates"
            ]
        }
        apis = analyze_coverage.extract_scenario_apis(scenario)
        self.assertIn("viewer.camera.flyTo", apis)
        self.assertIn("Cartesian3.fromDegrees", apis)

    def test_extract_from_api_present_checks(self):
        """Test extraction from api_present programmatic checks."""
        scenario = {
            "programmatic_checks": [
                {"type": "api_present", "api": "viewer.entities.add"},
                {"type": "no_console_errors"}
            ]
        }
        apis = analyze_coverage.extract_scenario_apis(scenario)
        self.assertIn("viewer.entities.add", apis)

    def test_extract_from_pattern_checks(self):
        """Test extraction from pattern checks."""
        scenario = {
            "programmatic_checks": [
                {"type": "pattern_present", "pattern": "viewer\\.camera\\.flyTo"},
                {"type": "pattern_absent", "pattern": "Cartesian3\\.fromDegrees"}
            ]
        }
        apis = analyze_coverage.extract_scenario_apis(scenario)
        self.assertIn("viewer.camera.flyTo", apis)
        self.assertIn("Cartesian3.fromDegrees", apis)

    def test_empty_scenario(self):
        """Test scenario with no API references."""
        scenario = {}
        apis = analyze_coverage.extract_scenario_apis(scenario)
        self.assertEqual(apis, set())


class TestNormalizeApi(unittest.TestCase):
    """Test normalize_api function."""

    def test_remove_viewer_prefix(self):
        """Test removal of viewer. prefix."""
        self.assertEqual(
            analyze_coverage.normalize_api("viewer.camera.flyTo"),
            "camera.flyTo"
        )

    def test_remove_cesium_prefix(self):
        """Test removal of Cesium. prefix."""
        self.assertEqual(
            analyze_coverage.normalize_api("Cesium.Cartesian3.fromDegrees"),
            "Cartesian3.fromDegrees"
        )

    def test_no_prefix(self):
        """Test API without prefix."""
        self.assertEqual(
            analyze_coverage.normalize_api("Camera.flyTo"),
            "Camera.flyTo"
        )


class TestApisMatch(unittest.TestCase):
    """Test apis_match function."""

    def test_direct_match(self):
        """Test direct matching."""
        self.assertTrue(analyze_coverage.apis_match("camera.flyTo", "camera.flyTo"))

    def test_case_insensitive_match(self):
        """Test case-insensitive matching."""
        self.assertTrue(analyze_coverage.apis_match("Camera.flyTo", "camera.flyTo"))

    def test_suffix_match(self):
        """Test suffix matching."""
        self.assertTrue(analyze_coverage.apis_match("camera.flyTo", "flyTo"))
        self.assertTrue(analyze_coverage.apis_match("viewer.camera.flyTo", "camera.flyTo"))

    def test_partial_containment(self):
        """Test partial containment matching."""
        self.assertTrue(analyze_coverage.apis_match("viewer.camera.flyTo", "camera.flyTo"))
        self.assertTrue(analyze_coverage.apis_match("camera.flyTo", "viewer.camera.flyTo"))

    def test_no_match(self):
        """Test non-matching APIs."""
        self.assertFalse(analyze_coverage.apis_match("camera.flyTo", "entities.add"))
        self.assertFalse(analyze_coverage.apis_match("Cartesian3.fromDegrees", "Cartesian2.fromDegrees"))


class TestHeadingMatchesScenario(unittest.TestCase):
    """Test heading_matches_scenario function."""

    def test_target_skill_sections_match(self):
        """Test matching via target_skill_sections."""
        scenario = {
            "target_skill_sections": ["Camera Fundamentals", "flyTo animation"]
        }
        self.assertTrue(analyze_coverage.heading_matches_scenario("Camera Fundamentals", scenario))
        self.assertTrue(analyze_coverage.heading_matches_scenario("flyTo animation", scenario))

    def test_expected_behaviors_keyword_match(self):
        """Test matching via keywords in expected_behaviors."""
        scenario = {
            "expected_behaviors": [
                "Uses flyTo to animate the camera smoothly",
                "Camera should move to the target position"
            ]
        }
        self.assertTrue(analyze_coverage.heading_matches_scenario("flyTo animation", scenario))
        self.assertTrue(analyze_coverage.heading_matches_scenario("Camera positioning", scenario))

    def test_scenario_name_description_prompt_match(self):
        """Test matching via scenario name, description, and prompt."""
        scenario = {
            "name": "eiffel-tower-view",
            "description": "Position camera at the Eiffel Tower",
            "prompt": "Use setView to position the camera"
        }
        self.assertTrue(analyze_coverage.heading_matches_scenario("setView method", scenario))
        self.assertTrue(analyze_coverage.heading_matches_scenario("Eiffel Tower positioning", scenario))

    def test_no_match(self):
        """Test non-matching heading."""
        scenario = {
            "expected_behaviors": ["Uses entities to display points"],
            "name": "point-display",
            "description": "Display points on the map"
        }
        self.assertFalse(analyze_coverage.heading_matches_scenario("Camera positioning", scenario))


class TestAnalyzeCoverage(unittest.TestCase):
    """Test analyze_coverage function integration."""

    def test_analyze_coverage_structure(self):
        """Test that analyze_coverage returns expected structure."""
        # This test runs on the actual codebase
        report = analyze_coverage.analyze_coverage()

        # Check top-level structure
        self.assertIn("skills", report)
        self.assertIsInstance(report["skills"], dict)

        # Check that at least some skills are present
        self.assertGreater(len(report["skills"]), 0)

        # Check structure of each skill
        for skill_name, skill_data in report["skills"].items():
            self.assertIn("sections", skill_data)
            self.assertIn("apis", skill_data)
            self.assertIn("uncovered_sections", skill_data)
            self.assertIn("uncovered_apis", skill_data)

            self.assertIsInstance(skill_data["sections"], list)
            self.assertIsInstance(skill_data["apis"], list)
            self.assertIsInstance(skill_data["uncovered_sections"], list)
            self.assertIsInstance(skill_data["uncovered_apis"], list)

            # Check section structure
            for section in skill_data["sections"]:
                self.assertIn("heading", section)
                self.assertIn("scenarios", section)
                self.assertIsInstance(section["scenarios"], list)

            # Check API structure
            for api in skill_data["apis"]:
                self.assertIn("api", api)
                self.assertIn("scenarios", api)
                self.assertIsInstance(api["scenarios"], list)

    def test_analyze_coverage_no_absolute_paths(self):
        """Test that coverage report contains no absolute paths."""
        report = analyze_coverage.analyze_coverage()

        # Convert report to JSON string
        report_json = json.dumps(report)

        # Check for absolute path patterns
        self.assertNotIn("/Users/", report_json)
        self.assertNotIn("/home/", report_json)
        self.assertNotIn("C:\\Users\\", report_json)


class TestLoadScenarios(unittest.TestCase):
    """Test load_scenarios function."""

    def test_load_scenarios_structure(self):
        """Test that loaded scenarios have expected structure."""
        scenarios = analyze_coverage.load_scenarios()

        # Should load at least some scenarios
        self.assertGreater(len(scenarios), 0)

        # Check structure of each scenario
        for scenario in scenarios:
            self.assertIn("id", scenario)
            self.assertIn("_skill", scenario)
            self.assertIn("_file", scenario)

            # Check that _file is a relative path
            self.assertFalse(scenario["_file"].startswith("/"))
            self.assertFalse(scenario["_file"].startswith("C:\\"))


class TestCoverageOutput(unittest.TestCase):
    """Test coverage output and public safety."""

    def test_output_passes_public_safety(self):
        """Test that coverage.json passes public safety checks."""
        # Generate coverage report
        report = analyze_coverage.analyze_coverage()

        # Write to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(report, f, indent=2)
            temp_path = f.name

        try:
            # The report should not contain Ion tokens or absolute paths
            with open(temp_path, 'r') as f:
                content = f.read()

            # Check for Ion token patterns (JWT)
            import re
            jwt_pattern = re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')
            self.assertIsNone(jwt_pattern.search(content), "Coverage report contains Ion token")

            # Check for absolute paths
            self.assertNotIn("/Users/", content)
            self.assertNotIn("/home/", content)
            self.assertNotIn("C:\\Users\\", content)

            # Check for email addresses (should not be present)
            email_pattern = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
            emails = email_pattern.findall(content)
            # Filter out allowed bot emails
            disallowed_emails = [
                email for email in emails
                if not email.endswith('@github.com')
                and not email.endswith('@users.noreply.github.com')
            ]
            self.assertEqual(disallowed_emails, [], f"Coverage report contains emails: {disallowed_emails}")
        finally:
            os.unlink(temp_path)


if __name__ == '__main__':
    unittest.main()
