import type { AdaptedCase, CaseView, Decision, FilterKind } from "../types";

// Auto-grade rule (DESIGN-SPEC §0.2 / Appendix A).
export function autoGrade(c: AdaptedCase): Decision {
  const det = c.result;
  const vis = c.visualStatus;
  if (det === "fail" || vis === "fail") return "flag";
  if (vis === "needs_review") return "defer"; // genuine visual ambiguity only
  // pass / not_reviewed / not_applicable with a deterministic pass: silence = accept (P5).
  // In Mode B (all not_reviewed) this keeps a det-only run from reading as a sea of amber.
  return "accept";
}

// Worst-first ordering (DESIGN-SPEC §5.2). Lower sort value = top of queue.
function tier(v: CaseView): number {
  if (v.decision === "flag" && v.criticalFailedChecks.length > 0) return 0;
  if (v.decision === "flag") return 1;
  if (v.decision === "defer") return 2;
  return 3; // accept
}

function naturalCaseId(id: string): number {
  const m = id.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export function worstFirstSort(views: CaseView[]): CaseView[] {
  return [...views].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    const sa = a.visualScore ?? Number.POSITIVE_INFINITY;
    const sb = b.visualScore ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    if (a.skill !== b.skill) return a.skill.localeCompare(b.skill);
    return naturalCaseId(a.case_id) - naturalCaseId(b.case_id);
  });
}

export function matchesFilter(v: CaseView, filter: FilterKind): boolean {
  switch (filter) {
    case "all":
      return true;
    case "flag":
      return v.decision === "flag";
    case "defer":
      return v.decision === "defer";
    case "accept":
      return v.decision === "accept";
    case "overridden":
      return v.source === "human";
    case "not_reviewed":
      return v.visualStatus === "not_reviewed" || v.visualStatus === "not_applicable";
    default:
      return true;
  }
}
