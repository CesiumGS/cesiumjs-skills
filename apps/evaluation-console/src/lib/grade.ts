import type { AdaptedCase, AdaptedScorecard, CaseView, Decision, FilterKind, RunSummary } from "../types";

// ---------------------------------------------------------------------------
// Run health: one aggregate score that combines the two gates the verdict is
// built from — deterministic checks AND visual review.
//
// The verdict (overall_result) fails if EITHER gate fails, but the raw
// `overall_score` reflects only the deterministic checks. That let a run read
// "FAIL · 100%" when every check passed but the visual gate failed — the
// number contradicting the verdict. `runHealth` folds both gates into a single
// number so the score always agrees with the verdict.
// ---------------------------------------------------------------------------

export interface RunHealth {
  det: number | null;       // deterministic check score, 0-1 (null when unknown)
  vis: number | null;       // visual review score, 0-1 (null when no visual verdict)
  aggregate: number | null; // combined health, 0-1 (null when det unknown)
  hasVisual: boolean;       // true when visual review contributes to the aggregate
  passCount: number;        // visual passes
  reviewedCount: number;    // cases carrying a visual verdict (pass + fail + needs_review)
}

interface HealthInput {
  det: number | null;
  visualSupplied: boolean;
  passCount: number;
  failCount: number;
  needsCount: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function computeHealth(i: HealthInput): RunHealth {
  const det = typeof i.det === "number" && Number.isFinite(i.det) ? clamp01(i.det) : null;
  const reviewedCount = i.passCount + i.failCount + i.needsCount;
  // needs_review counts against the visual score (denominator, not numerator):
  // an unresolved case is not a pass, so it must keep the aggregate below 100%.
  const vis = i.visualSupplied && reviewedCount > 0 ? i.passCount / reviewedCount : null;
  const hasVisual = vis !== null;
  // Both gates must hold for the run to pass, so they weigh equally. In Mode B
  // (no visual review) there is only one gate, so the aggregate is just it.
  const aggregate = det === null ? null : hasVisual ? (det + (vis as number)) / 2 : det;
  return { det, vis, aggregate, hasVisual, passCount: i.passCount, reviewedCount };
}

// Full scorecard: derive the visual verdict counts from the adapted cases.
export function healthFromScorecard(sc: AdaptedScorecard): RunHealth {
  let passCount = 0;
  let failCount = 0;
  let needsCount = 0;
  for (const c of sc.cases) {
    if (c.visualStatus === "pass") passCount += 1;
    else if (c.visualStatus === "fail") failCount += 1;
    else if (c.visualStatus === "needs_review") needsCount += 1;
  }
  return computeHealth({
    det: typeof sc.overallScore === "number" ? sc.overallScore : null,
    visualSupplied: sc.visualReviewSupplied,
    passCount,
    failCount,
    needsCount
  });
}

// Lightweight run row from the list endpoint: the visual counts are pre-summed.
export function healthFromSummary(r: RunSummary): RunHealth {
  return computeHealth({
    det: typeof r.overall_score === "number" ? r.overall_score : null,
    visualSupplied: r.visual_review_supplied,
    passCount: r.pass_count,
    failCount: r.fail_count,
    needsCount: r.needs_review_count
  });
}

// A health fraction (0-1) as a display percentage. A failing run must never
// read as 100% — that "FAIL · 100%" contradiction is the whole point — so a
// fail is floored and capped at 99%. A pass rounds normally.
export function healthPct(fraction: number, pass: boolean): number {
  const raw = fraction * 100;
  return pass ? Math.round(raw) : Math.min(99, Math.floor(raw));
}

export type HealthTone = "good" | "warn" | "bad" | "unknown";

// Graded severity for a health percentage, independent of the binary verdict:
// a 93% run that failed one gate is "nearly there", not the same red as a 40%
// run. The verdict chip stays the pass/fail truth; magnitudes use this scale.
export function healthTone(pct: number): Exclude<HealthTone, "unknown">;
export function healthTone(pct: number | null | undefined): HealthTone;
export function healthTone(pct: number | null | undefined): HealthTone {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "unknown";
  if (pct >= 90) return "good";
  if (pct >= 70) return "warn";
  return "bad";
}

// Pure fixtures runs exercise the evaluator itself (no AI agent involved), so
// they are not evidence about skill quality. Mixed sweeps still carry real
// agent output and stay in. Dashboard headline surfaces filter with this; the
// Run Browser and Harnesses station keep showing them, clearly labeled.
export function isSyntheticRun(r: RunSummary): boolean {
  return r.source === "fixtures";
}

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
