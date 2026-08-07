/** Scorecard aggregation for deterministic and qualitative evaluation results. */
import * as fs from "node:fs";
import * as path from "node:path";
import { CaseResult } from "./types.js";
import { sortKeysDeep, stableStringify } from "../lib/json.js";
import { pct } from "../lib/format.js";

export const SCORECARD_SCHEMA_VERSION = "1.0";
export const DEFAULT_THRESHOLD = 0.95;

export const VISUAL_REVIEW_STATUSES = new Set(["pass", "fail", "needs_review", "not_reviewed", "not_applicable"]);
export const VISUAL_DIMENSION_KEYS = [
  "nonblank_render",
  "target_visible",
  "framing",
  "occlusion",
  "clutter",
  "prompt_match",
];
const VISUAL_DIMENSION_STATUSES = new Set(["pass", "fail", "needs_review", "not_applicable"]);

export interface ScorecardInput {
  caseDoc: Record<string, any>;
  result: CaseResult;
  evidencePath: string;
  screenshots?: string[];
  evidenceSummary?: Record<string, any> | null;
}

export function makeRunId(timestampUtc: string, commit: string): string {
  const compact = timestampUtc.replace(/\+00:00$/, "Z").replace(/-/g, "").replace(/:/g, "").replace(/\./g, "");
  return `scorecard-${compact}-${commit.slice(0, 12)}`;
}

function checkWeight(check: Record<string, any>): number {
  const value = Number(check.weight ?? 1.0);
  return value >= 0 ? value : 0;
}

export function scoreForChecks(checks: Array<Record<string, any>>): Record<string, number> {
  const totalWeight = checks.reduce((sum, check) => sum + checkWeight(check), 0);
  const passedWeight = checks.filter((check) => check.result === "pass").reduce((sum, check) => sum + checkWeight(check), 0);
  const totalChecks = checks.length;
  const passedChecks = checks.filter((check) => check.result === "pass").length;
  const score = totalWeight ? passedWeight / totalWeight : 0;
  return {
    score,
    passed_weight: passedWeight,
    total_weight: totalWeight,
    passed_checks: passedChecks,
    total_checks: totalChecks,
  };
}

function probeContract(caseDoc: Record<string, any>): Record<string, any> {
  const probe = caseDoc.probe ?? {};
  return {
    capture: (probe.capture ?? []).map((item: unknown) => String(item)),
    snapshot_before_and_after: Boolean(probe.snapshot_before_and_after ?? false),
    snapshot_after: Boolean(probe.snapshot_after ?? false),
    before_trigger: probe.before_trigger ?? null,
    after_trigger: probe.after_trigger ?? null,
    actual_source: probe.actual_source ?? null,
  };
}

function caseScore(input: ScorecardInput): Record<string, any> {
  const checks = input.result.checks.map((check) => ({ ...check }));
  const scoreData = scoreForChecks(checks);
  const preflight = input.caseDoc.preflight ?? {};
  return {
    case_id: input.result.case_id,
    case_name: input.result.case_name,
    skill: input.result.skill,
    task: String(input.caseDoc.prompt ?? ""),
    category: String(input.caseDoc.category ?? "uncategorized"),
    probe_contract: probeContract(input.caseDoc),
    source_context: {
      source: String(preflight.source ?? "evaluation/cases"),
      source_scenario_id: preflight.source_scenario_id ?? null,
      source_name: preflight.source_name ?? null,
      landmark: preflight.landmark ?? null,
      perspective: preflight.perspective ?? null,
      difficulty: preflight.difficulty ?? null,
      expected_behaviors: [...(preflight.expected_behaviors ?? [])],
      visual_expectations: String(preflight.visual_expectations ?? ""),
      screenshot_mode: preflight.screenshot_mode ?? null,
    },
    result: input.result.result,
    score: scoreData.score,
    duration_ms: input.result.duration_ms,
    error: input.result.error,
    evidence_path: input.evidencePath,
    evidence_summary: input.evidenceSummary ?? {},
    screenshots: [...(input.screenshots ?? [])],
    checks,
  };
}

function stringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [String(value)];
}

function coerceDimensionScore(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.max(0, Math.min(10, num));
}

function normalizeVisualDimensions(rawReview: Record<string, any>, status: string): Record<string, any> {
  let rawDimensions = rawReview.dimensions;
  if (rawDimensions === null || typeof rawDimensions !== "object" || Array.isArray(rawDimensions)) {
    rawDimensions = {};
  }
  const normalized: Record<string, any> = {};
  const defaultStatus = status === "not_applicable" ? "not_applicable" : "needs_review";
  const keys: string[] = Object.keys(rawDimensions).map(String);
  const useKeys = keys.length ? keys : [...VISUAL_DIMENSION_KEYS];
  for (const key of useKeys) {
    const rawItem = rawDimensions[key];
    if (rawItem === null || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      normalized[key] = { status: defaultStatus, note: "" };
      continue;
    }
    let dimensionStatus = String(rawItem.status ?? defaultStatus);
    if (!VISUAL_DIMENSION_STATUSES.has(dimensionStatus)) dimensionStatus = "needs_review";
    const entry: Record<string, any> = {
      status: dimensionStatus,
      note: String(rawItem.note ?? "").trim(),
    };
    const dimensionScore = coerceDimensionScore(rawItem.score);
    if (dimensionScore !== null) entry.score = dimensionScore;
    normalized[key] = entry;
  }
  return normalized;
}

