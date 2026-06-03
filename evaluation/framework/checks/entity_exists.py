"""Matcher for asserting entity presence in captured scene-state evidence."""

from __future__ import annotations

from ..evidence import missing_snapshots, snapshot_names
from ..registry import register
from ..types import CheckResult, CheckTypeError


@register("entity_exists")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "?")
    entity_id = spec.get("entity_id")
    if not isinstance(entity_id, str) or not entity_id:
        raise CheckTypeError("entity_exists: missing 'entity_id'")

    try:
        snapshots = snapshot_names(spec)
    except ValueError as exc:
        raise CheckTypeError(f"entity_exists: {exc}") from exc

    missing = missing_snapshots(evidence, entity_id, snapshots)
    passed = not missing
    expected = {"entity_id": entity_id, "snapshots": list(snapshots)}
    actual = {
        "entity_id": entity_id,
        "present_snapshots": [snapshot for snapshot in snapshots if snapshot not in missing],
        "missing_snapshots": missing,
    }
    detail = (
        f"entity '{entity_id}' exists in {', '.join(snapshots)}"
        if passed
        else f"entity '{entity_id}' missing from {', '.join(missing)}"
    )
    return CheckResult(
        check_id=cid,
        type="entity_exists",
        result="pass" if passed else "fail",
        actual=actual,
        expected=expected,
        detail=detail,
    )
