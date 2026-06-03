#!/usr/bin/env python3
"""Validate pure deterministic evaluation case manifests."""

from __future__ import annotations

import ast
import copy
import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator


REPO_ROOT = Path(__file__).resolve().parents[2]
CASES_ROOT = REPO_ROOT / "evaluation" / "cases"
FIXTURES_ROOT = REPO_ROOT / "evaluation" / "fixtures"
SCHEMA_ROOT = REPO_ROOT / "evaluation" / "schemas"
FORBIDDEN_IMPORT_ROOTS = {"optimization"}
SUBPROCESS_CALLS = {"run", "Popen", "call", "check_call", "check_output"}


def fail(message: str) -> None:
    print(f"[validate-evaluation] FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid JSON: {exc}")


def load_case_schema() -> dict[str, Any]:
    case_schema = copy.deepcopy(load_json(SCHEMA_ROOT / "case.schema.json"))
    # Validate each check with check.schema.json separately so the check
    # schema's local refs resolve against that schema root.
    case_schema["properties"]["checks"]["items"] = {"type": "object"}
    return case_schema


def validate_json_schema(name: str, schema: dict[str, Any]) -> None:
    try:
        Draft7Validator.check_schema(schema)
    except Exception as exc:
        fail(f"{name}: invalid JSON schema: {exc}")


def relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def evaluation_python_paths(root: Path = REPO_ROOT / "evaluation") -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def module_root(module_name: str | None) -> str:
    if not module_name:
        return ""
    return module_name.split(".", 1)[0]


def literal_strings(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value]
    if isinstance(node, (ast.List, ast.Tuple)):
        values: list[str] = []
        for item in node.elts:
            values.extend(literal_strings(item))
        return values
    return []


def calls_optimizer_script(node: ast.Call) -> bool:
    if not isinstance(node.func, ast.Attribute):
        return False
    if node.func.attr not in SUBPROCESS_CALLS:
        return False
    if not isinstance(node.func.value, ast.Name) or node.func.value.id != "subprocess":
        return False
    if not node.args:
        return False
    command_parts = literal_strings(node.args[0])
    return any("optimization/" in part or part == "optimization" for part in command_parts)


def forbidden_optimization_dependencies(paths: list[Path]) -> list[str]:
    violations: list[str] = []
    for path in paths:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            violations.append(f"{relative_path(path)}:{exc.lineno or 1}: syntax error: {exc.msg}")
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if module_root(alias.name) in FORBIDDEN_IMPORT_ROOTS:
                        violations.append(
                            f"{relative_path(path)}:{node.lineno}: imports forbidden module {alias.name!r}"
                        )
            elif isinstance(node, ast.ImportFrom):
                if node.level == 0 and module_root(node.module) in FORBIDDEN_IMPORT_ROOTS:
                    violations.append(
                        f"{relative_path(path)}:{node.lineno}: imports forbidden module {node.module!r}"
                    )
            elif isinstance(node, ast.Call) and calls_optimizer_script(node):
                violations.append(
                    f"{relative_path(path)}:{node.lineno}: calls an optimization script from evaluation code"
                )
    return violations


def validate_evaluation_boundary() -> None:
    violations = forbidden_optimization_dependencies(evaluation_python_paths())
    if violations:
        fail(
            "evaluation/ must not import optimization/ or invoke optimization scripts:\n  "
            + "\n  ".join(violations)
        )


def capture_covers_pointer(captures: set[str], pointer: str) -> bool:
    if pointer == "":
        return True
    if not pointer.startswith("/"):
        return False

    parts = [part.replace("~1", "/").replace("~0", "~") for part in pointer.split("/")[1:]]
    if not parts:
        return True

    if parts[0] in {"generated_code", "errors", "screenshots"}:
        return parts[0] in captures
    if parts[:2] == ["execution", "success"]:
        return "execution.success" in captures
    if parts[0] in {"before", "after"}:
        snapshot = parts[0]
        rest = parts[1:]
        if not rest:
            return True
        if rest[0] == "values" and len(rest) >= 2:
            return f"{snapshot}.values.{rest[1]}" in captures
        if rest[0] == "camera" and len(rest) >= 2:
            return f"camera.{rest[1]}" in captures
        if rest[0] == "entities" and len(rest) >= 3:
            return f"entities[{rest[1]}].{rest[2]}" in captures
        collection_map = {
            "imagery_layers": "imagery_layers",
            "primitives": "primitives",
            "tilesets": "tilesets",
            "data_sources": "data_sources",
        }
        if rest[0] in collection_map:
            collection = collection_map[rest[0]]
            if len(rest) == 1:
                return any(capture.startswith(f"{collection}[*].") for capture in captures)
            if len(rest) >= 3 and rest[1].isdigit():
                return f"{collection}[*].{rest[2]}" in captures
        if rest[0] in {"clock", "globe", "scene", "terrain", "events"} and len(rest) >= 2:
            return f"{rest[0]}.{rest[1]}" in captures

    return False


