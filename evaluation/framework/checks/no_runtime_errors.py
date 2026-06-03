"""Matcher for runtime health evidence."""

from __future__ import annotations

from ..registry import register
from ..types import CheckResult


@register("no_runtime_errors")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "no_runtime_errors")
    errors = evidence.get("errors") or []
    if not isinstance(errors, list):
        errors = [errors]
    passed = len(errors) == 0
    return CheckResult(
        check_id=cid,
        type="no_runtime_errors",
        result="pass" if passed else "fail",
        actual=errors,
        expected=[],
        detail="no runtime errors captured" if passed else f"{len(errors)} runtime error(s) captured",
    )
