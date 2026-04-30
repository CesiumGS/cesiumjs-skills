#!/usr/bin/env python3
"""
Coverage Analyzer for CesiumJS Skill Documents

Parses a SKILL.md file, extracts all sections and code examples,
and cross-references with eval scenarios to produce a coverage report.

Usage:
    python3 coverage-analyzer.py <skill-md-path> <evals-dir>
"""

import sys
import os
import re
import json
import hashlib

def parse_skill_sections(skill_path):
    """Parse SKILL.md into sections with their content, code blocks, and API references."""
    with open(skill_path) as f:
        content = f.read()

    # Strip YAML frontmatter
    if content.startswith("---"):
        end = content.index("---", 3)
        content = content[end + 3:].strip()

    sections = []
    current_section = None
    current_content = []
    current_level = 0

    for line in content.split("\n"):
        heading_match = re.match(r'^(#{1,4})\s+(.+)', line)
        if heading_match:
            # Save previous section
            if current_section:
                section_text = "\n".join(current_content)
                sections.append({
                    "heading": current_section,
                    "level": current_level,
                    "content": section_text,
                    "code_blocks": extract_code_blocks(section_text),
                    "api_references": extract_api_references(section_text),
                    "line_count": len(current_content),
                })
            current_level = len(heading_match.group(1))
            current_section = heading_match.group(2).strip()
            current_content = []
        else:
            current_content.append(line)

    # Save last section
    if current_section:
        section_text = "\n".join(current_content)
        sections.append({
            "heading": current_section,
            "level": current_level,
            "content": section_text,
            "code_blocks": extract_code_blocks(section_text),
            "api_references": extract_api_references(section_text),
            "line_count": len(current_content),
        })

    return sections


def extract_code_blocks(text):
    """Extract fenced code blocks from section content."""
    blocks = []
    pattern = re.compile(r'```(?:js|javascript)?\s*\n(.*?)```', re.DOTALL)
    for match in pattern.finditer(text):
        code = match.group(1).strip()
        blocks.append({
            "code": code,
            "apis_used": extract_api_references(code),
            "hash": hashlib.md5(code.encode()).hexdigest()[:8],
        })
    return blocks


def extract_api_references(text):
    """Extract CesiumJS API names from text."""
    # Match common CesiumJS patterns
    patterns = [
        r'(?:Cesium\.)?([A-Z][a-zA-Z]+(?:\.[a-z][a-zA-Z]+)?)\s*\(',  # Constructor/method calls
        r'(?:camera|viewer|scene|ctrl)\.([\w]+)',  # Property access on common objects
        r'(flyTo|setView|lookAt|lookAtTransform|flyHome|flyToBoundingSphere|viewBoundingSphere)',
        r'(HeadingPitchRange|ScreenSpaceCameraController|CameraEventType|KeyboardEventModifier)',
        r'(moveForward|moveBackward|moveUp|moveDown|moveLeft|moveRight)',
        r'(rotateUp|rotateDown|rotateLeft|rotateRight)',
        r'(lookUp|lookDown|lookLeft|lookRight|twistLeft|twistRight)',
        r'(zoomIn|zoomOut)',
        r'(pickEllipsoid|trackedEntity|DEFAULT_VIEW_RECTANGLE|DEFAULT_OFFSET)',
        r'(enableRotate|enableTilt|enableZoom|enableTranslate|enableLook|enableInputs)',
        r'(minimumZoomDistance|maximumZoomDistance|maximumTiltAngle)',
        r'(inertiaSpin|inertiaZoom|inertiaTranslate)',
        r'(enableCollisionDetection)',
        r'(moveStart|moveEnd|changed|percentageChanged)',
        r'(completeFlight|cancelFlight)',
        r'(DebugCameraPrimitive)',
        r'(EasingFunction)',
    ]
    apis = set()
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            apis.add(match.group(1) if match.lastindex else match.group(0))
    return sorted(apis)


