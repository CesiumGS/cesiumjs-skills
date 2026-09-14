import type {
  AdaptedCase,
  AdaptedDimension,
  AdaptedScorecard,
  RawCase,
  RawDimension,
  RawScorecard,
  VisualStatus
} from "../types";

export function caseKey(skill: string, caseId: string): string {
  return `${skill}/${caseId}`;
}

export function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\band\b/g, "&")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// Canonical dimension display slots: tolerate Mode A (long names) and Mode B (short names).
// See DESIGN-SPEC Appendix B.
const DIM_SLOTS: Array<{ slot: number; short: string; aliases: string[] }> = [
  { slot: 0, short: "Framing", aliases: ["framing_and_composition", "framing"] },
  { slot: 1, short: "Subject", aliases: ["subject_presence_and_recognizability", "target_visible"] },
  { slot: 2, short: "Prompt", aliases: ["prompt_and_behavior_fidelity", "prompt_match"] },
  { slot: 3, short: "Liveness", aliases: ["render_liveness", "nonblank_render"] },
  { slot: 4, short: "Artifacts", aliases: ["visual_correctness_and_artifacts", "occlusion", "clutter"] },
  { slot: 5, short: "Legibility", aliases: ["legibility_and_clarity"] }
];

const ALIAS_TO_SLOT = new Map<string, { slot: number; short: string }>();
for (const s of DIM_SLOTS) {
  for (const a of s.aliases) ALIAS_TO_SLOT.set(a, { slot: s.slot, short: s.short });
}

export function dimensionShortLabel(key: string): string {
  return ALIAS_TO_SLOT.get(key)?.short ?? humanize(key).split(" ")[0];
}

function normStatus(value: unknown): VisualStatus {
  const v = String(value ?? "").trim();
  if (v === "pass" || v === "fail" || v === "needs_review" || v === "not_reviewed" || v === "not_applicable") {
    return v;
  }
  return "not_reviewed";
}

export function adaptDimensions(dims: Record<string, RawDimension> | undefined): AdaptedDimension[] {
  if (!dims) return [];
  const out: AdaptedDimension[] = Object.entries(dims).map(([key, d]) => {
    const status = normStatus(d?.status);
    const raw = typeof d?.score === "number" ? d.score : null;
    // A literal 0 on an unreviewed/not-applicable dimension is "not scored", not a worst score.
    const score = raw === 0 && (status === "not_reviewed" || status === "not_applicable") ? null : raw;
    return {
      key,
      label: humanize(key),
      status,
      score,
      hasScore: score !== null,
      note: String(d?.note ?? "")
    };
  });
  // Fixed slot order, unknown keys appended after.
  out.sort((a, b) => {
    const sa = ALIAS_TO_SLOT.get(a.key)?.slot ?? 90 + a.key.charCodeAt(0);
    const sb = ALIAS_TO_SLOT.get(b.key)?.slot ?? 90 + b.key.charCodeAt(0);
    if (sa !== sb) return sa - sb;
    return a.key.localeCompare(b.key);
  });
  return out;
}

function screenshotCandidates(c: RawCase): string[] {
  const out: string[] = [];
  const push = (p?: string | null) => {
    if (p && !out.includes(p)) out.push(p);
  };
  (c.screenshots ?? []).forEach(push);
  (c.visual_review?.screenshots ?? []).forEach(push);
  const run = c.evidence_summary?.run_artifact_path;
  if (run && out.length === 0) {
    push(`${run}/screenshot.png`);
    push(`${run}/screenshot-0.png`);
    push(`${run}/screenshot-1.png`);
    push(`${run}/screenshot-2.png`);
    push(`${run}/screenshot-3.png`);
  }
  return out;
}

export function adaptCase(c: RawCase): AdaptedCase {
  const vr = c.visual_review ?? {};
  const checks = c.checks ?? [];
  const failedChecks = checks.filter((x) => x.result === "fail");
  const vstatus = normStatus(vr.status);
  const rawOverall = typeof vr.overall_score === "number"
    ? vr.overall_score
    : typeof vr.score === "number"
      ? vr.score * 10
      : null;
  // An unreviewed/not-applicable case has no real overall score; show "—", not 0.
  const overall = vstatus === "not_reviewed" || vstatus === "not_applicable" ? null : rawOverall;
  const sc = c.source_context ?? {};
  const screenshots = screenshotCandidates(c);
  const screenshotMode = sc.screenshot_mode ?? null;
  const expectedVisualShots = screenshotMode === "cardinal_panorama" ? 4 : 1;
  const observedVisualShots = new Set([
    ...(c.screenshots ?? []),
    ...(c.visual_review?.screenshots ?? [])
  ].filter(Boolean)).size || screenshots.length;
  return {
    key: caseKey(c.skill, c.case_id),
    case_id: c.case_id,
    case_name: c.case_name,
    skill: c.skill,
    task: c.task ?? "",
    category: c.category ?? "",
    difficulty: sc.difficulty ?? null,
    landmark: sc.landmark ?? null,
    perspective: sc.perspective ?? null,
    expectedBehaviors: sc.expected_behaviors ?? [],
    visualExpectations: sc.visual_expectations ?? "",
    screenshotMode,
    result: c.result,
    score: typeof c.score === "number" ? c.score : 0,
    visualStatus: vstatus,
    visualScore: overall,
    visualSummary: String(vr.summary ?? ""),
    dimensions: adaptDimensions(vr.dimensions),
    observations: vr.observations ?? [],
    risks: vr.risks ?? [],
    checks,
    failedChecks,
    criticalFailedChecks: failedChecks.filter((x) => x.critical),
    screenshots,
    expectedVisualShots,
    observedVisualShots,
    evidence: c.evidence_summary ?? {},
    evidencePath: c.evidence_path ?? ""
  };
}

function artifactString(raw: RawScorecard, key: string): string | null {
  const v = (raw.artifacts ?? {})[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function adaptScorecard(raw: RawScorecard): AdaptedScorecard {
  const categoryScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.category_scores ?? {})) {
    categoryScores[k] = typeof v?.score === "number" ? v.score : 0;
  }
  return {
    runId: raw.run_id,
    gitCommit: raw.git_commit ?? "",
    timestampUtc: raw.timestamp_utc ?? "",
    overallResult: raw.overall_result,
    deterministicResult: raw.deterministic_result,
    overallScore: typeof raw.overall_score === "number" ? raw.overall_score : 0,
    threshold: typeof raw.threshold === "number" ? raw.threshold : 0.95,
    schemaVersion: raw.schema_version ?? "",
    // Align with the server (defaults missing flag to false / Mode B).
    visualReviewSupplied: raw.visual_summary?.visual_review_supplied === true,
    // Harness comes from the in-band field only; the scorecard carries no path,
    // so legacy fieldless runs land on "unknown" here and the store backfills the
    // server-resolved value from ConfigDTO.harness. Never infer from run_id.
    harness: typeof raw.harness === "string" && raw.harness.trim() ? raw.harness.trim() : "unknown",
    // Model provenance is additive (artifacts.model / .model_variant); null =
    // the run did not record it, rendered as "unrecorded" — never guessed.
    model: artifactString(raw, "model"),
    modelVariant: artifactString(raw, "model_variant"),
    harnessJudge: artifactString(raw, "harness_judge"),
    categoryScores,
    cases: (raw.cases ?? []).map(adaptCase)
  };
}
