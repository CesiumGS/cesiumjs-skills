"""Matcher registry. Keep this module minimal and side-effect free.

A matcher is a pure function:

    def check(spec: dict, probe: dict) -> CheckResult

It receives the check JSON (already schema-validated) and a probe dict
that the runner captured from the browser. It returns a CheckResult.

Adding a new matcher type:

    from .registry import register

    @register("scene_state.entity_count.equals")
    def _entity_count_equals(spec, probe): ...
"""
from __future__ import annotations

from typing import Callable

from .types import CheckResult, CheckTypeError

_REGISTRY: dict[str, Callable[[dict, dict], CheckResult]] = {}


def register(type_name: str):
    def deco(fn):
        if type_name in _REGISTRY:
            raise RuntimeError(f"duplicate matcher registration: {type_name}")
        _REGISTRY[type_name] = fn
        return fn
    return deco


def dispatch(spec: dict, evidence: dict) -> CheckResult:
    t = spec.get("type")
    if not t:
        raise CheckTypeError("check is missing 'type'")
    fn = _REGISTRY.get(t)
    if fn is None:
        return CheckResult(
            check_id=spec.get("id", "?"),
            type=t,
            result="fail",
            detail=f"no matcher registered for type '{t}'",
        )
    return fn(spec, evidence)


def registered_types() -> list[str]:
    return sorted(_REGISTRY)
