/**
 * `cesium-eval audit` — run BOTH evaluation lanes (deterministic checks and
 * the visual judge panel) over the skills' rendered baselines and assemble
 * one combined scorecard under evaluation/artifacts/audits/<run_id>/.
 *
 * Emits the same JSONL progress-journal events the optimization loop uses, so
 * the console's Live station and CI log collectors can stream progress.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs, repoRelative } from "../lib/paths.js";
import { gitCommit } from "../lib/proc.js";
import { nowIsoSeconds } from "../lib/format.js";
import { runCase } from "../evaluation/runner.js";
import {
  ScorecardInput,
  buildScorecard,
  makeRunId,
  resolveCodegenProvenance,
  writeScorecard,
} from "../evaluation/scorecard.js";
import { loadScorecardValidator, loadVisualReviewValidator } from "../evaluation/schema.js";
import { JudgeCall, fakeJudgeCall, judgeRender } from "../evaluation/judge/staticJudge.js";
import { describeAgent, invokeAgent } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";

const BASELINE_CASE_RE = /^eval-1[0-9]{2}$/;

const casesRoot = () => fromRepoRoot("evaluation", "cases");
const fixturesRoot = () => fromRepoRoot("evaluation", "fixtures");
const auditsRoot = () => fromRepoRoot("evaluation", "artifacts", "audits");
const judgePromptsDir = () => fromRepoRoot("evaluation", "prompts", "judge");

export function allSkills(): string[] {
  return listDirs(fixturesRoot()).filter((name) => !name.startsWith("."));
}

function selectBaselineFixtures(skill: string): string[] {
  return globFiles(path.join(fixturesRoot(), skill), "eval-1", "-baseline-observed.evidence.json").filter(
    (fixturePath) => BASELINE_CASE_RE.test(String(readJson(fixturePath).case_id ?? "")),
  );
}

function findCaseManifest(skill: string, caseId: string): string | null {
  const matches = globFiles(path.join(casesRoot(), skill), `${caseId}-`, ".json");
  if (matches.length) return matches[0];
  const exact = path.join(casesRoot(), skill, `${caseId}.json`);
  return fs.existsSync(exact) ? exact : null;
}

function evidenceSummaryFor(evidence: Record<string, any>, evidencePath: string, bundleDir: string | null): Record<string, any> {
  const afterValues = (evidence.after ?? {}).values ?? {};
  return {
    expected_result: evidence.expected_result ?? null,
    evidence_source: evidence.source ?? null,
    actual_source_path: evidence.source_path ?? null,
    run_artifact_path: bundleDir !== null ? repoRelative(bundleDir) : evidence.run_artifact_path ?? null,
    source_scenario_id: afterValues.source_scenario_id ?? null,
    observed_from: (evidence.execution ?? {}).observed_from ?? null,
    evidence_path: repoRelative(evidencePath),
    has_generated_code: typeof evidence.generated_code === "string" && Boolean(evidence.generated_code),
  };
}

function bundleDirFor(evidence: Record<string, any>, bundleRoot: string | null): string | null {
  const rel = evidence.run_artifact_path;
  if (!rel) return null;
  let bundlePath = String(rel);
  if (bundleRoot !== null) {
    const parts = bundlePath.split(/[\\/]/);
    const baselineIndex = parts.indexOf("baseline");
    bundlePath =
      baselineIndex > 0 ? path.join(bundleRoot, ...parts.slice(baselineIndex - 1)) : path.join(bundleRoot, path.basename(bundlePath));
  }
  return path.isAbsolute(bundlePath) ? bundlePath : fromRepoRoot(bundlePath);
}

function screenshotPathsFor(bundleDir: string | null, evidence: Record<string, any>): string[] {
  if (bundleDir !== null) {
    const shots = globFiles(bundleDir, "screenshot", ".png");
    if (shots.length) return shots.map(repoRelative);
  }
  return [...(evidence.screenshots ?? [])].map(String);
}

function screenshotPathFor(bundleDir: string | null, evidence: Record<string, any>): string {
  if (bundleDir !== null) {
    const primary = path.join(bundleDir, "screenshot.png");
    if (fs.existsSync(primary)) return repoRelative(primary);
  }
  const shots = evidence.screenshots ?? [];
  return shots.length ? String(shots[0]) : "";
}

interface AuditCase {
  skill: string;
  caseId: string;
  casePath: string;
  caseDoc: Record<string, any>;
  evidencePath: string;
  evidence: Record<string, any>;
  bundleDir: string | null;
}

function collectCases(skills: string[], bundleRoot: string | null): AuditCase[] {
  const collected: AuditCase[] = [];
  for (const skill of skills) {
    for (const evidencePath of selectBaselineFixtures(skill)) {
      const evidence = readJson(evidencePath);
      const caseId = String(evidence.case_id ?? "");
      const casePath = findCaseManifest(skill, caseId);
      if (casePath === null) {
        throw new Error(`${repoRelative(evidencePath)}: no case manifest for ${skill}/${caseId}`);
      }
      collected.push({
        skill,
        caseId,
        casePath,
        caseDoc: readJson(casePath),
        evidencePath,
        evidence,
        bundleDir: bundleDirFor(evidence, bundleRoot),
      });
    }
  }
  if (!collected.length) throw new Error("no baseline-observed fixtures selected for audit");
  return collected;
}

function caseMetaFor(auditCase: AuditCase): Record<string, any> {
  const { caseDoc } = auditCase;
  const preflight = caseDoc.preflight ?? {};
  return {
    skill: auditCase.skill,
    id: caseDoc.id ?? auditCase.caseId,
    case_id: auditCase.caseId,
    name: caseDoc.name ?? "",
    description: caseDoc.description ?? "",
    prompt: caseDoc.prompt ?? "",
    expected_behaviors: preflight.expected_behaviors ?? caseDoc.expected_behaviors ?? null,
    visual_expectations: preflight.visual_expectations ?? caseDoc.visual_expectations ?? null,
    screenshot_mode: preflight.screenshot_mode ?? null,
  };
}

function validateVisualReviewDoc(visualReview: Record<string, any>, caseKeys: Set<string>): string[] {
  const errors = loadVisualReviewValidator()
    .errors(visualReview)
    .map((error) => `schema error at ${error.location}: ${error.message}`);
  const seen = new Set<string>();
  for (const item of visualReview.items ?? []) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const key = `${item.skill ?? ""}/${item.case_id ?? ""}`;
    if (seen.has(key)) errors.push(`duplicate visual review item: ${key}`);
    seen.add(key);
    if (!caseKeys.has(key)) errors.push(`visual review references unknown case: ${key}`);
  }
  return errors;
}

/** Append-only JSONL progress journal — the shared streaming contract. */
export class ProgressJournal {
  constructor(private journalPath: string | null) {
    if (journalPath !== null) {
      fs.mkdirSync(path.dirname(journalPath), { recursive: true });
      fs.writeFileSync(journalPath, ""); // fresh journal per invocation
    }
  }

