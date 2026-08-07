/**
 * `cesium-eval audit` — run BOTH evaluation lanes (deterministic execution
 * health and the visual judge panel) over the skills' rendered baselines and
 * assemble one combined scorecard under evaluation/artifacts/audits/<run_id>/.
 *
 * The work list is derived live: one case per tracked scenario manifest
 * (optimization/scenarios/<skill>/), scored against the rendered bundle the
 * optimization loop wrote for it (optimization/runs/<skill>/baseline/), so the
 * audit always judges the CURRENT baselines — nothing is frozen in git.
 *
 * Emits the same JSONL progress-journal events the optimization loop uses, so
 * the console's Live station and CI log collectors can stream progress.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, repoRelative } from "../lib/paths.js";
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
import {
  baselineScenarios,
  baselineSkills,
  generatedCodePath,
  resolveBundleDir,
  type BaselineScenario,
} from "../evaluation/baselines.js";
import { JudgeCall, fakeJudgeCall, judgeRender } from "../evaluation/judge/staticJudge.js";
import { describeAgent, invokeAgent } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";

const auditsRoot = () => fromRepoRoot("evaluation", "artifacts", "audits");
const judgePromptsDir = () => fromRepoRoot("evaluation", "prompts", "judge");

export function allSkills(): string[] {
  return baselineSkills();
}

function readJsonIfExists(filePath: string): Record<string, any> | null {
  try {
    return fs.existsSync(filePath) ? readJson(filePath) : null;
  } catch {
    return null;
  }
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

/** Execution-health contract every rendered baseline must satisfy. */
const BASELINE_HEALTH_CHECKS: Array<Record<string, any>> = [
  {
    id: "code_runs_00",
    type: "code_runs",
    category: "execution_health",
    critical: true,
    description: "Rendered baseline bundle exists and the generated code executed",
  },
  {
    id: "no_runtime_errors_01",
    type: "no_runtime_errors",
    category: "execution_health",
    critical: true,
    description: "No runtime errors captured in the rendered baseline",
  },
  {
    id: "programmatic_checks_02",
    type: "json_value_equals",
    path: "/after/values/programmatic_summary/failed",
    expected: 0,
    category: "execution_health",
    critical: true,
    description: "All of the scenario's in-browser programmatic checks passed",
  },
];

function caseDocFor(scenario: BaselineScenario): Record<string, any> {
  const { doc } = scenario;
  return {
    schema_version: "1.0",
    id: scenario.id,
    name: scenario.name,
    skill: scenario.skill,
    category: "baseline_health",
    critical: Boolean(doc.regression_critical ?? true),
    description: doc.description ?? "",
    prompt: doc.prompt ?? "",
    preflight: {
      expected_behaviors: doc.expected_behaviors ?? null,
      visual_expectations: doc.visual_expectations ?? null,
      screenshot_mode: doc.screenshot_mode ?? null,
    },
    checks: BASELINE_HEALTH_CHECKS,
  };
}

