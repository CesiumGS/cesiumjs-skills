"""Result and error types shared across the evaluation framework.

Pure dataclasses - no I/O, no logging, no global state.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CheckResult:
    """Outcome of a single deterministic check."""
    check_id: str
    type: str
    result: str  # "pass" or "fail"
    category: str = "uncategorized"
    critical: bool = False
    weight: float = 1.0
    tolerance: Any = None
    actual: Any = None
    expected: Any = None
    detail: str = ""
    metadata: dict = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.result == "pass"

    def to_dict(self) -> dict:
        return {
            "check_id": self.check_id,
            "type": self.type,
            "result": self.result,
            "category": self.category,
            "critical": self.critical,
            "weight": self.weight,
            "tolerance": self.tolerance,
            "actual": self.actual,
            "expected": self.expected,
            "detail": self.detail,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class CaseResult:
    """Outcome of a full evaluation case (one case = many checks)."""
    case_id: str
    case_name: str
    skill: str
    result: str  # "pass" or "fail"
    checks: tuple[CheckResult, ...]
    duration_ms: int = 0
    error: str | None = None

    @property
    def passed(self) -> bool:
        return self.result == "pass"

    def to_dict(self) -> dict:
        return {
            "case_id": self.case_id,
            "case_name": self.case_name,
            "skill": self.skill,
            "result": self.result,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "checks": [c.to_dict() for c in self.checks],
        }


class CheckTypeError(ValueError):
    """Raised when a check JSON is malformed for its declared type."""