  emit(event: string, payload: Record<string, unknown> = {}): void {
    if (this.journalPath === null) return;
    fs.appendFileSync(this.journalPath, JSON.stringify({ timestamp_utc: nowIsoSeconds(), event, ...payload }) + "\n");
  }
}

function resolveSkills(spec: string): string[] {
  const available = allSkills();
  if (spec.trim().toLowerCase() === "all") return available;
  const requested = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = requested.filter((s) => !available.includes(s));
  if (unknown.length) {
    throw new Error(`unknown skill(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`);
  }
  return requested;
}

/** Judge adapter names accepted by --adapter: any registry harness id or "fake". */
function makeJudgeCall(ctx: EvalContext, adapter: string, model: string | undefined): { call: JudgeCall; model: string | null } {
  if (adapter === "fake") return { call: fakeJudgeCall(), model: model ?? "fake" };
  const overrides = { harness: adapter, model };
  const described = describeAgent(ctx, "judge", overrides);
  const call: JudgeCall = (prompt, files, addDirs) =>
    invokeAgent(ctx, "judge", { prompt, files, addDirs, allowedTools: [], overrides });
  return { call, model: described.model };
}

export interface AuditOptions {
  skills?: string;
  judgeModel?: string;
  nJudges?: number;
  noJudge?: boolean;
  visualReview?: string;
  emitCases?: string;
  emitVisualReview?: string;
  adapter?: string;
  harness?: string;
  bundleRoot?: string;
  threshold?: number;
  outputDir?: string;
  journal?: string;
}

