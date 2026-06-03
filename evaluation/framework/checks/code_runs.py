"""Matcher for observed generated-code execution success."""

from __future__ import annotations

from ..registry import register
from ..types import CheckResult


@register("code_runs")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "code_runs")
    execution = evidence.get("execution") or {}
    actual = bool(execution.get("success", False))
    expected = True
    return CheckResult(
        check_id=cid,
        type="code_runs",
        result="pass" if actual == expected else "fail",
        actual=actual,
        expected=expected,
        detail=(
            "generated code completed successfully in the observed browser run"
            if actual == expected
            else "generated code did not complete successfully in the observed browser run"
        ),
        metadata={
            "observed_from": execution.get("observed_from"),
        },
    )
