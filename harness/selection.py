"""Harness selection: which CLI (``opencode`` or ``codex``) a role uses.

Role -> env resolution shared by both pipelines. Each role reads, in order,
``<ROLE>_HARNESS``, ``AGENT_HARNESS``, then ``CESIUM_AGENT_HARNESS``; default
``opencode``.
"""

from __future__ import annotations

import os

VALID_HARNESSES = ("opencode", "codex")

_ROLE_PREFIXES = {
    "proposer": "PROPOSER",
    "eval": "EVAL",
    "codegen": "EVAL",
    "judge": "JUDGE",
}


class HarnessError(ValueError):
    """Raised for an unsupported harness name."""


def role_prefix(role: str) -> str:
    return _ROLE_PREFIXES.get(role.lower(), "AGENT")


def default_harness(role: str = "default") -> str:
    """Return the configured harness for a role, defaulting to ``opencode``."""

    prefix = role_prefix(role)
    for name in (f"{prefix}_HARNESS", "AGENT_HARNESS", "CESIUM_AGENT_HARNESS"):
        value = os.environ.get(name)
        if value:
            return resolve_harness(value, role)
    return "opencode"


def resolve_harness(harness: str | None, role: str = "default") -> str:
    """Normalize/validate a harness name, accepting ``auto`` as role default."""

    value = (harness or default_harness(role)).strip().lower()
    if value == "auto":
        value = default_harness(role)
    if value not in VALID_HARNESSES:
        raise HarnessError(
            f"Unsupported agent harness {value!r}; expected one of: {', '.join(VALID_HARNESSES)}"
        )
    return value
