/**
 * Report generator: per-iteration summary.md plus the sanitized
 * public-status.json rollup, validated by the public-safety scanner.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, repoRelative } from "../lib/paths.js";
import { pct } from "../lib/format.js";
import { round } from "../lib/format.js";
import { scanPublicArtifacts } from "./publicArtifacts.js";

export interface Scores {
  programmatic_correctness: number;
  api_accuracy: number;
  visual_win_rate: number;
  coverage_delta: number;
}

export function computeScores(
  checkResults: Array<Record<string, any>>,
  judgeResults: Array<Record<string, any>>,
): Scores {
  const passingScenarios = checkResults.filter(
    (result) => (result.checks ?? []).length && (result.checks ?? []).every((c: any) => c.result === "pass"),
  ).length;
  const programmaticCorrectness = checkResults.length ? passingScenarios / checkResults.length : 0;

  let apiCheckScenarios = 0;
  let apiPassingScenarios = 0;
  for (const result of checkResults) {
    const apiChecks = (result.checks ?? []).filter((c: any) => c.type === "api_present");
    if (apiChecks.length) {
      apiCheckScenarios += 1;
      if (apiChecks.every((c: any) => c.result === "pass")) apiPassingScenarios += 1;
    }
  }
  const apiAccuracy = apiCheckScenarios > 0 ? apiPassingScenarios / apiCheckScenarios : 1.0;

  const judged = judgeResults.filter((j) => !j.judge_unavailable);
  const wins = judged.filter((j) => j.verdict === "CANDIDATE").length;
  const visualWinRate = judged.length ? wins / judged.length : 0;

  return {
    programmatic_correctness: round(programmaticCorrectness, 4),
    api_accuracy: round(apiAccuracy, 4),
    visual_win_rate: round(visualWinRate, 4),
    coverage_delta: 0.0,
  };
}

function formatCheckResult(check: Record<string, any>): string {
  const symbol = check.result === "pass" ? "✓" : "✗";
  return `${symbol} ${check.type ?? "unknown"}: ${check.description ?? ""}`;
}

export function generateSummaryMarkdown(
  skill: string,
  iteration: string,
  decisionResult: Record<string, any>,
  checkResults: Array<Record<string, any>>,
  judgeResults: Array<Record<string, any>>,
  scenarios: Array<Record<string, any>>,
  scores: Scores,
): string {
  const lines = [
    `# Evaluation Report: ${skill} - Iteration ${iteration}`,
    "",
    `**Generated:** ${new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}`,
    "",
    "## Decision",
    "",
    `- **Result:** ${decisionResult.decision}`,
    `- **Rule:** ${decisionResult.rule_fired}`,
    `- **Rationale:** ${decisionResult.rationale}`,
    "",
    "## Score Summary",
    "",
    `- **Programmatic Correctness:** ${pct(scores.programmatic_correctness)}`,
    `- **API Accuracy:** ${pct(scores.api_accuracy)}`,
    `- **Visual Win Rate:** ${pct(scores.visual_win_rate)}`,
    `- **Coverage Delta:** ${pct(scores.coverage_delta)} (reserved)`,
    "",
    "## Win/Loss/Tie Counts",
    "",
    `- Wins: ${decisionResult.counts.wins}`,
    `- Losses: ${decisionResult.counts.losses}`,
    `- Ties: ${decisionResult.counts.ties}`,
    "",
  ];

  if (decisionResult.rebaseline_required?.length) {
    lines.push("## Rebaseline Required", "", "The following scenarios have changed and need re-baseline:", "");
    for (const scenarioId of decisionResult.rebaseline_required) lines.push(`- ${scenarioId}`);
    lines.push("");
  }

  lines.push("## Per-Scenario Results", "");

  const checkMap = new Map(checkResults.map((r) => [r.scenario_id, r]));
  const judgeMap = new Map(judgeResults.map((r) => [r.scenario_id, r]));

  for (const scenario of scenarios) {
    const scenarioId = scenario.id;
    const scenarioName = scenario.name ?? scenarioId;
    lines.push(`### ${scenarioId}: ${scenarioName}`, "");

    const checkResult = checkMap.get(scenarioId);
    if (checkResult) {
      lines.push("**Programmatic Checks:**", "");
      for (const check of checkResult.checks ?? []) lines.push(`- ${formatCheckResult(check)}`);
      lines.push("");
    }

    const judgeResult = judgeMap.get(scenarioId);
    if (judgeResult) {
      if (judgeResult.judge_unavailable) lines.push("**Judge Verdict:** Unavailable");
      else lines.push(`**Judge Verdict:** ${judgeResult.verdict ?? "UNKNOWN"} (${judgeResult.majority_count ?? 0}/3 judges)`);
      lines.push("");
    }

    const runDir = `optimization/runs/${skill}/${iteration}/${scenarioId}-${scenarioName}`;
    lines.push(
      "**Evidence:**",
      "",
      `- Screenshot(s): \`${runDir}/screenshot*.png\``,
      `- Console log: \`${runDir}/console.json\``,
      `- Metadata: \`${runDir}/metadata.json\``,
      "",
      "---",
      "",
    );
  }
  return lines.join("\n");
}

export function updatePublicStatus(
  skill: string,
  iteration: string,
  decisionResult: Record<string, any>,
  scores: Scores,
  scenarios: Array<Record<string, any>>,
  publicStatusPath: string,
): void {
  const publicStatus = fs.existsSync(publicStatusPath)
    ? readJson(publicStatusPath)
    : { schema_version: "1.0", summary_type: "public-sanitized-eval-status", skills: [] };

  let skillEntry = publicStatus.skills.find((entry: any) => entry.skill === skill);
  if (!skillEntry) {
    skillEntry = { skill, scenario_count: scenarios.length, current_best: {}, latest_reviewed_decision: {}, runner_mode_counts: {} };
    publicStatus.skills.push(skillEntry);
  }

  skillEntry.scenario_count = scenarios.length;
  const counts = decisionResult.counts;
  const decisionStatus =
    decisionResult.decision === "KEEP" ? "keep" : decisionResult.decision === "REJECT" ? "reject" : "tie";
  skillEntry.latest_reviewed_decision = {
    iteration,
    status: decisionStatus,
    compared_to: "baseline",
    methodology: "3-parallel-independent-judges, majority vote per eval",
    tally: { wins: counts.wins, losses: counts.losses, ties: counts.ties },
    critical_regressions: [],
    rationale_summary: decisionResult.rationale,
  };

  if (decisionResult.decision === "KEEP") {
    skillEntry.current_best = {
      iteration,
      wins: counts.wins,
      losses: counts.losses,
      ties: counts.ties,
      programmatic_correctness: scores.programmatic_correctness,
      api_accuracy: scores.api_accuracy,
      visual_win_rate: scores.visual_win_rate,
      methodology: "3-parallel-independent-judges",
      timestamp: new Date().toISOString(),
    };
  } else if (decisionResult.decision === "REJECT" && skillEntry.current_best?.iteration === iteration) {
    // A rejected regeneration must not leave a stale current_best pointer.
    skillEntry.current_best = {};
  }

  const runnerModes: Record<string, number> = {};
  for (const scenario of scenarios) {
    const mode = scenario.runner_mode ?? "global-js";
    runnerModes[mode] = (runnerModes[mode] ?? 0) + 1;
  }
  skillEntry.runner_mode_counts = runnerModes;

  writeJsonPlain(publicStatusPath, publicStatus);
}

function validatePublicSafety(repoRoot: string, filePath: string): boolean {
  return scanPublicArtifacts(repoRoot, [filePath]).length === 0;
}

export interface ReportOptions {
  skill: string;
  iteration: string;
  decision: string;
  checkResults: string;
  judgeResults: string;
  scenarios: string;
  publicStatus?: string;
  outputDir?: string;
}

export async function reportCommand(repoRoot: string, options: ReportOptions): Promise<number> {
  for (const [label, target] of [
    ["Decision file", options.decision],
    ["Check results file", options.checkResults],
    ["Judge results file", options.judgeResults],
    ["Scenarios directory", options.scenarios],
  ] as const) {
    if (!fs.existsSync(fromRepoRoot(target))) {
      console.error(`Error: ${label} not found: ${target}`);
      return 2;
    }
  }

  const decisionResult = readJson(fromRepoRoot(options.decision));
  const checkResults = readJson(fromRepoRoot(options.checkResults));
  const judgeResults = readJson(fromRepoRoot(options.judgeResults));
  const scenarios = globFiles(fromRepoRoot(options.scenarios), "", ".json").map(readJson);

  const scores = computeScores(checkResults, judgeResults);
  const outputDir = options.outputDir
    ? fromRepoRoot(options.outputDir)
    : fromRepoRoot("optimization", "results", options.skill, options.iteration);
  const summaryPath = path.join(outputDir, "summary.md");

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    summaryPath,
    generateSummaryMarkdown(options.skill, options.iteration, decisionResult, checkResults, judgeResults, scenarios, scores),
  );
  console.log(`Generated summary report: ${repoRelative(summaryPath)}`);

  if (!validatePublicSafety(repoRoot, summaryPath)) {
    console.error(`Error: Summary file failed public-artifacts validation: ${summaryPath}`);
    fs.rmSync(summaryPath, { force: true });
    return 1;
  }

  const publicStatusPath = options.publicStatus
    ? fromRepoRoot(options.publicStatus)
    : fromRepoRoot("optimization", "results", "public-status.json");
  updatePublicStatus(options.skill, options.iteration, decisionResult, scores, scenarios, publicStatusPath);
  console.log(`Updated public status: ${repoRelative(publicStatusPath)}`);

  if (!validatePublicSafety(repoRoot, publicStatusPath)) {
    console.error(`Error: Public status file failed public-artifacts validation: ${publicStatusPath}`);
    return 1;
  }

  console.log("\nScores:");
  console.log(`  Programmatic Correctness: ${pct(scores.programmatic_correctness)}`);
  console.log(`  API Accuracy: ${pct(scores.api_accuracy)}`);
  console.log(`  Visual Win Rate: ${pct(scores.visual_win_rate)}`);
  console.log(`  Coverage Delta: ${pct(scores.coverage_delta)}`);
  return 0;
}