export async function auditCommand(ctx: EvalContext, options: AuditOptions): Promise<number> {
  const skills = resolveSkills(options.skills ?? "all");
  const bundleRoot = options.bundleRoot ? fromRepoRoot(options.bundleRoot) : null;
  const auditCases = collectCases(skills, bundleRoot);
  const caseKeys = new Set(auditCases.map((c) => `${c.skill}/${c.caseId}`));

  const adapterName = options.adapter ?? ctx.resolveRole("judge").harness.id;
  const codegenHarness = options.harness ?? ctx.resolveRole("codegen").harness.id;
  const nJudges = options.nJudges ?? ctx.config.judgePanel.size;

  if (options.emitCases) {
    const casesList = auditCases.map((c) => ({
      skill: c.skill,
      case_id: c.caseId,
      prompt: String(c.caseDoc.prompt ?? ""),
      bundle_dir: c.bundleDir ? repoRelative(c.bundleDir) : "",
      screenshot_path: screenshotPathFor(c.bundleDir, c.evidence),
      screenshots: screenshotPathsFor(c.bundleDir, c.evidence),
      case_path: repoRelative(c.casePath),
    }));
    const out = fromRepoRoot(options.emitCases);
    writeJsonPlain(out, casesList);
    console.log(`[audit] wrote ${casesList.length} cases -> ${repoRelative(out)}`);
    return 0;
  }

  const timestampUtc = nowIsoSeconds();
  const commit = gitCommit(ctx.repoRoot);
  const runId = makeRunId(timestampUtc, commit);

  const journal = new ProgressJournal(options.journal ? fromRepoRoot(options.journal) : null);
  journal.emit("audit_started", {
    run_id: runId,
    skills,
    case_count: auditCases.length,
    cases: auditCases.map((c) => ({ skill: c.skill, case_id: c.caseId })),
    judge: Boolean(options.visualReview) || !options.noJudge,
    adapter: adapterName,
    n_judges: nJudges,
    harness: codegenHarness,
  });

  try {
    return runAudit(ctx, options, { auditCases, caseKeys, timestampUtc, commit, runId, journal, adapterName, codegenHarness, nJudges });
  } catch (exc: any) {
    journal.emit("audit_failed", { error: `${exc?.constructor?.name ?? "Error"}: ${exc?.message ?? exc}` });
    throw exc;
  }
}

interface AuditRun {
  auditCases: AuditCase[];
  caseKeys: Set<string>;
  timestampUtc: string;
  commit: string;
  runId: string;
  journal: ProgressJournal;
  adapterName: string;
  codegenHarness: string;
  nJudges: number;
}

