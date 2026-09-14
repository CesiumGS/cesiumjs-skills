/** Time and number formatting helpers. */

/** UTC timestamp truncated to seconds (`2026-07-22T14:03:09Z`) — the scorecard convention. */
export function nowIsoSeconds(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Full-precision UTC timestamp for journal events. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Tolerant ISO parse accepting both `...Z` and `...+00:00`; null when invalid. */
export function parseTs(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/Z$/, "+00:00");
  const withZone = /[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}+00:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Percentage with one decimal (0.955 -> "95.5%") for human-readable reports. */
export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Round to a fixed number of decimal digits. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
