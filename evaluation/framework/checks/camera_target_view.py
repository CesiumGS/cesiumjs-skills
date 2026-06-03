"""Deterministic camera target-view matcher."""

from __future__ import annotations

from ..evidence import entity_for_snapshot
from ..geometry import (
    angle_degrees,
    cartographic_lon_lat,
    dot,
    enu_basis,
    norm,
    normalize,
    vector3,
)
from ..registry import register
from ..types import CheckResult, CheckTypeError


@register("camera_target_view")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "camera_target_view")
    target_entity_id = spec.get("target_entity_id")
    if not isinstance(target_entity_id, str) or not target_entity_id:
        raise CheckTypeError("camera_target_view: missing 'target_entity_id'")

    snapshot = spec.get("snapshot", "after")
    max_view_angle = float(spec.get("max_view_angle_degrees", 10.0))
    min_distance = float(spec.get("min_distance_meters", 0.0))
    max_distance = float(spec.get("max_distance_meters", 1.0e15))
    max_up_alignment = float(spec.get("max_up_alignment", 0.85))

    section = (evidence or {}).get(snapshot) or {}
    camera = section.get("camera")
    target = entity_for_snapshot(evidence, snapshot, target_entity_id)
    if not isinstance(camera, dict):
        return CheckResult(
            check_id=cid,
            type="camera_target_view",
            result="fail",
            detail=f"missing {snapshot}.camera evidence",
        )
    if target is None:
        return CheckResult(
            check_id=cid,
            type="camera_target_view",
            result="fail",
            detail=f"target entity '{target_entity_id}' missing from {snapshot} evidence",
        )

    try:
        camera_position = vector3(camera.get("position_ecef"), "camera.position_ecef")
        camera_direction = normalize(vector3(camera.get("direction_ecef"), "camera.direction_ecef"), "camera.direction_ecef")
        target_position = vector3(target.get("position_ecef"), "target.position_ecef")
        lon, lat = cartographic_lon_lat(target)
    except (TypeError, ValueError) as exc:
        return CheckResult(
            check_id=cid,
            type="camera_target_view",
            result="fail",
            detail=f"malformed camera target evidence: {exc}",
        )

    to_target = (
        target_position[0] - camera_position[0],
        target_position[1] - camera_position[1],
        target_position[2] - camera_position[2],
    )
    distance = norm(to_target)
    view_angle = angle_degrees(camera_direction, to_target)
    up = enu_basis(lon, lat)["up"]
    target_to_camera = (
        camera_position[0] - target_position[0],
        camera_position[1] - target_position[1],
        camera_position[2] - target_position[2],
    )
    up_alignment = dot(normalize(target_to_camera, "target_to_camera"), up)

    passed = (
        min_distance <= distance <= max_distance
        and view_angle <= max_view_angle
        and up_alignment <= max_up_alignment
    )
    actual = {
        "distance_meters": distance,
        "view_angle_degrees": view_angle,
        "up_alignment": up_alignment,
    }
    expected = {
        "min_distance_meters": min_distance,
        "max_distance_meters": max_distance,
        "max_view_angle_degrees": max_view_angle,
        "max_up_alignment": max_up_alignment,
    }
    return CheckResult(
        check_id=cid,
        type="camera_target_view",
        result="pass" if passed else "fail",
        actual=actual,
        expected=expected,
        detail=(
            f"distance={distance:g}m view_angle={view_angle:g}deg "
            f"up_alignment={up_alignment:g}"
        ),
        metadata={"target_entity_id": target_entity_id, "snapshot": snapshot},
    )
