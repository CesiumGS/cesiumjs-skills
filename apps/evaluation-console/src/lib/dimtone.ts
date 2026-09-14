export type VisualScoreTone = "fail" | "warn" | "pass" | "unknown";

/**
 * One score-to-tone scale for every rendered Visual Test magnitude.
 *
 * These thresholds mirror the qualitative audit contract:
 *   <5 fail, 5..<7 needs review, >=7 pass.
 * Missing scores remain unknown instead of being painted as a red zero.
 */
export function visualScoreTone(score: number | null | undefined): VisualScoreTone {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unknown";
  if (score < 5) return "fail";
  if (score < 7) return "warn";
  return "pass";
}
