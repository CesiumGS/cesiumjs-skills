import type { VisualStatus } from "../types";

/** Row-tone class for a visual dimension (P4: unknown is never a low/red score). */
export function dimToneClass(status: VisualStatus): "fail" | "unknown" | "" {
  if (status === "fail") return "fail";
  if (status === "needs_review" || status === "not_reviewed" || status === "not_applicable") return "unknown";
  return "";
}
