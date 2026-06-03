"""Small geometry helpers shared by deterministic matchers."""

from __future__ import annotations

import math
from collections.abc import Sequence


def vector3(value: object, label: str) -> tuple[float, float, float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) != 3:
        raise ValueError(f"{label} must be a 3-element numeric vector")
    return (float(value[0]), float(value[1]), float(value[2]))


def cartographic_lon_lat(entity: dict) -> tuple[float, float]:
    cartographic = entity.get("position_cartographic")
    if not isinstance(cartographic, dict):
        raise ValueError("entity is missing position_cartographic")

    if "longitude_deg" in cartographic and "latitude_deg" in cartographic:
        lon = math.radians(float(cartographic["longitude_deg"]))
        lat = math.radians(float(cartographic["latitude_deg"]))
        return lon, lat

    if "longitude_rad" in cartographic and "latitude_rad" in cartographic:
        return float(cartographic["longitude_rad"]), float(cartographic["latitude_rad"])

    raise ValueError(
        "position_cartographic must include longitude_deg/latitude_deg "
        "or longitude_rad/latitude_rad"
    )


def enu_basis(lon: float, lat: float) -> dict[str, tuple[float, float, float]]:
    sin_lon = math.sin(lon)
    cos_lon = math.cos(lon)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    return {
        "east": (-sin_lon, cos_lon, 0.0),
        "north": (-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat),
        "up": (cos_lat * cos_lon, cos_lat * sin_lon, sin_lat),
    }


def dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(value: tuple[float, float, float]) -> float:
    return math.sqrt(dot(value, value))


def normalize(value: tuple[float, float, float], label: str) -> tuple[float, float, float]:
    length = norm(value)
    if length == 0:
        raise ValueError(f"{label} must not be a zero vector")
    return (value[0] / length, value[1] / length, value[2] / length)


def angle_degrees(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    clamped_dot = max(-1.0, min(1.0, dot(normalize(a, "a"), normalize(b, "b"))))
    return math.degrees(math.acos(clamped_dot))