function evidenceFor(scenario: BaselineScenario, bundleDir: string | null): Record<string, any> {
  const checksDoc = bundleDir !== null ? readJsonIfExists(path.join(bundleDir, "programmatic-checks.json")) : null;
  const consoleDoc = bundleDir !== null ? readJsonIfExists(path.join(bundleDir, "console.json")) : null;
  const { skill, id: scenarioId } = scenario;
  const codePath = generatedCodePath(scenario);
  const hasCode = fs.existsSync(codePath);
  // A bundle without parseable console evidence is an incomplete render, not a
  // clean one — surface it as an error so the health checks cannot pass it.
  const errors =
    bundleDir === null
      ? ["baseline bundle not rendered (run the optimization loop or pass --bundle-root)"]
      : !Array.isArray(consoleDoc?.errors)
        ? ["console.json missing or unreadable in the rendered bundle; re-render the baseline"]
        : consoleDoc!.errors;
  // summary.failed is 1 when the bundle is missing so the programmatic check
  // fails with a value mismatch instead of aborting on an unresolvable pointer.
  const summary = checksDoc?.summary ?? { total: 0, passed: 0, failed: 1, pass_rate: 0 };
  return {
    schema_version: "1.0",
    case_id: scenarioId,
    case_name: scenario.name,
    skill,
    source: "baseline-run",
    expected_result: "pass",
    before: { entities: {}, values: {} },
    after: { entities: {}, values: { programmatic_summary: summary, source_scenario_id: scenarioId } },
    errors,
    execution: {
      success: checksDoc !== null,
      observed_from: bundleDir !== null ? repoRelative(path.join(bundleDir, "programmatic-checks.json")) : null,
    },
    generated_code: hasCode ? fs.readFileSync(codePath, "utf-8") : "",
    source_path: hasCode ? repoRelative(codePath) : null,
    run_artifact_path: bundleDir !== null ? repoRelative(bundleDir) : null,
  };
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
    for (const scenario of baselineScenarios(skill)) {
      const bundleDir = resolveBundleDir(scenario, bundleRoot);
      const evidence = evidenceFor(scenario, bundleDir);
      collected.push({
        skill,
        caseId: scenario.id,
        casePath: scenario.scenarioPath,
        caseDoc: caseDocFor(scenario),
        evidencePath: bundleDir !== null ? path.join(bundleDir, "programmatic-checks.json") : scenario.scenarioPath,
        evidence,
        bundleDir,
      });
    }
  }
  if (!collected.length) throw new Error("no scenarios selected for audit");
  if (collected.every((auditCase) => auditCase.bundleDir === null)) {
    // Name the root actually searched: reporting the default while judging a
    // caller-supplied root sends the operator to the wrong directory.
    const searched = bundleRoot !== null ? `${repoRelative(bundleRoot)}/<skill>/baseline` : "optimization/runs/<skill>/baseline";
    throw new Error(
      `no rendered baseline bundles found under ${searched}; ` +
        "render them first (cesium-eval optimize <skills> --max-iterations 1) or pass --bundle-root",
    );
  }
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

/** Judge harness names accepted by --judge-harness: any registry harness id or "fake". */
function makeJudgeCall(
  ctx: EvalContext,
  judgeHarness: string,
  model: string | undefined,
  variant: string | undefined,
  provider?: string,
): { call: JudgeCall; model: string | null } {
  if (judgeHarness === "fake") return { call: fakeJudgeCall(), model: model ?? "fake" };
  const overrides = { harness: judgeHarness, model, variant };
  const described = describeAgent(ctx, "judge", overrides);
  const call: JudgeCall = async (prompt, files, addDirs) => {
    const invocation = await invokeAgent(ctx, "judge", {
      prompt,
      files,
      addDirs,
      allowedTools: [],
      provider: provider ?? null,
      overrides,
    });
    return { text: invocation.text, agent: invocation.agent };
  };
  return { call, model: described.model };
}

/** Cases the visual-judge lane works at once when `--concurrency` is omitted.
 *  A calm parallel default: fast enough to matter, gentle on harness rate
 *  limits (each case still fans out to its own n-judge panel). */
export const DEFAULT_JUDGE_CONCURRENCY = 4;

export interface AuditOptions {
  skills?: string;
  judgeModel?: string;
  /** Canonical provider id serving the judge model (models are only provided
   * by providers; drivers route it natively or fail loudly). */
  judgeProvider?: string;
  judgeVariant?: string;
  nJudges?: number;
  /** Cases judged in parallel (1-8). Default 4; set 1 for strictly sequential. */
  concurrency?: number;
  noJudge?: boolean;
  visualReview?: string;
  emitCases?: string;
  emitVisualReview?: string;
  judgeHarness?: string;
  codegenHarness?: string;
  codegenModel?: string;
  /** Provenance stamp: the provider that served the codegen model. */
  codegenProvider?: string;
  codegenVariant?: string;
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

