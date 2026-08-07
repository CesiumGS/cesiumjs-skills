/**
 * Autonomous iteration loop: propose -> codegen -> render -> judge -> decide
 * -> report -> archive (-> promote on KEEP), streaming journal events that
 * the console's Live station tails. Runs fully in-process.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { canonicalStringify } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs, repoRelative } from "../lib/paths.js";
import { sha256Text } from "../lib/proc.js";
import { generateScenarioCode } from "./skillsAdapter.js";
import { renderCommand } from "./browserRunner.js";
import { judgePanel, writeJudgeVerdicts } from "./pairwiseJudge.js";
import { decide, environmentMismatch, loadBaselines } from "./decisionEngine.js";
import { computeScores, generateSummaryMarkdown, updatePublicStatus } from "./report.js";
import { scanPublicArtifacts } from "./publicArtifacts.js";
import { proposeCommand } from "./proposer.js";
import { describeAgent, invokeAgent } from "../harness/invoke.js";
import { loadScenario } from "./types.js";
import type { CheckResultEntry, JudgeResultEntry, ScenarioMetaEntry } from "./types.js";
import type { EvalContext } from "../config/types.js";

// ---------------------------------------------------------------------------
// journal (persisted strings are scrubbed of local paths/URLs)
// ---------------------------------------------------------------------------
const HOME_PATH_RE = /(?:\/Users\/|\/home\/|C:\\Users\\)[^/\\\s:'"]+[/\\]/g;
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/g;

/** Scrub machine-local home paths and loopback URLs from journal strings.
 * (Not a secret scanner — gitleaks and `check public-artifacts` cover that.) */
