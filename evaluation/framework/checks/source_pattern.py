"""Matchers for deterministic source-pattern checks over generated code."""

from __future__ import annotations

import re

from ..registry import register
from ..types import CheckResult, CheckTypeError


def _source_text(evidence: dict) -> str:
    source = evidence.get("generated_code", "")
    if not isinstance(source, str):
        raise CheckTypeError("pattern check: evidence.generated_code must be a string")
    return source


def _pattern(spec: dict) -> str:
    pattern = spec.get("pattern")
    if not isinstance(pattern, str) or not pattern:
        raise CheckTypeError("pattern check: missing non-empty 'pattern'")
    return pattern


def _check_pattern(spec: dict, evidence: dict, *, should_match: bool, type_name: str) -> CheckResult:
    cid = spec.get("id", type_name)
    pattern = _pattern(spec)
    source = _source_text(evidence)
    try:
        match = re.search(pattern, source, flags=re.MULTILINE)
    except re.error as exc:
        return CheckResult(
            check_id=cid,
            type=type_name,
            result="fail",
            actual={"regex_valid": False, "matched": False},
            expected={"regex_valid": True, "matched": should_match, "pattern": pattern},
            detail=f"invalid regex pattern: {exc}",
        )

    matched = match is not None
    passed = matched is should_match
    return CheckResult(
        check_id=cid,
        type=type_name,
        result="pass" if passed else "fail",
        actual={
            "matched": matched,
            "match": match.group(0) if match else None,
        },
        expected={
            "matched": should_match,
            "pattern": pattern,
        },
        detail=(
            f"pattern {'matched' if matched else 'not found'}: {pattern!r}"
            if passed
            else f"expected pattern {'presence' if should_match else 'absence'} but got {'match' if matched else 'no match'}: {pattern!r}"
        ),
        metadata={
            "source_path": evidence.get("source_path"),
        },
    )


@register("pattern_present")
def check_present(spec: dict, evidence: dict) -> CheckResult:
    return _check_pattern(spec, evidence, should_match=True, type_name="pattern_present")


@register("pattern_absent")
def check_absent(spec: dict, evidence: dict) -> CheckResult:
    return _check_pattern(spec, evidence, should_match=False, type_name="pattern_absent")