function visualReviewLookup(visualReview: Record<string, any> | null): Map<string, Record<string, any>> {
  const lookup = new Map<string, Record<string, any>>();
  if (!visualReview) return lookup;
  const defaultReviewer = String(visualReview.reviewer ?? "unassigned");
  const defaultReviewedAt = visualReview.reviewed_at ?? null;
  for (const rawItem of visualReview.items ?? []) {
    if (rawItem === null || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const skill = rawItem.skill;
    const caseId = rawItem.case_id;
    if (!skill || !caseId) continue;
    const item = { ...rawItem };
    if (item.reviewer === undefined) item.reviewer = defaultReviewer;
    if (item.reviewed_at === undefined) item.reviewed_at = defaultReviewedAt;
    lookup.set(`${skill}\u0000${caseId}`, item);
  }
  return lookup;
}

function normalizeVisualReview(
  caseRow: Record<string, any>,
  rawReviewIn: Record<string, any> | undefined,
  requireVisualReview: boolean,
): Record<string, any> {
  const rawReview = rawReviewIn ?? {};
  let status = String(rawReview.status ?? "not_reviewed");
  if (!VISUAL_REVIEW_STATUSES.has(status)) status = "needs_review";

  const required = Boolean(rawReview.required ?? requireVisualReview);
  const blocking = Boolean(rawReview.blocking ?? required);

  const overallScore = coerceDimensionScore(rawReview.overall_score);

  let score: number | null = rawReview.score ?? null;
  if (score !== null && score !== undefined) {
    score = Math.max(0, Math.min(1, Number(score)));
  } else if (overallScore !== null) {
    score = Math.max(0, Math.min(1, overallScore / 10.0));
  } else {
    score = null;
  }

  const failureFlags = stringList(rawReview.failure_flags);
  const judge = rawReview.judge !== null && typeof rawReview.judge === "object" && !Array.isArray(rawReview.judge) ? rawReview.judge : null;

  let screenshots = rawReview.screenshots;
  if (screenshots === null || screenshots === undefined) {
    screenshots = caseRow.screenshots ?? [];
  }

  let summary = String(rawReview.summary ?? "").trim();
  if (!summary) {
    if (status === "not_reviewed") summary = "No qualitative visual assessment has been recorded for this case.";
    else if (status === "not_applicable") summary = "This case does not require visual assessment.";
    else summary = "Visual assessment recorded without a summary.";
  }

  const normalized: Record<string, any> = {
    status,
    required,
    blocking,
    score,
    reviewer: String(rawReview.reviewer ?? "unassigned"),
    reviewed_at: rawReview.reviewed_at ?? null,
    summary,
    dimensions: normalizeVisualDimensions(rawReview, status),
    observations: stringList(rawReview.observations),
    risks: stringList(rawReview.risks),
    screenshots: stringList(screenshots),
    artifact_path: String(rawReview.artifact_path ?? ""),
  };
  if (overallScore !== null) normalized.overall_score = overallScore;
  if (failureFlags.length) normalized.failure_flags = failureFlags;
  if (judge !== null) normalized.judge = judge;
  return normalized;
}

export function visualSummary(cases: Array<Record<string, any>>, visualReviewSupplied: boolean): Record<string, any> {
  const statusCounts: Record<string, number> = {};
  for (const status of [...VISUAL_REVIEW_STATUSES].sort()) statusCounts[status] = 0;
  const blockingFailures: Array<Record<string, any>> = [];
  let reviewedCount = 0;
  let requiredCount = 0;
  let requiredNotReviewed = 0;

  for (const caseRow of cases) {
    const review = caseRow.visual_review;
    const status = review.status;
    statusCounts[status] += 1;
    if (status !== "not_reviewed") reviewedCount += 1;
    if (review.required) requiredCount += 1;
    if (review.required && status === "not_reviewed") requiredNotReviewed += 1;
    if (review.blocking && ["fail", "needs_review", "not_reviewed"].includes(status)) {
      blockingFailures.push({
        case_id: caseRow.case_id,
        case_name: caseRow.case_name,
        skill: caseRow.skill,
        status,
        summary: review.summary,
        artifact_path: review.artifact_path,
      });
    }
  }

  let result: string;
  if (!visualReviewSupplied && requiredCount === 0) result = "not_required";
  // The judge ran but reviewed nothing: every case fell back to not_reviewed
  // because no baseline screenshot was found. That is a vacuous run, not a
  // pass — a study that looked at zero screenshots must never read as green.
  else if (visualReviewSupplied && cases.length > 0 && reviewedCount === 0) result = "not_run";
  // A confirmed blocking failure is a stronger signal than incompleteness: if a
  // judged case definitively failed, report it even when coverage is partial.
  else if (blockingFailures.length) result = "fail";
  // Partial coverage: some required cases were never judged (missing
  // screenshots) yet came through non-blocking. The reviewed cases may all pass,
  // but required cases went unseen — that is incomplete, never a green pass.
  else if (visualReviewSupplied && requiredNotReviewed > 0) result = "not_run";
  else if (statusCounts.fail || statusCounts.needs_review) result = "needs_review";
  else result = "pass";

  return {
    result,
    visual_review_supplied: visualReviewSupplied,
    required_count: requiredCount,
    required_not_reviewed_count: requiredNotReviewed,
    reviewed_count: reviewedCount,
    total_cases: cases.length,
    pass_count: statusCounts.pass,
    fail_count: statusCounts.fail,
    needs_review_count: statusCounts.needs_review,
    not_reviewed_count: statusCounts.not_reviewed,
    not_applicable_count: statusCounts.not_applicable,
    blocking_failures: blockingFailures,
  };
}

function isSyntheticEvidence(evidencePath: unknown): boolean {
  const p = String(evidencePath ?? "").replace(/\\/g, "/");
  return p.includes("evaluation/fixtures/") && !p.endsWith("-observed.evidence.json");
}

/** Classify where a scorecard's evidence came from: fixtures | agent | mixed. */
export function evidenceSource(cases: Array<Record<string, any>>): string {
  const flags = cases.map((caseRow) => isSyntheticEvidence(caseRow.evidence_path));
  if (flags.length && flags.every(Boolean)) return "fixtures";
  if (flags.some(Boolean)) return "mixed";
  return "agent";
}

function loadMetaForSource(repoRoot: string, sourcePath: unknown): Record<string, any> | null {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) return null;
  const rel = sourcePath.trim().replace(/\\/g, "/");
  const resolved = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  const ext = path.extname(resolved);
  const metaPath = ext ? resolved.slice(0, -ext.length) + ".meta.json" : resolved + ".meta.json";
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
  return data !== null && typeof data === "object" && !Array.isArray(data) ? data : null;
}