export function redactLocalPaths(text: string): string {
  return text.replace(LOCAL_URL_RE, "<redacted-local-url>").replace(HOME_PATH_RE, "<redacted-path>/");
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "string") return redactLocalPaths(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export function writeJournalEvent(journalPath: string, event: string, fields: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const record = { timestamp_utc: new Date().toISOString(), event, ...(jsonSafe(fields) as Record<string, unknown>) };
  fs.appendFileSync(journalPath, JSON.stringify(record) + "\n");
}

// ---------------------------------------------------------------------------
// loop steps
// ---------------------------------------------------------------------------
interface StepResult {
  success: boolean;
  error: string | null;
  [key: string]: unknown;
}

export interface AgentSelection {
  harness?: string;
  model?: string;
  variant?: string;
}

export interface LoopOptions {
  skill: string;
  maxIterations?: number;
  stopOn?: "plateau" | "regression" | "max";
  plateauN?: number;
  /**
   * Human promotion gate: only when true are KEEP candidates applied to
   * skills/<skill>/SKILL.md. Otherwise a KEEP is staged as PROMOTED-PENDING.md
   * and the loop stops so a human can review and run `optimize promote`.
   */
  promote?: boolean;
  proposer?: AgentSelection;
  codegen?: AgentSelection;
  judge?: AgentSelection;
  proposerTemperature?: number;
  proposerHistory?: number;
  proposerDecisionPath?: string;
}

const scenarioFilesFor = (skill: string) => globFiles(fromRepoRoot("optimization", "scenarios", skill), "eval-", ".json");

function nextIteration(skill: string): string {
  const existing = listDirs(fromRepoRoot("optimization", "candidates", skill))
    .filter((name) => /^\d+$/.test(name))
    .map(Number);
  return String(existing.length ? Math.max(...existing) + 1 : 1).padStart(3, "0");
}

async function runProposerStep(ctx: EvalContext, options: LoopOptions, iteration: string): Promise<StepResult> {
  console.log(`\n=== Iteration ${iteration}: Proposer ===`);
  try {
    const code = await proposeCommand(ctx, {
      skill: options.skill,
      iteration,
      maxHistory: options.proposerHistory,
      temperature: options.proposerTemperature,
      decisionPath: options.proposerDecisionPath,
      ...options.proposer,
    });
    if (code !== 0) return { success: false, candidate_path: null, error: `Proposer exited ${code}` };
    const candidatePath = fromRepoRoot("optimization", "candidates", options.skill, iteration, "SKILL.md");
    if (!fs.existsSync(candidatePath)) {
      return { success: false, candidate_path: null, error: `Proposer did not create expected candidate file: ${candidatePath}` };
    }
    return { success: true, candidate_path: candidatePath, error: null };
  } catch (exc: any) {
    return { success: false, candidate_path: null, error: `Proposer failed: ${exc.message}` };
  }
}

async function runCodegenStep(ctx: EvalContext, options: LoopOptions, iteration: string, candidatePath: string): Promise<StepResult> {
  console.log(`\n=== Iteration ${iteration}: Codegen ===`);
  const scenarioFiles = scenarioFilesFor(options.skill);
  if (!scenarioFiles.length) {
    return { success: false, generated_count: 0, error: `No scenarios found for ${options.skill}` };
  }
  let generated = 0;
  for (const scenarioFile of scenarioFiles) {
    try {
      const scenario = loadScenario(scenarioFile);
      const { outputPath } = await generateScenarioCode(ctx, {
        skill: options.skill,
        iteration,
        skillPath: candidatePath,
        scenario,
        overrides: options.codegen,
      });
      console.log(`  + Generated ${scenario.id}: ${repoRelative(outputPath)}`);
      generated += 1;
    } catch (exc: any) {
      console.error(`  x Failed to generate ${path.basename(scenarioFile)}: ${exc.message}`);
    }
  }
  if (!generated) return { success: false, generated_count: 0, error: "No scenarios were successfully generated" };
  console.log(`Generated code for ${generated}/${scenarioFiles.length} scenarios`);
  return { success: true, generated_count: generated, error: null };
}

async function runRenderStep(ctx: EvalContext, options: LoopOptions, iteration: string): Promise<StepResult> {
  console.log(`\n=== Iteration ${iteration}: Browser Runner ===`);
  try {
    const code = await renderCommand(ctx, { skill: options.skill, iteration });
    if (code !== 0) return { success: false, runs_dir: null, error: `Browser runner exited ${code}` };
    const runsDir = fromRepoRoot("optimization", "runs", options.skill, iteration);
    if (!fs.existsSync(runsDir)) {
      return { success: false, runs_dir: null, error: `Runner did not create expected output directory: ${runsDir}` };
    }
    return { success: true, runs_dir: runsDir, error: null };
  } catch (exc: any) {
    return { success: false, runs_dir: null, error: `Browser runner failed: ${exc.message}` };
  }
}

export function expectedBundleCount(skill: string): number {
  return scenarioFilesFor(skill)
    .map(loadScenario)
    .filter((scenario) => (scenario.runner_mode ?? "global-js") !== "review-only").length;
}

export function evidenceDirComplete(runsDir: string, expectedCount: number): boolean {
  if (expectedCount === 0 || !fs.existsSync(runsDir)) return false;
  const required = ["console.json", "programmatic-checks.json", "scene-state.json", "metadata.json", "screenshot-quality.json"];
  let complete = 0;
  for (const bundleName of listDirs(runsDir)) {
    const bundle = path.join(runsDir, bundleName);
    const hasScreenshot = globFiles(bundle, "screenshot", ".png").length > 0;
    if (hasScreenshot && required.every((name) => fs.existsSync(path.join(bundle, name)))) complete += 1;
  }
  return complete >= expectedCount;
}

function findBundle(runsDir: string, scenarioId: string, scenarioName: string): string | null {
  const expected = path.join(runsDir, `${scenarioId}-${scenarioName}`);
  if (fs.existsSync(expected) && fs.statSync(expected).isDirectory()) return expected;
  for (const name of listDirs(runsDir)) {
    if (name.startsWith(`${scenarioId}-`)) return path.join(runsDir, name);
  }
  return null;
}

export function getBaselineDir(skill: string, currentIteration: string): string | null {
  const iterationNum = Number.parseInt(currentIteration, 10);
  const baseline = fromRepoRoot("optimization", "runs", skill, "baseline");
  if (iterationNum === 1) return fs.existsSync(baseline) ? baseline : null;

  const historyDir = fromRepoRoot("optimization", "history", skill);
  const iterationDirs = listDirs(historyDir)
    .filter((name) => name.startsWith("iteration-"))
    .sort()
    .reverse();
  for (const iterationDirName of iterationDirs) {
    const decisionFile = path.join(historyDir, iterationDirName, "decision.json");
    if (!fs.existsSync(decisionFile)) continue;
    if (readJson(decisionFile).decision !== "KEEP") continue;
    const iterNum = iterationDirName.replace("iteration-", "");
    const keptRuns = fromRepoRoot("optimization", "runs", skill, iterNum);
    if (fs.existsSync(keptRuns)) return keptRuns;
  }
  return fs.existsSync(baseline) ? baseline : null;
}

async function runJudgesStep(ctx: EvalContext, options: LoopOptions, iteration: string, runsDir: string): Promise<StepResult> {
  console.log(`\n=== Iteration ${iteration}: Judge Panel ===`);
  const scenarioFiles = scenarioFilesFor(options.skill);
  const baselineDir = getBaselineDir(options.skill, iteration);
  if (baselineDir === null) {
    console.log("  No baseline found - first iteration. Skipping judge comparison.");
    return { success: true, judge_results: [], error: null };
  }
  console.log(`  Baseline: ${repoRelative(baselineDir)}`);
  console.log(`  Candidate: ${repoRelative(runsDir)}`);

  const overrides = options.judge;
  const described = describeAgent(ctx, "judge", overrides);
  const call = async (prompt: string, files: string[]) => {
    const invocation = await invokeAgent(ctx, "judge", { prompt, files, disableTools: true, overrides });
    return { text: invocation.text, agent: invocation.agent };
  };

  const judgeResults: JudgeResultEntry[] = [];
  const unavailable: string[] = [];
  for (const scenarioFile of scenarioFiles) {
    let scenarioId = path.basename(scenarioFile, ".json");
    try {
      const scenario = loadScenario(scenarioFile);
      scenarioId = scenario.id;
      const scenarioName = scenario.name ?? scenarioId;
      const baselineBundle = findBundle(baselineDir, scenarioId, scenarioName);
      const candidateBundle = findBundle(runsDir, scenarioId, scenarioName);
      if (baselineBundle === null || candidateBundle === null) {
        console.log(`  x Failed ${scenarioId}: bundle not found`);
        unavailable.push(scenarioId);
        judgeResults.push({ scenario_id: scenarioId, verdict: "TIE", judge_unavailable: true, error: "Bundle not found" });
        continue;
      }

      const result = await judgePanel(scenario, { path: baselineBundle }, { path: candidateBundle }, {
        call,
        harness: described.harness,
        model: described.model,
        variant: described.variant,
        protocol: ctx.config.judgePanel.pairwiseProtocol,
        promptsDir: fromRepoRoot("optimization", "prompts", "judges"),
        seeds: ctx.config.judgePanel.seeds,
        flipSalt: iteration,
      });
      writeJudgeVerdicts(result, path.join(candidateBundle, "judge-verdicts.json"));
      if (result.judge_unavailable) unavailable.push(scenarioId);
      judgeResults.push({
        scenario_id: scenarioId,
        verdict: result.verdict,
        majority_count: result.majority_count,
        judge_unavailable: result.judge_unavailable,
      });
      console.log(`  ${result.judge_unavailable ? "x" : "+"} ${scenarioId}: ${result.verdict} (majority: ${result.majority_count}/${ctx.config.judgePanel.seeds.length})`);
    } catch (exc: any) {
      console.error(`  x Failed to judge ${path.basename(scenarioFile)}: ${exc.message}`);
      unavailable.push(scenarioId);
      judgeResults.push({ scenario_id: scenarioId, verdict: "TIE", judge_unavailable: true, error: String(exc.message) });
    }
  }

  if (unavailable.length) {
    const unique = [...new Set(unavailable)].sort();
    return { success: false, judge_results: judgeResults, error: `Judge unavailable for ${unique.length} scenario(s): ${unique.join(", ")}` };
  }
  return { success: true, judge_results: judgeResults, error: null };
}

/** First available bundle metadata.json under a runs dir (environment fingerprint). */
function bundleEnvironment(runsDir: string | null): Record<string, any> | null {
  if (!runsDir || !fs.existsSync(runsDir)) return null;
  for (const name of listDirs(runsDir)) {
    const metaPath = path.join(runsDir, name, "metadata.json");
    if (fs.existsSync(metaPath)) return readJson(metaPath);
  }
  return null;
}

function runDecisionStep(
  options: LoopOptions,
  iteration: string,
  runsDir: string,
  judgeResults: JudgeResultEntry[],
): StepResult {
  console.log(`\n=== Iteration ${iteration}: Decision Engine ===`);
  const checkResults: CheckResultEntry[] = [];
  const scenarioMeta: ScenarioMetaEntry[] = [];

  for (const scenarioFile of scenarioFilesFor(options.skill)) {
    const scenario = loadScenario(scenarioFile);
    const bundle = findBundle(runsDir, scenario.id, scenario.name ?? scenario.id);
    if (bundle === null) continue;
    const checksFile = path.join(bundle, "programmatic-checks.json");
    if (fs.existsSync(checksFile)) {
      const checks = readJson(checksFile).checks ?? [];
      checkResults.push({
        scenario_id: scenario.id,
        checks,
        all_passed: checks.every((c: any) => c.result === "pass"),
      });
    }
    scenarioMeta.push({
      scenario_id: scenario.id,
      skill: options.skill,
      current_hash: sha256Text(canonicalStringify(scenario)),
      regression_critical: scenario.regression_critical ?? false,
    });
  }

  const resultsDir = fromRepoRoot("optimization", "results", options.skill, iteration);
  const tempDir = path.join(resultsDir, "temp");
  writeJsonPlain(path.join(tempDir, "check-results.json"), checkResults);
  writeJsonPlain(path.join(tempDir, "judge-results.json"), judgeResults);
  writeJsonPlain(path.join(tempDir, "scenario-meta.json"), scenarioMeta);

  const baselines = loadBaselines(fromRepoRoot("optimization", "results", "baselines.json"));
  const decision = decide(checkResults, judgeResults, scenarioMeta, baselines);

  // Attribute environment drift (browser, GPU, codegen model) explicitly so a
  // degradation caused outside the skill content is visible in the record.
  const envMismatch = environmentMismatch(
    bundleEnvironment(getBaselineDir(options.skill, iteration)),
    bundleEnvironment(runsDir),
  );
  if (Object.keys(envMismatch).length) {
    decision.environment_mismatch = envMismatch;
    console.warn(`  ! Environment mismatch vs baseline: ${Object.keys(envMismatch).join(", ")}`);
    console.warn("    Observed differences may stem from causes outside the skill content.");
  }
  writeJsonPlain(path.join(resultsDir, "decision.json"), decision);

  console.log(`  Decision: ${decision.decision}`);
  console.log(`  Rule: ${decision.rule_fired}`);
  console.log(`  Rationale: ${decision.rationale}`);
  return { success: true, decision: decision.decision, decision_data: decision, error: null };
}

function runReportStep(ctx: EvalContext, options: LoopOptions, iteration: string): StepResult {
  console.log(`\n=== Iteration ${iteration}: Report Generator ===`);
  const resultsDir = fromRepoRoot("optimization", "results", options.skill, iteration);
  const tempDir = path.join(resultsDir, "temp");
  try {
    const decisionResult = readJson(path.join(resultsDir, "decision.json"));
    const checkResults = readJson(path.join(tempDir, "check-results.json"));
    const judgeResults = readJson(path.join(tempDir, "judge-results.json"));
    const scenarios = scenarioFilesFor(options.skill).map(readJson);
    const scores = computeScores(checkResults, judgeResults);

    const summaryPath = path.join(resultsDir, "summary.md");
    fs.writeFileSync(
      summaryPath,
      generateSummaryMarkdown(options.skill, iteration, decisionResult, checkResults, judgeResults, scenarios, scores),
    );
    if (scanPublicArtifacts(ctx.repoRoot, [summaryPath]).length) {
      fs.rmSync(summaryPath, { force: true });
      return { success: false, error: "summary.md failed public-artifacts validation" };
    }

    const publicStatusPath = fromRepoRoot("optimization", "results", "public-status.json");
    updatePublicStatus(options.skill, iteration, decisionResult, scores, scenarios, publicStatusPath);
    if (scanPublicArtifacts(ctx.repoRoot, [publicStatusPath]).length) {
      return { success: false, error: "public-status.json failed public-artifacts validation" };
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: true, error: null };
  } catch (exc: any) {
    return { success: false, error: `Report generator failed: ${exc.message}` };
  }
}

function archiveIteration(skill: string, iteration: string, decision: string): void {
  console.log(`\n=== Archiving iteration ${iteration} ===`);
  const historyDir = fromRepoRoot("optimization", "history", skill, `iteration-${iteration}`);
  fs.mkdirSync(historyDir, { recursive: true });

  const resultsDir = fromRepoRoot("optimization", "results", skill, iteration);
  for (const file of ["decision.json", "summary.md", "journal.jsonl"]) {
    const src = path.join(resultsDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(historyDir, file));
  }

  writeJsonPlain(path.join(historyDir, "metadata.json"), {
    iteration,
    decision,
    timestamp_utc: new Date().toISOString(),
    runs_dir: `optimization/runs/${skill}/${iteration}`,
    candidate_dir: `optimization/candidates/${skill}/${iteration}`,
    generated_dir: `optimization/generated/${skill}/${iteration}`,
    journal: `optimization/history/${skill}/iteration-${iteration}/journal.jsonl`,
  });
  console.log(`  Archived to ${repoRelative(historyDir)}`);
}

/** Apply a KEEP candidate to the canonical skill file (with a backup). Only
 * called behind the human promotion gate (`--promote` or `optimize promote`). */
export function updateCurrentBest(skill: string, iteration: string): void {
  const candidatePath = fromRepoRoot("optimization", "candidates", skill, iteration, "SKILL.md");
  const currentBestPath = fromRepoRoot("skills", skill, "SKILL.md");
  if (!fs.existsSync(candidatePath)) {
    console.error(`  Warning: Candidate skill file not found: ${candidatePath}`);
    return;
  }
  const backupDir = fromRepoRoot("optimization", "history", skill, `iteration-${iteration}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "current-best-before.md");
  fs.copyFileSync(currentBestPath, backupPath);
  fs.copyFileSync(candidatePath, currentBestPath);
  console.log(`  Updated current best: ${repoRelative(currentBestPath)}`);
  console.log(`  Backup saved: ${repoRelative(backupPath)}`);
}

/** Stage a KEEP candidate for human review instead of applying it. */
export function stagePromotion(skill: string, iteration: string): string {
  const candidatePath = fromRepoRoot("optimization", "candidates", skill, iteration, "SKILL.md");
  const pendingPath = fromRepoRoot("optimization", "candidates", skill, iteration, "PROMOTED-PENDING.md");
  fs.copyFileSync(candidatePath, pendingPath);
  return pendingPath;
}

// ---------------------------------------------------------------------------
// baseline bootstrap + main loop
// ---------------------------------------------------------------------------
async function ensureCurrentBestBaseline(ctx: EvalContext, options: LoopOptions, currentBest: string): Promise<StepResult> {
  console.log("\n=== Current Best Baseline ===");
  const skill = options.skill;
  const baselineRunsDir = fromRepoRoot("optimization", "runs", skill, "baseline");
  const expectedCount = expectedBundleCount(skill);
  const journalPath = fromRepoRoot("optimization", "results", skill, "baseline", "journal.jsonl");

  writeJournalEvent(journalPath, "baseline_check_started", {
    skill,
    iteration: "baseline",
    current_best: currentBest,
    expected_bundle_count: expectedCount,
  });

  if (evidenceDirComplete(baselineRunsDir, expectedCount)) {
    console.log(`  Existing baseline evidence is complete: ${repoRelative(baselineRunsDir)}`);
    writeJournalEvent(journalPath, "baseline_check_completed", { skill, iteration: "baseline", runs_dir: baselineRunsDir, reused: true });
    return { success: true, runs_dir: baselineRunsDir, reused: true, error: null };
  }

  console.log("  Baseline evidence missing or incomplete; generating current-best baseline.");
  writeJournalEvent(journalPath, "baseline_generation_started", { skill, iteration: "baseline", current_best: currentBest });
  const adapterResult = await runCodegenStep(ctx, options, "baseline", currentBest);
  if (!adapterResult.success) {
    writeJournalEvent(journalPath, "baseline_generation_failed", { skill, iteration: "baseline", result: adapterResult });
    writeJournalEvent(journalPath, "baseline_check_failed", {
      skill,
      iteration: "baseline",
      step: "baseline_generation",
      result: adapterResult,
    });
    return { success: false, runs_dir: null, reused: false, error: adapterResult.error };
  }
  writeJournalEvent(journalPath, "baseline_generation_completed", { skill, iteration: "baseline", result: adapterResult });

  writeJournalEvent(journalPath, "baseline_browser_eval_started", { skill, iteration: "baseline" });
  const runnerResult = await runRenderStep(ctx, options, "baseline");
  if (!runnerResult.success) {
    writeJournalEvent(journalPath, "baseline_browser_eval_failed", { skill, iteration: "baseline", result: runnerResult });
    writeJournalEvent(journalPath, "baseline_check_failed", {
      skill,
      iteration: "baseline",
      step: "baseline_browser_eval",
      result: runnerResult,
    });
    return { success: false, runs_dir: null, reused: false, error: runnerResult.error };
  }
  writeJournalEvent(journalPath, "baseline_browser_eval_completed", { skill, iteration: "baseline", result: runnerResult });
  writeJournalEvent(journalPath, "baseline_check_completed", {
    skill,
    iteration: "baseline",
    runs_dir: runnerResult.runs_dir,
    reused: false,
  });
  return { success: true, runs_dir: runnerResult.runs_dir, reused: false, error: null };
}

export async function loopCommand(ctx: EvalContext, options: LoopOptions): Promise<number> {
  const skill = options.skill;
  const maxIterations = options.maxIterations ?? 10;
  const stopOn = options.stopOn ?? "max";
  const plateauN = options.plateauN ?? 3;

  let stopRequested = false;
  const onSigint = () => {
    console.error("\n[!] SIGINT received. Stopping after current step...");
    stopRequested = true;
  };
  process.on("SIGINT", onSigint);

  try {
    console.log("=== Autonomous Evaluation Loop ===");
    console.log(`Skill: ${skill}`);
    console.log(`Max iterations: ${maxIterations}`);
    console.log(`Stop condition: ${stopOn}`);
    if (stopOn === "plateau") console.log(`Plateau threshold: ${plateauN} consecutive ties`);
    console.log("");

    const currentBest = fromRepoRoot("skills", skill, "SKILL.md");
    if (!fs.existsSync(currentBest)) {
      console.error(`Error: Skill file not found: ${currentBest}`);
      return 1;
    }
    console.log(`Current best skill: ${repoRelative(currentBest)}`);

    const baselineResult = await ensureCurrentBestBaseline(ctx, options, currentBest);
    if (!baselineResult.success) {
      console.error(`Error: ${baselineResult.error}`);
      return 1;
    }

    let iterationsRun = 0;
    let consecutiveTies = 0;
    let lastDecision: string | null = null;
    let promotionStagedStop: string | null = null;

    const shouldStop = (): string | null => {
      if (stopRequested) return "SIGINT received";
      if (promotionStagedStop) return promotionStagedStop;
      if (iterationsRun >= maxIterations) return `Reached max iterations (${maxIterations})`;
      if (stopOn === "regression" && lastDecision === "REJECT") return "First REJECT encountered (stop-on=regression)";
      if (stopOn === "plateau" && consecutiveTies >= plateauN) return `Plateau detected: ${plateauN} consecutive ties`;
      return null;
    };

    for (;;) {
      const reason = shouldStop();
      if (reason) {
        console.log(`\n=== Loop stopped: ${reason} ===`);
        break;
      }

      const iteration = nextIteration(skill);
      console.log(`\n${"=".repeat(60)}`);
      console.log(`=== Starting iteration ${iteration} ===`);
      console.log("=".repeat(60));

      const journalPath = fromRepoRoot("optimization", "results", skill, iteration, "journal.jsonl");
      writeJournalEvent(journalPath, "iteration_started", {
        skill,
        iteration,
        current_best: currentBest,
        max_iterations: maxIterations,
        stop_on: stopOn,
      });

      let candidatePath = "";
      let runsDir = "";
      let judgeResults: JudgeResultEntry[] = [];
      let decisionData: Record<string, any> | null = null;

      const steps: Array<{ id: string; run: () => Promise<StepResult> | StepResult }> = [
        {
          id: "proposer",
          run: async () => {
            const result = await runProposerStep(ctx, options, iteration);
            if (result.success) candidatePath = String(result.candidate_path);
            return result;
          },
        },
        { id: "skills_adapter", run: () => runCodegenStep(ctx, options, iteration, candidatePath) },
        {
          id: "browser_runner",
          run: async () => {
            const result = await runRenderStep(ctx, options, iteration);
            if (result.success) runsDir = String(result.runs_dir);
            return result;
          },
        },
        {
          id: "judges",
          run: async () => {
            const result = await runJudgesStep(ctx, options, iteration, runsDir);
            if (result.success) judgeResults = result.judge_results as JudgeResultEntry[];
            return result;
          },
        },
        {
          id: "decision",
          run: () => {
            const result = runDecisionStep(options, iteration, runsDir, judgeResults);
            if (result.success) decisionData = result.decision_data as Record<string, any>;
            return result;
          },
        },
        { id: "report", run: () => runReportStep(ctx, options, iteration) },
      ];

      let failed = false;
      for (const step of steps) {
        if (stopRequested) break;
        writeJournalEvent(journalPath, "step_started", { skill, iteration, step: step.id });
        const result = await step.run();
        if (!result.success) {
          writeJournalEvent(journalPath, "step_failed", { skill, iteration, step: step.id, result });
          writeJournalEvent(journalPath, "iteration_failed", { skill, iteration, step: step.id, result });
          archiveIteration(skill, iteration, "FAILED");
          console.error(`Error: ${result.error}`);
          failed = true;
          break;
        }
        writeJournalEvent(journalPath, "step_completed", { skill, iteration, step: step.id, result });
      }
      if (failed) return 1;
      if (stopRequested) continue;

      const decision = String((decisionData as Record<string, any> | null)?.decision ?? "TIE");

      writeJournalEvent(journalPath, "step_started", { skill, iteration, step: "archive" });
      archiveIteration(skill, iteration, decision);
      writeJournalEvent(journalPath, "step_completed", { skill, iteration, step: "archive" });

      if (decision === "KEEP") {
        if (options.promote) {
          writeJournalEvent(journalPath, "step_started", { skill, iteration, step: "promote_current_best" });
          updateCurrentBest(skill, iteration);
          writeJournalEvent(journalPath, "step_completed", { skill, iteration, step: "promote_current_best" });
        } else {
          const stagedPath = stagePromotion(skill, iteration);
          writeJournalEvent(journalPath, "promotion_staged", { skill, iteration, staged_path: stagedPath });
          console.log("\n=== KEEP staged for human review (run with --promote to apply automatically) ===");
          console.log(`  Staged candidate: ${repoRelative(stagedPath)}`);
          console.log(`  Apply with: cesium-eval optimize promote ${skill} ${iteration}`);
          promotionStagedStop = `KEEP staged for human promotion (iteration ${iteration})`;
        }
        consecutiveTies = 0;
      } else if (decision === "REJECT") {
        consecutiveTies = 0;
      } else {
        consecutiveTies += 1;
      }

      lastDecision = decision;
      iterationsRun += 1;

      writeJournalEvent(journalPath, "iteration_completed", { skill, iteration, decision, consecutive_ties: consecutiveTies });
      const archivedJournal = fromRepoRoot("optimization", "history", skill, `iteration-${iteration}`, "journal.jsonl");
      if (fs.existsSync(path.dirname(archivedJournal))) fs.copyFileSync(journalPath, archivedJournal);

      console.log(`\n=== Iteration ${iteration} complete: ${decision} ===`);
      console.log(`Consecutive ties: ${consecutiveTies}`);
    }

    console.log("\n=== Loop completed ===");
    console.log(`Total iterations: ${iterationsRun}`);
    console.log(`Final decision: ${lastDecision}`);
    return 0;
  } finally {
    process.off("SIGINT", onSigint);
  }
}
