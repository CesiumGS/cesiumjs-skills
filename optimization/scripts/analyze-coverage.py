#!/usr/bin/env python3
"""
Coverage Analyzer for Cesium Skills Evaluation Framework

Parses skill markdown headings and code-block API references, reads scenario
manifests' optional target_skill_sections and expected_behaviors, and outputs
a coverage report mapping each skill section/API to the scenarios that
exercise it.

Usage:
    python3 optimization/scripts/analyze-coverage.py

Outputs:
    optimization/results/coverage.json - mapping of skill sections and APIs to scenarios
"""

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set, Tuple


def parse_skill_markdown(skill_path: str) -> Tuple[List[str], Set[str]]:
    """
    Parse a skill markdown file to extract headings and API references.

    Args:
        skill_path: Path to SKILL.md file

    Returns:
        (headings, apis) where:
        - headings is a list of section headings (e.g., ["Camera Fundamentals", "setView"])
        - apis is a set of API references (e.g., {"viewer.camera.setView", "Camera.flyTo"})
    """
    headings = []
    apis = set()

    if not os.path.exists(skill_path):
        return headings, apis

    with open(skill_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract markdown headings (## Heading or ### Heading)
    heading_pattern = re.compile(r'^#{2,3}\s+(.+)$', re.MULTILINE)
    for match in heading_pattern.finditer(content):
        heading = match.group(1).strip()
        # Remove markdown links, code formatting
        heading = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', heading)
        heading = re.sub(r'`([^`]+)`', r'\1', heading)
        headings.append(heading)

    # Extract API references from code blocks
    # Pattern: viewer.X, Viewer.X, Cesium.X.Y, Camera.X, etc.
    code_block_pattern = re.compile(r'```(?:javascript|js)?\n(.*?)```', re.DOTALL)
    for code_match in code_block_pattern.finditer(content):
        code = code_match.group(1)

        # API patterns to match:
        # - viewer.camera.setView
        # - Cesium.Cartesian3.fromDegrees
        # - Camera.flyTo
        # - viewer.entities.add
        api_pattern = re.compile(
            r'\b(?:viewer|Cesium|Viewer|Camera|Entity|DataSource|Scene|[A-Z][a-zA-Z0-9]+)\.[a-zA-Z_][a-zA-Z0-9_.]*[a-zA-Z0-9_]'
        )
        for api_match in api_pattern.finditer(code):
            api_ref = api_match.group(0)
            # Normalize: remove trailing parentheses if present
            api_ref = re.sub(r'\(\)$', '', api_ref)
            apis.add(api_ref)

    # Also extract API references from inline code (backticks)
    inline_api_pattern = re.compile(r'`([^`]+)`')
    for inline_match in inline_api_pattern.finditer(content):
        inline_code = inline_match.group(1)
        # Check if it looks like an API reference
        if re.match(r'^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z_][a-zA-Z0-9_.]*$', inline_code):
            apis.add(inline_code)

    return headings, apis


def load_scenarios() -> List[Dict]:
    """Load all scenario manifests from optimization/scenarios/."""
    scenarios = []
    scenarios_dir = Path('optimization/scenarios')

    if not scenarios_dir.exists():
        return scenarios

    for skill_dir in sorted(scenarios_dir.iterdir()):
        if not skill_dir.is_dir():
            continue

        for scenario_file in sorted(skill_dir.glob('*.json')):
            try:
                with open(scenario_file, 'r', encoding='utf-8') as f:
                    scenario = json.load(f)
                    # Add skill name to scenario for reference
                    scenario['_skill'] = skill_dir.name
                    # Use relative path from scenarios_dir
                    scenario['_file'] = f"{skill_dir.name}/{scenario_file.name}"
                    scenarios.append(scenario)
            except Exception as e:
                print(f"Warning: Failed to load {scenario_file}: {e}", file=sys.stderr)

    return scenarios


def extract_scenario_apis(scenario: Dict) -> Set[str]:
    """
    Extract API references from a scenario's expected_behaviors and programmatic_checks.

    Args:
        scenario: Scenario manifest dict

    Returns:
        Set of API references mentioned in the scenario
    """
    apis = set()

    # Extract from expected_behaviors
    for behavior in scenario.get('expected_behaviors', []):
        # Look for API-like patterns: word.word or Word.word
        api_pattern = re.compile(r'\b[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z_][a-zA-Z0-9_.]*')
        for match in api_pattern.finditer(behavior):
            apis.add(match.group(0))

    # Extract from programmatic_checks with type: api_present
    for check in scenario.get('programmatic_checks', []):
        if check.get('type') == 'api_present':
            api = check.get('api', '')
            if api:
                apis.add(api)

    # Extract from pattern checks that might reference APIs
    for check in scenario.get('programmatic_checks', []):
        if check.get('type') in ['pattern_present', 'pattern_absent']:
            pattern = check.get('pattern', '')
            # Try to find API-like patterns in the pattern string
            # e.g., "viewer\.camera\.flyTo" -> "viewer.camera.flyTo"
            cleaned = pattern.replace('\\', '')
            api_pattern = re.compile(r'\b[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z_][a-zA-Z0-9_.]*')
            for match in api_pattern.finditer(cleaned):
                apis.add(match.group(0))

    return apis


def normalize_api(api: str) -> str:
    """
    Normalize API reference for matching.

    Examples:
        viewer.camera.flyTo -> camera.flyTo
        Camera.flyTo -> Camera.flyTo
        Cesium.Cartesian3.fromDegrees -> Cartesian3.fromDegrees
    """
    # Remove 'viewer.' prefix for comparison
    if api.startswith('viewer.'):
        return api[7:]  # Remove "viewer."
    # Remove 'Cesium.' prefix for comparison
    if api.startswith('Cesium.'):
        return api[7:]  # Remove "Cesium."
    return api


def apis_match(skill_api: str, scenario_api: str) -> bool:
    """
    Check if a scenario API reference matches a skill API reference.

    Uses fuzzy matching: compares normalized forms and checks for containment.

    Examples:
        skill: "viewer.camera.flyTo", scenario: "flyTo" -> True
        skill: "Camera.flyTo", scenario: "camera.flyTo" -> True
        skill: "Cartesian3.fromDegrees", scenario: "viewer.scene.camera" -> False
    """
    skill_norm = normalize_api(skill_api).lower()
    scenario_norm = normalize_api(scenario_api).lower()

    # Direct match
    if skill_norm == scenario_norm:
        return True

    # Check if scenario API is a suffix of skill API (e.g., "flyTo" matches "camera.flyTo")
    if skill_norm.endswith('.' + scenario_norm):
        return True

    # Check if skill API is a suffix of scenario API
    if scenario_norm.endswith('.' + skill_norm):
        return True

    # Check for partial containment (e.g., "camera.flyTo" in "viewer.camera.flyTo")
    if scenario_norm in skill_norm or skill_norm in scenario_norm:
        return True

    return False


def heading_matches_scenario(heading: str, scenario: Dict) -> bool:
    """
    Check if a heading is relevant to a scenario based on expected_behaviors
    and scenario attributes.

    Uses keyword matching and semantic relevance.
    """
    # Normalize heading for comparison
    heading_lower = heading.lower()

    # Check target_skill_sections if present
    target_sections = scenario.get('target_skill_sections', [])
    for section in target_sections:
        if section.lower() in heading_lower or heading_lower in section.lower():
            return True

    # Check expected_behaviors for keywords
    behaviors_text = ' '.join(scenario.get('expected_behaviors', [])).lower()

    # Extract key terms from heading
    # Remove common words
    stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'}
    heading_words = set(re.findall(r'\b[a-z]+\b', heading_lower)) - stop_words

    # Check if any heading words appear in behaviors
    if heading_words and any(word in behaviors_text for word in heading_words if len(word) > 3):
        return True

    # Check scenario name, description, and prompt for heading keywords
    search_text = ' '.join([
        scenario.get('name', ''),
        scenario.get('description', ''),
        scenario.get('prompt', '')
    ]).lower()

    if any(word in search_text for word in heading_words if len(word) > 3):
        return True

    return False


def analyze_coverage() -> Dict:
    """
    Main coverage analysis function.

    Returns:
        Coverage report dict with structure:
        {
            "skills": {
                "skill-name": {
                    "sections": [
                        {
                            "heading": "Section Name",
                            "scenarios": ["skill/eval-id", ...]
                        },
                        ...
                    ],
                    "apis": [
                        {
                            "api": "api.reference",
                            "scenarios": ["skill/eval-id", ...]
                        },
                        ...
                    ],
                    "uncovered_sections": [...],
                    "uncovered_apis": [...]
                }
            }
        }
    """
    # Load all scenarios
    scenarios = load_scenarios()

    # Build coverage report
    report = {"skills": {}}

    # Find all skill directories
    skills_dir = Path('skills')
    if not skills_dir.exists():
        return report

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue

        skill_name = skill_dir.name
        skill_path = skill_dir / 'SKILL.md'

        if not skill_path.exists():
            continue

        # Parse skill markdown
        headings, apis = parse_skill_markdown(str(skill_path))

        # Initialize skill coverage
        skill_coverage = {
            "sections": [],
            "apis": [],
            "uncovered_sections": [],
            "uncovered_apis": []
        }

        # Map sections to scenarios
        for heading in headings:
            covered_scenarios = []
            for scenario in scenarios:
                # Only check scenarios for this skill
                if scenario.get('_skill') != skill_name:
                    continue

                if heading_matches_scenario(heading, scenario):
                    scenario_ref = f"{scenario['_skill']}/{scenario['id']}"
                    covered_scenarios.append(scenario_ref)

            section_entry = {
                "heading": heading,
                "scenarios": covered_scenarios
            }
            skill_coverage["sections"].append(section_entry)

            if not covered_scenarios:
                skill_coverage["uncovered_sections"].append(heading)

        # Map APIs to scenarios
        for api in sorted(apis):
            covered_scenarios = []
            for scenario in scenarios:
                # Check all scenarios (APIs might be used across skills)
                scenario_apis = extract_scenario_apis(scenario)

                # Check if any scenario API matches this skill API
                if any(apis_match(api, scenario_api) for scenario_api in scenario_apis):
                    scenario_ref = f"{scenario['_skill']}/{scenario['id']}"
                    covered_scenarios.append(scenario_ref)

            api_entry = {
                "api": api,
                "scenarios": covered_scenarios
            }
            skill_coverage["apis"].append(api_entry)

            if not covered_scenarios:
                skill_coverage["uncovered_apis"].append(api)

        report["skills"][skill_name] = skill_coverage

    return report


def main():
    """Main entry point."""
    # Analyze coverage
    report = analyze_coverage()

    # Ensure output directory exists
    output_dir = Path('optimization/results')
    output_dir.mkdir(parents=True, exist_ok=True)

    # Write coverage report
    output_path = output_dir / 'coverage.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
        f.write('\n')

    print(f"Coverage report written to {output_path}")

    # Print summary
    total_sections = 0
    uncovered_sections = 0
    total_apis = 0
    uncovered_apis = 0

    for skill_name, skill_data in report['skills'].items():
        sections_count = len(skill_data['sections'])
        uncovered_sections_count = len(skill_data['uncovered_sections'])
        apis_count = len(skill_data['apis'])
        uncovered_apis_count = len(skill_data['uncovered_apis'])

        total_sections += sections_count
        uncovered_sections += uncovered_sections_count
        total_apis += apis_count
        uncovered_apis += uncovered_apis_count

        print(f"\n{skill_name}:")
        print(f"  Sections: {sections_count - uncovered_sections_count}/{sections_count} covered")
        print(f"  APIs: {apis_count - uncovered_apis_count}/{apis_count} covered")

    print(f"\n=== Overall Summary ===")
    print(f"Total sections: {total_sections}")
    print(f"Covered sections: {total_sections - uncovered_sections}")
    print(f"Uncovered sections: {uncovered_sections}")
    print(f"Total APIs: {total_apis}")
    print(f"Covered APIs: {total_apis - uncovered_apis}")
    print(f"Uncovered APIs: {uncovered_apis}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
