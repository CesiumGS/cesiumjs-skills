/** Small geometry helpers shared by deterministic matchers. */

export type Vec3 = [number, number, number];

export function vector3(value: unknown, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must be a 3-element numeric vector`);
  }
  const nums = value.map((item) => Number(item));
  if (nums.some((num) => Number.isNaN(num))) {
    throw new Error(`${label} must be a 3-element numeric vector`);
  }
  return [nums[0], nums[1], nums[2]];
}

export function cartographicLonLat(entity: Record<string, any>): [number, number] {
  const cartographic = entity.position_cartographic;
  if (cartographic === null || typeof cartographic !== "object" || Array.isArray(cartographic)) {
    throw new Error("entity is missing position_cartographic");
  }
  if ("longitude_deg" in cartographic && "latitude_deg" in cartographic) {
    const lon = (Number(cartographic.longitude_deg) * Math.PI) / 180;
    const lat = (Number(cartographic.latitude_deg) * Math.PI) / 180;
    return [lon, lat];
  }
  if ("longitude_rad" in cartographic && "latitude_rad" in cartographic) {
    return [Number(cartographic.longitude_rad), Number(cartographic.latitude_rad)];
  }
  throw new Error(
    "position_cartographic must include longitude_deg/latitude_deg or longitude_rad/latitude_rad",
  );
}

export function enuBasis(lon: number, lat: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  return {
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm(value: Vec3): number {
  return Math.sqrt(dot(value, value));
}

export function normalize(value: Vec3, label: string): Vec3 {
  const length = norm(value);
  if (length === 0) throw new Error(`${label} must not be a zero vector`);
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function angleDegrees(a: Vec3, b: Vec3): number {
  const clamped = Math.max(-1, Math.min(1, dot(normalize(a, "a"), normalize(b, "b"))));
  return (Math.acos(clamped) * 180) / Math.PI;
}
