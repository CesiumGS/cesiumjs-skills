"""Small helpers for reading evaluation evidence bundles."""

from __future__ import annotations

from collections.abc import Iterable


def snapshot_names(spec: dict) -> tuple[str, ...]:
    snapshot = spec.get("snapshot", "after")
    if snapshot == "both":
        return ("before", "after")
    if snapshot in {"before", "after"}:
        return (snapshot,)
    raise ValueError("snapshot must be one of: before, after, both")


def entities_for_snapshot(evidence: dict, snapshot: str) -> dict:
    section = (evidence or {}).get(snapshot)
    if not isinstance(section, dict):
        return {}
    entities = section.get("entities")
    if not isinstance(entities, dict):
        return {}
    return entities


def entity_for_snapshot(evidence: dict, snapshot: str, entity_id: str) -> dict | None:
    entity = entities_for_snapshot(evidence, snapshot).get(entity_id)
    return entity if isinstance(entity, dict) else None


def missing_snapshots(evidence: dict, entity_id: str, snapshots: Iterable[str]) -> list[str]:
    missing: list[str] = []
    for snapshot in snapshots:
        if entity_for_snapshot(evidence, snapshot, entity_id) is None:
            missing.append(snapshot)
    return missing
