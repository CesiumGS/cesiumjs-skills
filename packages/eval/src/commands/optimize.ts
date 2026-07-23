/**
 * `cesium-eval optimize ...` — subcommands for the self-optimization loop:
 * all (multi-skill loop driver), decide, focus, rejudge, rebaseline,
 * coverage, and generate-baselines.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalStringify, readJson, writeJsonPlain, writeJsonSorted, stableStringify } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs, repoRelative } from "../lib/paths.js";
import { sha256Text } from "../lib/proc.js";
import { decide, loadBaselines } from "../optimization/decisionEngine.js";
import { buildFocus, focusToDecision, focusToMarkdown } from "../optimization/scorecardFocus.js";
import { judgePanel, writeJudgeVerdicts } from "../optimization/pairwiseJudge.js";
import { generateScenarioCode } from "../optimization/skillsAdapter.js";
import type { CheckResultEntry, JudgeResultEntry, ScenarioMetaEntry } from "../optimization/types.js";
import { AgentSelection, LoopOptions, loopCommand, updateCurrentBest } from "../optimization/loop.js";
import { describeAgent, invokeAgent } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";

// The CLI layer (src/cli/main.ts) imports every optimize command from this
// module; domain modules that still host their own command adapters are
// re-exported here so the wiring surface stays consistent.
export { loopCommand } from "../optimization/loop.js";
export { proposeCommand } from "../optimization/proposer.js";
export { renderCommand } from "../optimization/browserRunner.js";
export { reportCommand } from "../optimization/report.js";

const scenariosRoot = () => fromRepoRoot("optimization", "scenarios");
const resultsRoot = () => fromRepoRoot("optimization", "results");

// ---------------------------------------------------------------------------
// optimize promote — the human promotion gate
// ---------------------------------------------------------------------------
export async function promoteCommand(options: { skill: string; iteration: string; via?: string }): Promise<number> {
  const candidateDir = fromRepoRoot("optimization", "candidates", options.skill, options.iteration);
  const candidatePath = path.join(candidateDir, "SKILL.md");
  if (!fs.existsSync(candidatePath)) {
    console.error(`Error: candidate skill not found: ${repoRelative(candidatePath)}`);
    return 1;
  }
  const currentBestPath = fromRepoRoot("skills", options.skill, "SKILL.md");
  if (!fs.existsSync(currentBestPath)) {
    console.error(`Error: current skill file not found: ${repoRelative(currentBestPath)}`);
    return 1;
  }
  updateCurrentBest(options.skill, options.iteration);
  fs.rmSync(path.join(candidateDir, "PROMOTED-PENDING.md"), { force: true });
  // Persist the explicit human approval alongside the backup.
  writeJsonPlain(fromRepoRoot("optimization", "history", options.skill, `iteration-${options.iteration}`, "promotion.json"), {
    skill: options.skill,
    iteration: options.iteration,
    promoted_utc: new Date().toISOString(),
    via: options.via ?? "cli",
  });
  console.log(`[promote] applied ${repoRelative(candidatePath)} -> ${repoRelative(currentBestPath)}`);
  return 0;
}

export function discoverSkills(): string[] {
  return listDirs(scenariosRoot()).filter((name) => globFiles(path.join(scenariosRoot(), name), "eval-", ".json").length > 0);
}

function selectedSkills(value: string | undefined): string[] {
  if (!value || value === "all") return discoverSkills();
  const skills = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const known = new Set(discoverSkills());
  const unknown = skills.filter((skill) => !known.has(skill)).sort();
  if (unknown.length) throw new Error(`Unknown skill(s): ${unknown.join(", ")}`);
  return skills;
}

// ---------------------------------------------------------------------------
// optimize all — loop across every selected skill, optionally scorecard-seeded
// ---------------------------------------------------------------------------
export interface OptimizeAllOptions extends Omit<LoopOptions, "skill"> {
  skills?: string;
  fromScorecard?: string;
  fromFocus?: string;
  continueOnFailure?: boolean;
  dryRun?: boolean;
}

function recommendedSkills(focus: Record<string, any>): string[] {
  let skills: string[] = (focus.skills ?? []).map((item: any) => String(item.skill)).filter(Boolean);
  if (!skills.length) skills = (focus.cases ?? []).map((item: any) => String(item.skill)).filter(Boolean);
  const known = new Set(discoverSkills());
  return [...new Set(skills)].filter((skill) => known.has(skill));
}

function focusDecisionDir(focus: Record<string, any>): string {
  const runId = String(focus.source_run_id || "unknown-scorecard");
  const safe = runId.replace(/[^A-Za-z0-9\-_]/g, "-");
  return fromRepoRoot("optimization", "tmp", "scorecard-focus", safe);
}

export async function optimizeAllCommand(ctx: EvalContext, options: OptimizeAllOptions): Promise<number> {
  let focus: Record<string, any> | null = null;
  if (options.fromScorecard) focus = buildFocus(readJson(fromRepoRoot(options.fromScorecard)));
  else if (options.fromFocus) focus = readJson(fromRepoRoot(options.fromFocus));

  const skills = options.skills ? selectedSkills(options.skills) : focus !== null ? recommendedSkills(focus) : selectedSkills(undefined);
  if (!skills.length) {
    if (focus !== null) {
      console.log("[optimize all] No optimization recommended by the scorecard focus.");
      return 0;
    }
    console.error("No eval scenario groups found");
    return 1;
  }

  const focusDecisions = new Map<string, string>();
  if (focus !== null) {
    const outDir = focusDecisionDir(focus);
    fs.mkdirSync(outDir, { recursive: true });
    console.log("[optimize all] Scorecard focus selected skills:");
    for (const skill of skills) {
      const decisionPath = path.join(outDir, `${skill}-decision.json`);
      writeJsonSorted(decisionPath, focusToDecision(focus, skill));
      focusDecisions.set(skill, decisionPath);
      console.log(`  ${skill}: ${repoRelative(decisionPath)}`);
    }
  }

  const failures: Array<[string, number]> = [];
  for (const [index, skill] of skills.entries()) {
    console.log(`\n=== [${index + 1}/${skills.length}] ${skill} ===`);
    if (options.dryRun) {
      console.log(`(dry-run) cesium-eval optimize loop ${skill}`);
      continue;
    }
    const code = await loopCommand(ctx, {
      ...options,
      skill,
      proposerDecisionPath: focusDecisions.get(skill),
    });
    if (code !== 0) {
      failures.push([skill, code]);
      if (!options.continueOnFailure) break;
    }
  }

  if (failures.length) {
    console.error("\n[optimize all] FAIL:");
    for (const [skill, code] of failures) console.error(`  ${skill}: loop exited ${code}`);
    return 1;
  }
  console.log("\n[optimize all] OK");
  return 0;
}

// ---------------------------------------------------------------------------
// optimize decide — decision engine over aggregated inputs
// ---------------------------------------------------------------------------
export interface DecideOptions {
  skill: string;
  iteration: string;
  checkResults: string;
  judgeResults: string;
  scenarioMeta: string;
  baselines?: string;
  output?: string;
  override?: string;
  overrideDecision?: "KEEP" | "REJECT";
}

export async function decideCommand(options: DecideOptions): Promise<number> {
  if (options.override && !options.overrideDecision) {
    console.error("ERROR: --override-decision is required when using --override");
    return 1;
  }
  if (options.overrideDecision && !options.override) {
    console.error("ERROR: --override is required when using --override-decision");
    return 1;
  }

  let decisionResult;
  if (options.override) {
    decisionResult = {
      decision: options.overrideDecision!,
      rule_fired: "manual_override",
      counts: { wins: 0, losses: 0, ties: 0, critical_failures: 0 },
      rationale: `MANUAL OVERRIDE: ${options.override}`,
      rebaseline_required: [],
    };
    console.log(`Using manual override: ${options.overrideDecision}`);
    console.log(`Rationale: ${options.override}`);
  } else {
    const baselines = loadBaselines(fromRepoRoot(options.baselines ?? "optimization/results/baselines.json"));
    decisionResult = decide(
      readJson(fromRepoRoot(options.checkResults)),
      readJson(fromRepoRoot(options.judgeResults)),
      readJson(fromRepoRoot(options.scenarioMeta)),
      baselines,
    );
    console.log(`Decision: ${decisionResult.decision}`);
    console.log(`Rule: ${decisionResult.rule_fired}`);
    console.log(`Rationale: ${decisionResult.rationale}`);
    console.log(`Counts: ${JSON.stringify(decisionResult.counts)}`);
    if (decisionResult.rebaseline_required.length) {
      console.log(`Scenarios requiring re-baseline: ${JSON.stringify(decisionResult.rebaseline_required)}`);
    }
  }

  const outputPath = options.output
    ? fromRepoRoot(options.output)
    : path.join(resultsRoot(), options.skill, options.iteration, "decision.json");
  writeJsonPlain(outputPath, decisionResult);
  console.log(`Decision written to: ${repoRelative(outputPath)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// optimize focus — scorecard -> focus/decision/markdown
// ---------------------------------------------------------------------------
export interface FocusOptions {
  scorecard: string;
  format?: "json" | "markdown" | "decision";
  skill?: string;
  output?: string;
}

export async function focusCommand(options: FocusOptions): Promise<number> {
  const focus = buildFocus(readJson(fromRepoRoot(options.scorecard)));
  let payload: string;
  if (options.format === "markdown") payload = focusToMarkdown(focus);
  else if (options.format === "decision") payload = stableStringify(focusToDecision(focus, options.skill ?? null)) + "\n";
  else payload = stableStringify(focus) + "\n";

  if (options.output) fs.writeFileSync(fromRepoRoot(options.output), payload);
  else process.stdout.write(payload);
  return 0;
}

// ---------------------------------------------------------------------------
// optimize rejudge — re-run judges + decision for an existing iteration
// ---------------------------------------------------------------------------
export interface RejudgeOptions {
  skill: string;
  baselineIter?: string;
  candidateIter?: string;
  judgeHarness?: string;
  judgeModel?: string;
  judgeVariant?: string;
  outputIter?: string;
}

function findCleanBundle(runsDir: string, scenario: Record<string, any>): string | null {
  const expected = path.join(runsDir, `${scenario.id}-${scenario.name}`);
  if (fs.existsSync(expected)) return expected;
  const candidates = listDirs(runsDir)
    .filter((name) => name.startsWith(`${scenario.id}-`))
    .map((name) => path.join(runsDir, name));
  const clean = candidates.find((candidate) => {
    const consolePath = path.join(candidate, "console.json");
    if (!fs.existsSync(consolePath)) return false;
    const data = readJson(consolePath);
    return !(data.console_messages ?? []).some((m: any) => (m.text ?? "").includes("401"));
  });
  return clean ?? candidates[0] ?? null;
}

export async function rejudgeCommand(ctx: EvalContext, options: RejudgeOptions): Promise<number> {
  const baselineIter = options.baselineIter ?? "000";
  const candidateIter = options.candidateIter ?? "001";
  const outputIter = options.outputIter ?? candidateIter;
  const overrides: AgentSelection = { harness: options.judgeHarness, model: options.judgeModel, variant: options.judgeVariant };

  const scenarios = globFiles(path.join(scenariosRoot(), options.skill), "eval-", ".json").map(readJson);
  const baselineRoot = fromRepoRoot("optimization", "runs", options.skill, baselineIter);
  const candidateRoot = fromRepoRoot("optimization", "runs", options.skill, candidateIter);

  const described = describeAgent(ctx, "judge", overrides);
  const call = async (prompt: string, files: string[]) => {
    const invocation = await invokeAgent(ctx, "judge", { prompt, files, disableTools: true, overrides });
    return { text: invocation.text, agent: invocation.agent };
  };

  console.log(
    `== Re-judging ${options.skill}: ${baselineIter} vs ${candidateIter} with ${described.harness} ` +
      `model=${described.model} variant=${described.variant} ==`,
  );

  const judgeResults: JudgeResultEntry[] = [];
  const checkResults: CheckResultEntry[] = [];
  const scenarioMeta: ScenarioMetaEntry[] = [];

  for (const scenario of scenarios) {
    const sid = scenario.id;
    const baselineBundle = findCleanBundle(baselineRoot, scenario);
    const candidateBundle = findCleanBundle(candidateRoot, scenario);
    if (baselineBundle === null || candidateBundle === null) {
      console.log(`  - ${sid}: missing bundle (baseline=${baselineBundle}, candidate=${candidateBundle})`);
      judgeResults.push({ scenario_id: sid, verdict: "TIE", judge_unavailable: true });
      continue;
    }

    console.log(`  judging ${sid} (${path.basename(baselineBundle)} vs ${path.basename(candidateBundle)}) ...`);
    try {
      const result = await judgePanel(scenario, { path: baselineBundle }, { path: candidateBundle }, {
        call,
        harness: described.harness,
        model: described.model,
        variant: described.variant,
        protocol: ctx.config.judgePanel.pairwiseProtocol,
        promptsDir: fromRepoRoot("optimization", "prompts", "judges"),
        seeds: ctx.config.judgePanel.seeds,
        flipSalt: candidateIter,
      });
      writeJudgeVerdicts(result, path.join(candidateBundle, "judge-verdicts.json"));
      console.log(`    -> ${result.verdict} (${result.majority_count}/${ctx.config.judgePanel.seeds.length})`);
      judgeResults.push({
        scenario_id: sid,
        verdict: result.verdict,
        majority_count: result.majority_count,
        judge_unavailable: result.judge_unavailable,
      });
    } catch (exc: any) {
      console.error(`    !! ${sid} judge error: ${exc.message}`);
      judgeResults.push({ scenario_id: sid, verdict: "TIE", judge_unavailable: true, error: String(exc.message) });
    }

    const checks = readJson(path.join(candidateBundle, "programmatic-checks.json")).checks ?? [];
    checkResults.push({ scenario_id: sid, checks, all_passed: checks.every((c: any) => c.result === "pass") });
    // Empty hash: a re-judge trusts whatever the runner produced.
    scenarioMeta.push({ scenario_id: sid, regression_critical: scenario.regression_critical ?? false, skill: options.skill, current_hash: "" });
  }

  const decision = decide(checkResults, judgeResults, scenarioMeta, {});
  const outDir = path.join(resultsRoot(), options.skill, outputIter);
  writeJsonPlain(path.join(outDir, "decision.json"), decision);
  console.log(`\nDecision: ${decision.decision} (${decision.rule_fired})`);
  console.log(`Counts: ${JSON.stringify(decision.counts)}`);
  console.log(`Rationale: ${decision.rationale}`);
  console.log(`\nWrote ${repoRelative(path.join(outDir, "decision.json"))}`);
  return 0;
}

// ---------------------------------------------------------------------------
// optimize rebaseline — record a scenario's current content hash
// ---------------------------------------------------------------------------
export interface RebaselineOptions {
  skill: string;
  evalId: string;
  dryRun?: boolean;
}

export async function rebaselineCommand(options: RebaselineOptions): Promise<number> {
  if (!/^eval-[0-9]{3}$/.test(options.evalId)) {
    console.error(`[optimize rebaseline] ERROR: eval_id must match pattern eval-NNN, got: ${options.evalId}`);
    return 1;
  }
  const skillDir = path.join(scenariosRoot(), options.skill);
  const matches = globFiles(skillDir, `${options.evalId}-`, ".json");
  if (!matches.length) {
    console.error(`[optimize rebaseline] ERROR: no scenario file found for ${options.skill}/${options.evalId}`);
    return 1;
  }
  if (matches.length > 1) {
    console.error(`[optimize rebaseline] ERROR: multiple scenario files found for ${options.skill}/${options.evalId}`);
    return 1;
  }
  const scenarioPath = matches[0];
  console.log(`[optimize rebaseline] Found scenario: ${repoRelative(scenarioPath)}`);

  const currentHash = sha256Text(canonicalStringify(readJson(scenarioPath)));
  console.log(`[optimize rebaseline] Current hash: ${currentHash}`);

  const baselinesPath = path.join(resultsRoot(), "baselines.json");
  const baselines = fs.existsSync(baselinesPath)
    ? readJson(baselinesPath)
    : {
        schema_version: "1.0",
        description: "Content hashes for scenario manifests to detect changes requiring re-baseline",
        scenarios: {},
      };

  baselines.scenarios[options.skill] ??= {};
  const oldHash: string | undefined = baselines.scenarios[options.skill][options.evalId];
  baselines.scenarios[options.skill][options.evalId] = currentHash;

  const describe = () => {
    if (oldHash === currentHash) console.log(`[optimize rebaseline] Baseline unchanged for ${options.skill}/${options.evalId}`);
    else if (oldHash) {
      console.log(`[optimize rebaseline] ${options.dryRun ? "Would update" : "Updated"} baseline for ${options.skill}/${options.evalId}`);
      console.log(`                      Old: ${oldHash.slice(0, 12)}...`);
      console.log(`                      New: ${currentHash.slice(0, 12)}...`);
    } else {
      console.log(`[optimize rebaseline] ${options.dryRun ? "Would record" : "Recorded"} new baseline for ${options.skill}/${options.evalId}`);
    }
  };

  if (options.dryRun) {
    describe();
    console.log("[optimize rebaseline] Dry run; baselines.json was not modified");
    return 0;
  }
  writeJsonPlain(baselinesPath, baselines);
  describe();
  console.log(`[optimize rebaseline] Baselines saved to ${repoRelative(baselinesPath)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// optimize coverage — skill sections/APIs vs scenario coverage
// ---------------------------------------------------------------------------
function parseSkillMarkdown(skillPath: string): { headings: string[]; apis: Set<string> } {
  const headings: string[] = [];
  const apis = new Set<string>();
  if (!fs.existsSync(skillPath)) return { headings, apis };
  const content = fs.readFileSync(skillPath, "utf-8");

  for (const match of content.matchAll(/^#{2,3}\s+(.+)$/gm)) {
    let heading = match[1].trim();
    heading = heading.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1");
    headings.push(heading);
  }

  for (const codeMatch of content.matchAll(/```(?:javascript|js)?\n([\s\S]*?)```/g)) {
    for (const apiMatch of codeMatch[1].matchAll(/\b(?:viewer|Viewer|Cesium|Camera|Scene|Entity|scene|camera)(?:\.[A-Za-z_$][\w$]*)+/g)) {
      apis.add(apiMatch[0]);
    }
  }
  return { headings, apis };
}

export async function coverageCommand(): Promise<number> {
  const skills = discoverSkills();
  const coverage: Record<string, any> = { generated_at: new Date().toISOString(), skills: {} };

  for (const skill of skills) {
    const { headings, apis } = parseSkillMarkdown(fromRepoRoot("skills", skill, "SKILL.md"));
    const scenarios = globFiles(path.join(scenariosRoot(), skill), "eval-", ".json").map(readJson);

    const coveredSections = new Set<string>();
    const coveredApis = new Set<string>();
    for (const scenario of scenarios) {
      for (const section of scenario.target_skill_sections ?? []) coveredSections.add(String(section));
      const text = [scenario.prompt ?? "", ...(scenario.expected_behaviors ?? [])].join(" ");
      for (const api of apis) {
        const name = api.split(".").pop()!;
        if (text.includes(name)) coveredApis.add(api);
      }
    }

    coverage.skills[skill] = {
      section_count: headings.length,
      api_count: apis.size,
      scenario_count: scenarios.length,
      uncovered_sections: headings.filter((heading) => !coveredSections.has(heading)),
      uncovered_apis: [...apis].filter((api) => !coveredApis.has(api)).sort(),
    };
  }

  const outputPath = path.join(resultsRoot(), "coverage.json");
  writeJsonPlain(outputPath, coverage);
  console.log(`[optimize coverage] wrote ${repoRelative(outputPath)} (${skills.length} skills)`);
  return 0;
}

// ---------------------------------------------------------------------------
// optimize generate-baselines — baseline codegen for all scenarios
// ---------------------------------------------------------------------------
export interface GenerateBaselinesOptions {
  skill?: string;
  iteration?: string;
  harness?: string;
  model?: string;
  variant?: string;
  force?: boolean;
  only?: string;
}

export async function generateBaselinesCommand(ctx: EvalContext, options: GenerateBaselinesOptions): Promise<number> {
  const skills = options.skill ? [options.skill] : discoverSkills();
  const iteration = options.iteration ?? "baseline";
  const only = new Set(
    (options.only ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const overrides = { harness: options.harness, model: options.model, variant: options.variant };

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const skill of skills) {
    const skillPath = fromRepoRoot("skills", skill, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      console.error(`[generate-baselines] skip ${skill}: no SKILL.md`);
      continue;
    }
    for (const scenarioFile of globFiles(path.join(scenariosRoot(), skill), "eval-", ".json")) {
      const scenario = readJson(scenarioFile);
      if (only.size && !only.has(scenario.id)) continue;
      const jsPath = fromRepoRoot("optimization", "generated", skill, iteration, `${scenario.id}.js`);
      if (fs.existsSync(jsPath) && !options.force) {
        skipped += 1;
        continue;
      }
      try {
        const { outputPath } = await generateScenarioCode(ctx, { skill, iteration, skillPath, scenario, overrides });
        console.log(`  + ${skill}/${scenario.id}: ${repoRelative(outputPath)}`);
        generated += 1;
      } catch (exc: any) {
        console.error(`  x ${skill}/${scenario.id}: ${exc.message}`);
        failed += 1;
      }
    }
  }
  console.log(`[generate-baselines] generated=${generated} skipped=${skipped} failed=${failed}`);
  return failed ? 1 : 0;
}