  const judgeHarness = options.judgeHarness ?? ctx.resolveRole("judge").harness.id;
  const codegenHarness = options.codegenHarness ?? ctx.resolveRole("codegen").harness.id;
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
    judge_harness: judgeHarness,
    n_judges: nJudges,
    codegen_harness: codegenHarness,
  });

  try {
    return await runAudit(ctx, options, { auditCases, caseKeys, timestampUtc, commit, runId, journal, judgeHarness, codegenHarness, nJudges });
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
  judgeHarness: string;
  codegenHarness: string;
  nJudges: number;
}

async function runAudit(ctx: EvalContext, options: AuditOptions, run: AuditRun): Promise<number> {
  const { auditCases, caseKeys, timestampUtc, commit, runId, journal, judgeHarness, codegenHarness, nJudges } = run;

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
    const { call, model } = makeJudgeCall(ctx, judgeHarness, options.judgeModel, options.judgeVariant, options.judgeProvider);
    const concurrency = Math.max(1, Math.min(8, options.concurrency ?? DEFAULT_JUDGE_CONCURRENCY));
    const items: Array<Record<string, any>> = new Array(auditCases.length);
    const workerCount = Math.min(concurrency, auditCases.length);
    journal.emit("judge_started", {
      total: auditCases.length,
      judge_harness: judgeHarness,
      n_judges: nJudges,
      concurrency,
      workers: workerCount,
    });
    // Worker pool: up to `concurrency` cases in flight at once. Each worker
    // carries a stable 1-based id so the journal and the live board can show
    // *which* worker is judging *which* case. Items land at their case's slot
    // so the emitted visual-review doc keeps roster order regardless of the
    // order cases actually finish in.
    let nextIndex = 0;
    let completedCount = 0;
    const judgeOne = async (workerId: number, index: number) => {
      const auditCase = auditCases[index];
      const startedAt = Date.now();
      journal.emit("judge_case_started", {
        worker_id: workerId,
        skill: auditCase.skill,
        case_id: auditCase.caseId,
        roster_index: index + 1,
        total: auditCases.length,
      });
      const item = await judgeRender(caseMetaFor(auditCase), auditCase.bundleDir ?? "", {
        call,
        model,
        nJudges,
        seeds: ctx.config.judgePanel.seeds,
        protocol: ctx.config.judgePanel.staticProtocol,
        promptsDir: judgePromptsDir(),
      });
      items[index] = item;
      if (item.status !== null && item.status !== undefined && item.status !== "not_reviewed") judgedCount += 1;
      completedCount += 1;
      journal.emit("judge_case_completed", {
        worker_id: workerId,
        skill: auditCase.skill,
        case_id: auditCase.caseId,
        index: completedCount,
        total: auditCases.length,
        status: item.status ?? null,
        duration_ms: Date.now() - startedAt,
      });
    };
    const workers = Array.from({ length: workerCount }, (_unused, slot) =>
      (async () => {
        const workerId = slot + 1;
        while (nextIndex < auditCases.length) {
          const index = nextIndex;
          nextIndex += 1;
          await judgeOne(workerId, index);
        }
      })(),
    );
    await Promise.all(workers);
    journal.emit("judge_completed", { judged_count: judgedCount, total: auditCases.length, concurrency });
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
    harnessJudge: judgeHarness,
  });

  // Stamp codegen provenance: explicit --codegen-model/--codegen-variant flags
  // win; anything still unset is recovered from the evaluated code's meta sidecars.
  const artifacts = (scorecard.artifacts ??= {});
  if (options.codegenModel) artifacts.model = options.codegenModel;
  if (options.codegenProvider) artifacts.model_provider = options.codegenProvider;
  if (options.codegenVariant) artifacts.model_variant = options.codegenVariant;
  const provenance = resolveCodegenProvenance(scorecard, ctx.repoRoot);
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
  options: { bundle: string; case: string; model?: string; variant?: string; nJudges?: number; harness?: string; emitItem?: string },
): Promise<number> {
  const judgeHarness = options.harness ?? ctx.resolveRole("judge").harness.id;
  const { call, model } = makeJudgeCall(ctx, judgeHarness, options.model, options.variant);
  const item = await judgeRender(readJson(options.case), options.bundle, {
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