function caseSourcePath(repoRoot: string, caseRow: Record<string, any>): string | null {
  const summary = caseRow.evidence_summary;
  if (summary !== null && typeof summary === "object" && !Array.isArray(summary)) {
    const src = summary.actual_source_path;
    if (typeof src === "string" && src.trim()) return src.trim();
  }
  const evidencePath = caseRow.evidence_path;
  if (typeof evidencePath === "string" && evidencePath.trim()) {
    const candidate = path.join(repoRoot, evidencePath.trim().replace(/\\/g, "/"));
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      let evidence: any;
      try {
        evidence = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      } catch {
        return null;
      }
      if (evidence !== null && typeof evidence === "object" && !Array.isArray(evidence)) {
        const src = evidence.source_path;
        if (typeof src === "string" && src.trim()) return src.trim();
      }
    }
  }
  return null;
}

/**
 * Recover the codegen (harness, model, model_variant) a scorecard evaluated
 * from the `*.meta.json` sidecars beside each scored source file. Majority
 * combination wins; an empty result means nothing was recoverable.
 */
export function resolveCodegenProvenance(scorecard: Record<string, any>, repoRoot: string): Record<string, string> {
  const combos = new Map<string, { count: number; harness: unknown; model: unknown; variant: unknown }>();
  for (const caseRow of scorecard.cases ?? []) {
    if (caseRow === null || typeof caseRow !== "object" || Array.isArray(caseRow)) continue;
    const meta = loadMetaForSource(repoRoot, caseSourcePath(repoRoot, caseRow));
    if (meta) {
      const key = JSON.stringify([meta.harness ?? null, meta.model_id ?? null, meta.model_variant ?? null]);
      const existing = combos.get(key);
      if (existing) existing.count += 1;
      else combos.set(key, { count: 1, harness: meta.harness, model: meta.model_id, variant: meta.model_variant });
    }
  }
  if (!combos.size) return {};
  let best: { count: number; harness: unknown; model: unknown; variant: unknown } | null = null;
  for (const combo of combos.values()) {
    if (!best || combo.count > best.count) best = combo;
  }
  const out: Record<string, string> = {};
  if (typeof best!.harness === "string" && best!.harness.trim()) out.harness = best!.harness.trim();
  if (typeof best!.model === "string" && best!.model.trim()) out.model = best!.model.trim();
  if (typeof best!.variant === "string" && best!.variant.trim()) out.model_variant = best!.variant.trim();
  return out;
}

export interface BuildScorecardOptions {
  threshold?: number;
  repoRoot: string;
  timestampUtc: string;
  commit: string;
  artifacts?: Record<string, any> | null;
  visualReview?: Record<string, any> | null;
  requireVisualReview?: boolean;
  harness?: string | null;
  harnessJudge?: string | null;
  model?: string | null;
  modelVariant?: string | null;
}

