"""Matchers for evidence values addressed by JSON Pointer paths."""

from __future__ import annotations

from ..registry import register
from ..types import CheckResult, CheckTypeError


def _resolve_json_pointer(document: object, pointer: str) -> object:
    if pointer == "":
        return document
    if not pointer.startswith("/"):
        raise CheckTypeError("json_value_equals: 'path' must be a JSON Pointer")
    current = document
    for raw_part in pointer.split("/")[1:]:
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict):
            current = current[part]
        elif isinstance(current, list):
            current = current[int(part)]
        else:
            raise KeyError(part)
    return current


@register("json_value_equals")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "json_value_equals")
    path = spec.get("path")
    if not isinstance(path, str):
        raise CheckTypeError("json_value_equals: missing 'path'")
    if "expected" not in spec:
        raise CheckTypeError("json_value_equals: missing 'expected'")

    expected = spec["expected"]
    try:
        actual = _resolve_json_pointer(evidence, path)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        return CheckResult(
            check_id=cid,
            type="json_value_equals",
            result="fail",
            actual=None,
            expected=expected,
            detail=f"path {path!r} not found: {exc}",
        )

    passed = actual == expected
    return CheckResult(
        check_id=cid,
        type="json_value_equals",
        result="pass" if passed else "fail",
        actual=actual,
        expected=expected,
        detail=f"value at {path} equals expected" if passed else f"value at {path} differs",
    )


def _compare_values(actual: object, operator: str, expected: object, tolerance: float | None = None) -> bool:
    if operator == "==":
        if tolerance is not None and isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
            return abs(float(actual) - float(expected)) <= tolerance
        return actual == expected
    if operator == "!=":
        if tolerance is not None and isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
            return abs(float(actual) - float(expected)) > tolerance
        return actual != expected
    if not isinstance(actual, (int, float)) or not isinstance(expected, (int, float)):
        raise CheckTypeError(f"json_value_compare: operator {operator!r} requires numeric values")
    if operator == "<":
        return float(actual) < float(expected)
    if operator == "<=":
        return float(actual) <= float(expected)
    if operator == ">":
        return float(actual) > float(expected)
    if operator == ">=":
        return float(actual) >= float(expected)
    raise CheckTypeError(f"json_value_compare: unsupported operator {operator!r}")


@register("json_value_compare")
def check_compare(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "json_value_compare")
    path = spec.get("path")
    if not isinstance(path, str):
        raise CheckTypeError("json_value_compare: missing 'path'")
    operator = spec.get("operator", "==")
    if operator not in {"==", "!=", "<", "<=", ">", ">="}:
        raise CheckTypeError("json_value_compare: invalid 'operator'")
    if "expected" not in spec:
        raise CheckTypeError("json_value_compare: missing 'expected'")

    expected = spec["expected"]
    tolerance = spec.get("tolerance")
    tolerance_value = float(tolerance) if tolerance is not None else None
    try:
        actual = _resolve_json_pointer(evidence, path)
        passed = _compare_values(actual, operator, expected, tolerance_value)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        return CheckResult(
            check_id=cid,
            type="json_value_compare",
            result="fail",
            actual=None,
            expected={"operator": operator, "value": expected},
            tolerance=tolerance_value,
            detail=f"path {path!r} not found or not comparable: {exc}",
        )

    return CheckResult(
        check_id=cid,
        type="json_value_compare",
        result="pass" if passed else "fail",
        actual=actual,
        expected={"operator": operator, "value": expected},
        tolerance=tolerance_value,
        detail=f"value at {path} satisfies {operator} {expected!r}" if passed else f"value at {path} does not satisfy {operator} {expected!r}",
    )


@register("collection_count")
def check_collection_count(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "collection_count")
    path = spec.get("path")
    if not isinstance(path, str):
        raise CheckTypeError("collection_count: missing 'path'")
    operator = spec.get("operator", "==")
    if operator not in {"==", "!=", "<", "<=", ">", ">="}:
        raise CheckTypeError("collection_count: invalid 'operator'")
    if "count" not in spec:
        raise CheckTypeError("collection_count: missing 'count'")

    expected = int(spec["count"])
    try:
        value = _resolve_json_pointer(evidence, path)
        if not isinstance(value, (dict, list, tuple, str)):
            raise TypeError(f"value at {path!r} has no count")
        actual = len(value)
        passed = _compare_values(actual, operator, expected)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        return CheckResult(
            check_id=cid,
            type="collection_count",
            result="fail",
            actual=None,
            expected={"operator": operator, "count": expected},
            detail=f"path {path!r} not found or not countable: {exc}",
        )

    return CheckResult(
        check_id=cid,
        type="collection_count",
        result="pass" if passed else "fail",
        actual=actual,
        expected={"operator": operator, "count": expected},
        detail=f"count at {path} satisfies {operator} {expected}" if passed else f"count at {path} does not satisfy {operator} {expected}",
    )
