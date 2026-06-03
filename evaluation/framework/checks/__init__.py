"""Importing this package registers all built-in matchers and exposes the
public entry point `run_deterministic_checks`.

Usage::

    from evaluation.framework.checks import run_deterministic_checks
    results = run_deterministic_checks(case, evidence)
    # results: list[CheckResult] in the same order as case['checks']
"""
from __future__ import annotations

from . import (  # noqa: F401 - side-effect: registers matcher
    artifact_hygiene,
    camera_target_view,
    code_runs,
    entity_exists,
    entity_translation_delta,
    json_value_equals,
    no_runtime_errors,
    source_pattern,
)
from ..registry import dispatch
from ..types import CheckResult


def run_deterministic_checks(case: dict, evidence: dict) -> list[CheckResult]:
    """Run every check declared by `case` against `evidence`.

    Returns a list of `CheckResult` in the same order as the checks. Each
    check is dispatched to its registered matcher; an unknown type yields
    a failing result whose detail explains the missing registration.
    """
    out: list[CheckResult] = []
    for spec in case.get("checks", []):
        out.append(dispatch(spec, evidence))
    return out


__all__ = ["run_deterministic_checks"]