export function buildScorecard(inputs: ScorecardInput[], options: BuildScorecardOptions): Record<string, any> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const { timestampUtc, commit } = options;
  const visualReview = options.visualReview ?? null;
  const requireVisualReview = options.requireVisualReview ?? false;

  const visualLookup = visualReviewLookup(visualReview);
  const cases: Array<Record<string, any>> = [];
  for (const input of inputs) {
    const caseRow = caseScore(input);
    caseRow.visual_review = normalizeVisualReview(
      caseRow,
      visualLookup.get(`${caseRow.skill}\u0000${caseRow.case_id}`),
      requireVisualReview,
    );
    cases.push(caseRow);
  }

  const checks = cases.flatMap((caseRow) => caseRow.checks as Array<Record<string, any>>);
  const overall = scoreForChecks(checks);
  const summary = visualSummary(cases, visualReview !== null);

  const categories: Record<string, Array<Record<string, any>>> = {};
  for (const check of checks) {
    (categories[check.category] ??= []).push(check);
  }
  const categoryScores: Record<string, Record<string, number>> = {};
  for (const category of Object.keys(categories).sort()) {
    categoryScores[category] = scoreForChecks(categories[category]);
  }

  const criticalFailures: Array<Record<string, any>> = [];
  for (const caseRow of cases) {
    for (const check of caseRow.checks as Array<Record<string, any>>) {
      if (check.result === "fail" && check.critical) {
        criticalFailures.push({
          case_id: caseRow.case_id,
          case_name: caseRow.case_name,
          skill: caseRow.skill,
          task: caseRow.task,
          check_id: check.check_id,
          category: check.category,
          actual: check.actual,
          expected: check.expected,
          tolerance: check.tolerance,
          evidence_path: caseRow.evidence_path,
          detail: check.detail,
        });
      }
    }
  }

  const deterministicResult = overall.score >= threshold && !criticalFailures.length ? "pass" : "fail";
  const visualResult = summary.result;
  // "incomplete" is distinct from "fail": deterministic passed, but the visual
  // lane was requested and never actually ran (no screenshots to judge). It
  // must not read as a green pass, and it is not a red failure either.
  let overallResult: string;
  if (deterministicResult === "pass" && (visualResult === "pass" || visualResult === "not_required")) overallResult = "pass";
  else if (deterministicResult === "pass" && visualResult === "not_run") overallResult = "incomplete";
  else overallResult = "fail";

  const artifactsOut: Record<string, any> = { ...(options.artifacts ?? {}) };
  if (options.harnessJudge && artifactsOut.harness_judge === undefined) artifactsOut.harness_judge = options.harnessJudge;
  if (options.model && artifactsOut.model === undefined) artifactsOut.model = options.model;
  if (options.modelVariant && artifactsOut.model_variant === undefined) artifactsOut.model_variant = options.modelVariant;
  if (artifactsOut.evidence_source === undefined) artifactsOut.evidence_source = evidenceSource(cases);

  const result: Record<string, any> = {
    schema_version: SCORECARD_SCHEMA_VERSION,
    run_id: makeRunId(timestampUtc, commit),
    timestamp_utc: timestampUtc,
    git_commit: commit,
    overall_result: overallResult,
    deterministic_result: deterministicResult,
    overall_score: overall.score,
    threshold,
    category_scores: categoryScores,
    critical_failures: criticalFailures,
    visual_summary: summary,
    cases,
    artifacts: artifactsOut,
  };
  if (options.harness) result.harness = options.harness;
  return result;
}

function markdownValue(value: unknown, maxLength = 160): string {
  let text: string;
  if (value === null || value === undefined) text = "null";
  else if (typeof value === "string") text = value;
  else text = JSON.stringify(sortKeysDeep(value));
  text = text.replace(/\n/g, " ").replace(/\|/g, "\\|");
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "...";
}

