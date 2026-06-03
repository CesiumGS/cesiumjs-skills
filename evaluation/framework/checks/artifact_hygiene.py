"""Deterministic checks for public artifact and generated-code hygiene."""

from __future__ import annotations

import re
from typing import Any

from ..registry import register
from ..types import CheckResult, CheckTypeError


DEFAULT_PUBLIC_SAFETY_PATTERNS = [
    r"/Users/[^\\s'\"<>]+",
    r"file://",
    r"https?://(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])",
    r"CESIUM_ION_TOKEN\\s*=",
    r"eyJ[A-Za-z0-9_-]{20,}",
    r"sk-[A-Za-z0-9_-]{20,}",
]


def _walk_strings(value: Any, prefix: str = "") -> list[tuple[str, str]]:
    if isinstance(value, str):
        return [(prefix or "<root>", value)]
    if isinstance(value, dict):
        out: list[tuple[str, str]] = []
        for key, item in value.items():
            child_prefix = f"{prefix}/{key}" if prefix else f"/{key}"
            out.extend(_walk_strings(item, child_prefix))
        return out
    if isinstance(value, (list, tuple)):
        out = []
        for index, item in enumerate(value):
            child_prefix = f"{prefix}/{index}" if prefix else f"/{index}"
            out.extend(_walk_strings(item, child_prefix))
        return out
    return []


@register("artifact_text_absent")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "artifact_text_absent")
    patterns = spec.get("patterns", DEFAULT_PUBLIC_SAFETY_PATTERNS)
    if not isinstance(patterns, list) or not all(isinstance(pattern, str) for pattern in patterns):
        raise CheckTypeError("artifact_text_absent: 'patterns' must be a list of regex strings")
    extra_patterns = spec.get("extra_patterns", [])
    if not isinstance(extra_patterns, list) or not all(isinstance(pattern, str) for pattern in extra_patterns):
        raise CheckTypeError("artifact_text_absent: 'extra_patterns' must be a list of regex strings")
    patterns = [*patterns, *extra_patterns]

    fields = spec.get("fields")
    if fields is not None and (not isinstance(fields, list) or not all(isinstance(field, str) for field in fields)):
        raise CheckTypeError("artifact_text_absent: 'fields' must be a list of top-level field names")

    haystacks: list[tuple[str, str]] = []
    if fields:
        for field in fields:
            haystacks.extend(_walk_strings((evidence or {}).get(field), f"/{field}"))
    else:
        haystacks = _walk_strings(evidence)

    for pattern in patterns:
        compiled = re.compile(pattern)
        for path, text in haystacks:
            match = compiled.search(text)
            if match:
                return CheckResult(
                    check_id=cid,
                    type="artifact_text_absent",
                    result="fail",
                    actual={"path": path, "pattern": pattern, "match": match.group(0)},
                    expected={"patterns_absent": patterns},
                    detail=f"disallowed text matched pattern {pattern!r} at {path}",
                )

    return CheckResult(
        check_id=cid,
        type="artifact_text_absent",
        result="pass",
        actual={"scanned_strings": len(haystacks)},
        expected={"patterns_absent": patterns},
        detail=f"no disallowed text found in {len(haystacks)} string fields",
    )