function runAudit(ctx: EvalContext, options: AuditOptions, run: AuditRun): number {
  const { auditCases, caseKeys, timestampUtc, commit, runId, journal, adapterName, codegenHarness, nJudges } = run;

  // --- Lane 2: qualitative ------------------------------------------------
  let visualReview: Record<string, any> | null = null;
  let judgedCount = 0;

  if (options.visualReview) {
    visualReview = readJson(options.visualReview);
    visualReview!.schema_version ??= "1.0";
    visualReview!.reviewer ??= "screenshot-visual-judge";
    visualReview!.run_id ??= runId;
    judgedCount = (visualReview!.items ?? []).filter(
      (item: any) => item?.status !== undefined && item?.status !== null && item?.status !== "not_reviewed",
    ).length;
  } else if (!options.noJudge) {
    const { call, model } = makeJudgeCall(ctx, adapterName, options.judgeModel);
    const items: Array<Record<string, any>> = [];
    journal.emit("judge_started", { total: auditCases.length, adapter: adapterName, n_judges: nJudges });
    auditCases.forEach((auditCase, index) => {
      const item = judgeRender(caseMetaFor(auditCase), auditCase.bundleDir ?? "", {
        call,
        model,
        nJudges,
        seeds: ctx.config.judgePanel.seeds,
        protocol: ctx.config.judgePanel.staticProtocol,
        promptsDir: judgePromptsDir(),
      });
      items.push(item);
      if (item.status !== null && item.status !== undefined && item.status !== "not_reviewed") judgedCount += 1;
      journal.emit("judge_case_completed", {
        skill: auditCase.skill,
        case_id: auditCase.caseId,
        index: index + 1,
        total: auditCases.length,
        status: item.status ?? null,
      });
    });
    journal.emit("judge_completed", { judged_count: judgedCount, total: auditCases.length });
    visualReview = {
      schema_version: "1.0",
      reviewer: "screenshot-visual-judge",
      run_id: runId,
      reviewed_at: timestampUtc,
      items,
    };
  }

  if (options.emitVisualReview && visualReview !== null) {
    const out = fromRepoRoot(options.emitVisualReview);
    writeJsonPlain(out, visualReview);
    console.log(`[audit] wrote visual-review -> ${repoRelative(out)}`);
  }

  if (visualReview !== null) {
    const visualErrors = validateVisualReviewDoc(visualReview, caseKeys);
    if (visualErrors.length) {
      for (const error of visualErrors) console.error(`[audit] visual-review ${error}`);
      journal.emit("audit_failed", { error: `visual-review validation: ${visualErrors.length} error(s)` });
      return 2;
    }
  }

  // --- Lane 1: deterministic + combined scorecard ---------------------------
  const inputs: ScorecardInput[] = [];
  journal.emit("scoring_started", { total: auditCases.length });
  auditCases.forEach((auditCase, index) => {
    const result = runCase(auditCase.caseDoc, auditCase.evidence);
    inputs.push({
      caseDoc: auditCase.caseDoc,
      result,
      evidencePath: repoRelative(auditCase.evidencePath),
      screenshots: screenshotPathsFor(auditCase.bundleDir, auditCase.evidence),
      evidenceSummary: evidenceSummaryFor(auditCase.evidence, auditCase.evidencePath, auditCase.bundleDir),
    });
    journal.emit("scoring_case_completed", {
      skill: auditCase.skill,
      case_id: auditCase.caseId,
      index: index + 1,
      total: auditCases.length,
      result: result.result,
    });
  });
  journal.emit("scoring_completed", { total: auditCases.length });

  const scorecard = buildScorecard(inputs, {
    threshold: options.threshold ?? ctx.config.threshold,
    repoRoot: ctx.repoRoot,
    timestampUtc,
    commit,
    visualReview,
    requireVisualReview: visualReview !== null,
    harness: codegenHarness,
    harnessJudge: adapterName,
  });

  // Stamp codegen provenance recovered from the evaluated code's meta sidecars.
  const provenance = resolveCodegenProvenance(scorecard, ctx.repoRoot);
  const artifacts = (scorecard.artifacts ??= {});
  if (provenance.model && artifacts.model === undefined) artifacts.model = provenance.model;
  if (provenance.model_variant && artifacts.model_variant === undefined) artifacts.model_variant = provenance.model_variant;
  if (provenance.harness && !scorecard.harness) scorecard.harness = provenance.harness;

  const outputDir = options.outputDir ? fromRepoRoot(options.outputDir) : path.join(auditsRoot(), scorecard.run_id);
  const { jsonPath, mdPath } = writeScorecard(scorecard, outputDir);

  const errors = loadScorecardValidator().errors(scorecard);
  if (errors.length) {
    for (const error of errors) console.error(`[audit] schema error at ${error.location}: ${error.message}`);
    journal.emit("audit_failed", { error: `scorecard schema: ${errors.length} error(s)` });
    return 2;
  }

  journal.emit("scorecard_written", {
    run_id: scorecard.run_id,
    path: repoRelative(jsonPath),
    overall_result: scorecard.overall_result,
    overall_score: scorecard.overall_score,
  });

  console.log(`[audit] wrote ${repoRelative(jsonPath)}`);
  console.log(`[audit] wrote ${repoRelative(mdPath)}`);
  console.log(`[audit] run_id=${scorecard.run_id}`);
  console.log(`[audit] deterministic_result=${scorecard.deterministic_result}`);
  console.log(`[audit] visual_result=${scorecard.visual_summary.result}`);
  console.log(`[audit] overall_result=${scorecard.overall_result}`);
  console.log(`[audit] judged_baseline_count=${judgedCount}`);
  journal.emit("audit_completed", {
    run_id: scorecard.run_id,
    overall_result: scorecard.overall_result,
    deterministic_result: scorecard.deterministic_result,
    visual_result: scorecard.visual_summary.result,
  });
  return scorecard.overall_result === "pass" ? 0 : 1;
}

/** `cesium-eval judge` — run the static judge panel over one bundle. */
export async function judgeCommand(
  ctx: EvalContext,
  options: { bundle: string; case: string; model?: string; nJudges?: number; adapter?: string; emitItem?: string },
): Promise<number> {
  const adapterName = options.adapter ?? ctx.resolveRole("judge").harness.id;
  const { call, model } = makeJudgeCall(ctx, adapterName, options.model);
  const item = judgeRender(readJson(options.case), options.bundle, {
    call,
    model,
    nJudges: options.nJudges ?? ctx.config.judgePanel.size,
    seeds: ctx.config.judgePanel.seeds,
    protocol: ctx.config.judgePanel.staticProtocol,
    promptsDir: judgePromptsDir(),
  });
  const payload = JSON.stringify(item, null, 2);
  if (options.emitItem) {
    fs.mkdirSync(path.dirname(path.resolve(options.emitItem)), { recursive: true });
    fs.writeFileSync(options.emitItem, payload + "\n");
    console.error(`[judge] wrote item -> ${options.emitItem}`);
  } else {
    console.log(payload);
  }
  return 0;
}
