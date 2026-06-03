"""First-contract matcher: `entity_translation_delta`.

Asserts that a named entity moved by an expected local east/north/up delta
between the `before` and `after` evidence snapshots.

The evidence is intentionally scene-state oriented, not source-code oriented:

    evidence = {
        "before": {
            "entities": {
                "marker": {
                    "position_ecef": [x, y, z],
                    "position_cartographic": {
                        "longitude_deg": -73.985,
                        "latitude_deg": 40.758,
                        "altitude_m": 0
                    }
                }
            }
        },
        "after": {
            "entities": {
                "marker": {"position_ecef": [x, y, z]}
            }
        }
    }

The before cartographic position defines the local ENU frame. That lets a
prompt like "move the marker 6 meters east" be checked deterministically
without caring which Cesium API the candidate used.
"""
from __future__ import annotations

from ..geometry import cartographic_lon_lat, dot, enu_basis, vector3
from ..registry import register
from ..types import CheckResult, CheckTypeError


_VALID_ENU_AXES = {"east", "north", "up"}
_VALID_ECEF_AXES = {"x": 0, "y": 1, "z": 2}
_VALID_FRAMES = {"enu", "ecef"}
_VALID_OPS = ("==", "!=", "<", "<=", ">", ">=")
_DEFAULT_TOLERANCE_METERS = 0.01


def _apply_op(actual: float, op: str, expected: float, tol: float) -> bool:
    if op == "==":
        return abs(actual - expected) <= tol
    if op == "!=":
        return abs(actual - expected) > tol
    if op == "<":
        return actual < expected - tol
    if op == "<=":
        return actual <= expected + tol
    if op == ">":
        return actual > expected + tol
    if op == ">=":
        return actual >= expected - tol
    raise CheckTypeError(f"unsupported operator: {op}")


@register("entity_translation_delta")
def check(spec: dict, evidence: dict) -> CheckResult:
    cid = spec.get("id", "?")
    entity_id = spec.get("entity_id")
    axis = spec.get("axis")
    frame = spec.get("frame", "enu")
    op = spec.get("operator")
    expected = spec.get("value_meters")
    tol = float(spec.get("tolerance_meters", _DEFAULT_TOLERANCE_METERS))

    if entity_id is None:
        raise CheckTypeError("entity_translation_delta: missing 'entity_id'")
    if frame not in _VALID_FRAMES:
        raise CheckTypeError(
            f"entity_translation_delta: 'frame' must be one of {sorted(_VALID_FRAMES)}; got {frame!r}"
        )
    if frame == "enu" and axis not in _VALID_ENU_AXES:
        raise CheckTypeError(
            f"entity_translation_delta: 'axis' must be one of {sorted(_VALID_ENU_AXES)}; got {axis!r}"
        )
    if frame == "ecef" and axis not in _VALID_ECEF_AXES:
        raise CheckTypeError(
            f"entity_translation_delta: 'axis' must be one of {sorted(_VALID_ECEF_AXES)}; got {axis!r}"
        )
    if op not in _VALID_OPS:
        raise CheckTypeError(
            f"entity_translation_delta: 'operator' must be one of {_VALID_OPS}; got {op!r}"
        )
    if expected is None:
        raise CheckTypeError("entity_translation_delta: missing 'value_meters'")
    expected = float(expected)

    before_entities = ((evidence or {}).get("before") or {}).get("entities") or {}
    after_entities = ((evidence or {}).get("after") or {}).get("entities") or {}
    before_record = before_entities.get(entity_id)
    after_record = after_entities.get(entity_id)
    if before_record is None or after_record is None:
        missing = "before" if before_record is None else "after"
        return CheckResult(
            check_id=cid,
            type="entity_translation_delta",
            result="fail",
            actual=None,
            expected=expected,
            detail=f"entity '{entity_id}' not found in {missing} evidence",
        )

    try:
        before = vector3(before_record.get("position_ecef"), "before.position_ecef")
        after = vector3(after_record.get("position_ecef"), "after.position_ecef")
        lon_lat = cartographic_lon_lat(before_record) if frame == "enu" else None
    except (TypeError, ValueError) as e:
        return CheckResult(
            check_id=cid,
            type="entity_translation_delta",
            result="fail",
            detail=f"malformed evidence for entity '{entity_id}': {e}",
        )

    delta = (after[0] - before[0], after[1] - before[1], after[2] - before[2])
    if frame == "enu":
        assert lon_lat is not None
        lon, lat = lon_lat
        actual = dot(delta, enu_basis(lon, lat)[axis])
    else:
        actual = delta[_VALID_ECEF_AXES[axis]]
    ok = _apply_op(actual, op, expected, tol)
    detail = (
        f"entity '{entity_id}' frame={frame} axis={axis} delta={actual:g} m "
        f"{op} expected {expected:g}"
    )
    if tol:
        detail += f" (tolerance +/-{tol:g} m)"
    return CheckResult(
        check_id=cid,
        type="entity_translation_delta",
        result="pass" if ok else "fail",
        actual=actual,
        expected=expected,
        detail=detail,
        metadata={"axis": axis, "frame": frame, "tolerance_meters": tol},
    )