def load_evals(evals_dir):
    """Load all eval scenario JSON files."""
    evals = []
    if not os.path.isdir(evals_dir):
        return evals
    for fname in sorted(os.listdir(evals_dir)):
        if fname.endswith(".json"):
            with open(os.path.join(evals_dir, fname)) as f:
                evals.append(json.load(f))
    return evals


def compute_coverage(sections, evals):
    """Cross-reference sections with evals to find coverage gaps."""
    coverage = []

    for section in sections:
        if section["level"] > 3:  # Skip sub-sub-sections
            continue

        # Find evals that might exercise this section
        section_apis = set(section["api_references"])
        section_keywords = set(re.findall(r'\b\w+\b', section["heading"].lower()))

        matching_evals = []
        for ev in evals:
            eval_text = json.dumps(ev).lower()
            # Check if any section APIs appear in the eval
            api_overlap = [api for api in section_apis if api.lower() in eval_text]
            # Check if section heading keywords appear
            keyword_overlap = [kw for kw in section_keywords if kw in eval_text and len(kw) > 3]

            if api_overlap or keyword_overlap:
                matching_evals.append({
                    "eval_id": ev.get("id", "unknown"),
                    "eval_name": ev.get("name", "unknown"),
                    "api_overlap": api_overlap,
                    "keyword_overlap": keyword_overlap,
                })

        coverage.append({
            "section": section["heading"],
            "level": section["level"],
            "line_count": section["line_count"],
            "code_block_count": len(section["code_blocks"]),
            "api_count": len(section["api_references"]),
            "apis": section["api_references"][:10],  # Top 10
            "covered_by": matching_evals,
            "is_covered": len(matching_evals) > 0,
        })

    return coverage


def print_report(coverage, skill_path, evals_dir):
    """Print a human-readable coverage report."""
    total = len(coverage)
    covered = sum(1 for c in coverage if c["is_covered"])
    uncovered = [c for c in coverage if not c["is_covered"]]

    report = {
        "skill_path": skill_path,
        "evals_dir": evals_dir,
        "total_sections": total,
        "covered_sections": covered,
        "uncovered_sections": total - covered,
        "coverage_percentage": round(covered / total * 100, 1) if total > 0 else 0,
        "sections": coverage,
        "uncovered_list": [
            {
                "section": c["section"],
                "level": c["level"],
                "line_count": c["line_count"],
                "code_blocks": c["code_block_count"],
                "apis": c["apis"],
            }
            for c in uncovered
        ],
    }

    # Print summary to stdout
    print(f"\n{'='*60}")
    print(f"COVERAGE REPORT: {os.path.basename(skill_path)}")
    print(f"{'='*60}")
    print(f"Total sections: {total}")
    print(f"Covered:        {covered} ({report['coverage_percentage']}%)")
    print(f"Uncovered:      {total - covered}")
    print()

    if uncovered:
        print("UNCOVERED SECTIONS:")
        for c in uncovered:
            indent = "  " * (c["level"] - 1)
            print(f"  {indent}{'#' * c['level']} {c['section']} ({c['line_count']} lines, {c['code_block_count']} code blocks)")
            if c["apis"]:
                print(f"  {indent}  APIs: {', '.join(c['apis'][:5])}")
        print()

    print("COVERED SECTIONS:")
    for c in coverage:
        if c["is_covered"]:
            indent = "  " * (c["level"] - 1)
            eval_names = [e["eval_name"] for e in c["covered_by"]]
            print(f"  {indent}{'#' * c['level']} {c['section']} → {', '.join(eval_names)}")

    # Write JSON report
    return report


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <skill-md-path> <evals-dir>")
        sys.exit(1)

    skill_path = sys.argv[1]
    evals_dir = sys.argv[2]

    sections = parse_skill_sections(skill_path)
    evals = load_evals(evals_dir)
    coverage = compute_coverage(sections, evals)
    report = print_report(coverage, skill_path, evals_dir)

    # Write JSON report to stdout as well
    report_path = os.path.join(os.path.dirname(evals_dir), "coverage-report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nJSON report written to: {report_path}")