export function scorecardToMarkdown(scorecard: Record<string, any>): string {
  const lines: string[] = [
    "# Evaluation Scorecard",
    "",
    `- Result: **${String(scorecard.overall_result).toUpperCase()}**`,
    `- Deterministic result: **${String(scorecard.deterministic_result ?? scorecard.overall_result).toUpperCase()}**`,
    `- Visual review result: **${String(scorecard.visual_summary?.result ?? "not_required").toUpperCase()}**`,
    `- Overall score: ${pct(scorecard.overall_score)}`,
    `- Threshold: ${pct(scorecard.threshold)}`,
    `- Git commit: \`${scorecard.git_commit}\``,
    `- Run ID: \`${scorecard.run_id}\``,
    "",
    "## Category Scores",
    "",
    "| Category | Score | Passed | Total |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [category, data] of Object.entries(scorecard.category_scores as Record<string, any>)) {
    lines.push(`| ${category} | ${pct(data.score)} | ${data.passed_checks} | ${data.total_checks} |`);
  }

  lines.push("", "## Critical Failures", "");
  if ((scorecard.critical_failures as any[]).length) {
    for (const failure of scorecard.critical_failures) {
      lines.push(
        `- \`${failure.skill}/${failure.case_id}/${failure.check_id}\` ` +
          `(${failure.category}): ${failure.detail} ` +
          `Evidence: \`${failure.evidence_path}\`; ` +
          `actual=${markdownValue(failure.actual)}; ` +
          `expected=${markdownValue(failure.expected)}; ` +
          `tolerance=${markdownValue(failure.tolerance)}`,
      );
    }
  } else {
    lines.push("None.");
  }

  const summary = scorecard.visual_summary ?? {};
  lines.push("", "## Qualitative Visual Review", "");
  lines.push(`- Result: **${String(summary.result ?? "not_required").toUpperCase()}**`);
  lines.push(`- Reviewed cases: ${summary.reviewed_count ?? 0}/${summary.total_cases ?? 0}`);
  lines.push(`- Required cases: ${summary.required_count ?? 0}`);
  lines.push(`- Blocking visual issues: ${(summary.blocking_failures ?? []).length}`);
  if ((summary.blocking_failures ?? []).length) {
    lines.push("");
    for (const failure of summary.blocking_failures) {
      lines.push(`- \`${failure.skill}/${failure.case_id}\` (${failure.status}): ${failure.summary}`);
    }
  }

  lines.push("", "## Cases", "");
  for (const caseRow of scorecard.cases) {
    const visualReview = caseRow.visual_review ?? {};
    lines.push(`### ${caseRow.skill} / ${caseRow.case_id} - ${caseRow.case_name}`);
    lines.push("");
    lines.push(`- Result: **${String(caseRow.result).toUpperCase()}**`);
    lines.push(`- Score: ${pct(caseRow.score)}`);
    lines.push(`- Visual review: **${String(visualReview.status ?? "not_reviewed").toUpperCase()}**`);
    lines.push(`- Visual summary: ${visualReview.summary ?? "No visual review recorded."}`);
    const sourceContext = caseRow.source_context ?? {};
    const evidenceSummary = caseRow.evidence_summary ?? {};
    if (Object.keys(sourceContext).length) {
      lines.push(`- Expected source: \`${sourceContext.source ?? "evaluation/cases"}\``);
      if (sourceContext.source_scenario_id) {
        lines.push(`- Source scenario: \`${sourceContext.source_scenario_id}\` / \`${sourceContext.source_name ?? ""}\``);
      }
    }
    if (Object.keys(evidenceSummary).length) {
      lines.push(`- Actual source: \`${evidenceSummary.actual_source_path ?? ""}\``);
      if (evidenceSummary.run_artifact_path) {
        lines.push(`- Observed run artifact: \`${evidenceSummary.run_artifact_path}\``);
      }
    }
    lines.push(`- Category: \`${caseRow.category}\``);
    lines.push(`- Duration: ${caseRow.duration_ms} ms`);
    if (caseRow.error !== null && caseRow.error !== undefined) {
      lines.push(`- Error: \`${caseRow.error}\``);
    }
    lines.push(`- Evidence: \`${caseRow.evidence_path}\``);
    lines.push("");
    lines.push("| Check | Category | Critical | Result | Actual | Expected | Tolerance | Detail |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const check of caseRow.checks) {
      lines.push(
        `| \`${check.check_id}\` | ${check.category} | ` +
          `${String(Boolean(check.critical))} | ${check.result} | ` +
          `${markdownValue(check.actual)} | ` +
          `${markdownValue(check.expected)} | ` +
          `${markdownValue(check.tolerance)} | ` +
          `${markdownValue(check.detail)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\s+$/, "") + "\n";
}

export function writeScorecard(scorecard: Record<string, any>, outputDir: string): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "scorecard.json");
  const mdPath = path.join(outputDir, "scorecard.md");
  fs.writeFileSync(jsonPath, stableStringify(scorecard) + "\n");
  fs.writeFileSync(mdPath, scorecardToMarkdown(scorecard));
  return { jsonPath, mdPath };
}