def validate_probe_contract(path: Path, data: dict[str, Any]) -> None:
    captures = set((data.get("probe") or {}).get("capture") or [])
    generic_path_checks = {"json_value_equals", "json_value_compare", "collection_count"}
    missing: list[str] = []
    for check in data.get("checks", []):
        check_type = check.get("type")
        if check_type not in generic_path_checks:
            continue
        pointer = check.get("path")
        if not isinstance(pointer, str) or capture_covers_pointer(captures, pointer):
            continue
        missing.append(f"{check.get('id', '<unknown>')} path {pointer!r}")
    if missing:
        fail(
            f"{path}: generic checks read evidence paths not declared in probe.capture:\n  "
            + "\n  ".join(missing)
        )


def validate_case(
    path: Path,
    case_validator: Draft7Validator,
    check_validator: Draft7Validator,
) -> tuple[str, str]:
    data = load_json(path)
    errors = sorted(case_validator.iter_errors(data), key=lambda error: list(error.path))
    if errors:
        formatted = []
        for error in errors:
            location = ".".join(str(part) for part in error.path) or "<root>"
            formatted.append(f"{location}: {error.message}")
        fail(f"{path}: schema validation failed:\n  " + "\n  ".join(formatted))

    for index, check in enumerate(data["checks"]):
        check_errors = sorted(check_validator.iter_errors(check), key=lambda error: list(error.path))
        if check_errors:
            formatted = []
            for error in check_errors:
                location = ".".join(str(part) for part in error.path) or "<root>"
                formatted.append(f"checks[{index}].{location}: {error.message}")
            fail(f"{path}: check schema validation failed:\n  " + "\n  ".join(formatted))

    skill = data["skill"]
    if path.parent.name != skill:
        fail(f"{path}: parent directory must match skill {skill!r}")
    if not path.name.startswith(data["id"] + "-"):
        fail(f"{path}: filename must start with case id {data['id']}-")

    check_ids = [check["id"] for check in data["checks"]]
    duplicates = sorted({check_id for check_id in check_ids if check_ids.count(check_id) > 1})
    if duplicates:
        fail(f"{path}: duplicate check id(s): {', '.join(duplicates)}")

    validate_probe_contract(path, data)

    return skill, data["id"]


def validate_fixture(
    path: Path,
    evidence_validator: Draft7Validator,
    known_cases: set[tuple[str, str]],
) -> tuple[str, str]:
    data = load_json(path)
    errors = sorted(evidence_validator.iter_errors(data), key=lambda error: list(error.path))
    if errors:
        formatted = []
        for error in errors:
            location = ".".join(str(part) for part in error.path) or "<root>"
            formatted.append(f"{location}: {error.message}")
        fail(f"{path}: evidence schema validation failed:\n  " + "\n  ".join(formatted))

    skill = data.get("skill")
    case_id = data.get("case_id")
    if path.parent.name != skill:
        fail(f"{path}: parent directory must match skill {skill!r}")
    if (skill, case_id) not in known_cases:
        fail(f"{path}: fixture references unknown case {skill}/{case_id}")
    if not path.name.startswith(case_id + "-") or not path.name.endswith(".evidence.json"):
        fail(f"{path}: fixture filename must be <eval-id>-<slug>.evidence.json")
    return str(skill), str(case_id)


def main() -> None:
    if not CASES_ROOT.is_dir():
        fail(f"{CASES_ROOT} does not exist")

    validate_evaluation_boundary()

    case_paths = sorted(CASES_ROOT.glob("*/eval-*.json"))
    if not case_paths:
        fail("no evaluation case manifests found")

    case_schema = load_case_schema()
    check_schema = load_json(SCHEMA_ROOT / "check.schema.json")
    evidence_schema = load_json(SCHEMA_ROOT / "evidence.schema.json")
    result_schema = load_json(SCHEMA_ROOT / "result.schema.json")
    scorecard_schema = load_json(SCHEMA_ROOT / "scorecard.schema.json")
    visual_review_schema = load_json(SCHEMA_ROOT / "visual-review.schema.json")
    for name, schema in {
        "case.schema.json": case_schema,
        "check.schema.json": check_schema,
        "evidence.schema.json": evidence_schema,
        "result.schema.json": result_schema,
        "scorecard.schema.json": scorecard_schema,
        "visual-review.schema.json": visual_review_schema,
    }.items():
        validate_json_schema(name, schema)

    case_validator = Draft7Validator(case_schema)
    check_validator = Draft7Validator(check_schema)
    evidence_validator = Draft7Validator(evidence_schema)

    seen: set[tuple[str, str]] = set()
    for path in case_paths:
        key = validate_case(path, case_validator, check_validator)
        if key in seen:
            fail(f"{path}: duplicate case id {key[1]} for skill {key[0]}")
        seen.add(key)

    fixture_paths = sorted(FIXTURES_ROOT.glob("*/*.evidence.json"))
    fixture_seen: set[tuple[str, str, str]] = set()
    for path in fixture_paths:
        skill, case_id = validate_fixture(path, evidence_validator, seen)
        key = (skill, case_id, path.name)
        if key in fixture_seen:
            fail(f"{path}: duplicate fixture filename")
        fixture_seen.add(key)

    print(
        f"[validate-evaluation] OK: {len(case_paths)} cases, "
        f"{len(fixture_paths)} fixtures across {len({skill for skill, _ in seen})} skills"
    )


if __name__ == "__main__":
    main()
