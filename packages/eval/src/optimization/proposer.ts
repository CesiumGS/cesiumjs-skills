/**
 * Proposer: drafts a revised skill from evaluation history and coverage
 * analysis, writing SKILL.md + hypothesis.md + proposer-metadata.json under
 * optimization/candidates/<skill>/<iteration>/.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs, repoRelative } from "../lib/paths.js";
import { sha256Text } from "../lib/proc.js";
import { describeAgent, invokeAgent } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";

interface IterationHistory {
  iteration: string;
  scenarios: Array<{ eval_id: string; verdict: string; rationale: string; checks: Array<Record<string, any>> }>;
}

function loadDecision(decisionPath: string): Record<string, any> {
  if (!fs.existsSync(decisionPath)) {
    return {
      decision: "BASELINE",
      rule_fired: "initial",
      rationale: "No previous evaluations",
      counts: { wins: 0, losses: 0, ties: 0 },
    };
  }
  return readJson(decisionPath);
}

/** Walk runs/<skill>/<iter>/<bundle>/ reading judge verdicts + checks, newest first. */
function loadEvaluationHistory(skill: string, maxIterations: number): IterationHistory[] {
  const runsSkillRoot = fromRepoRoot("optimization", "runs", skill);
  if (!fs.existsSync(runsSkillRoot)) return [];

  const iterationDirs = listDirs(runsSkillRoot)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a));

  const history: IterationHistory[] = [];
  for (const iterationName of iterationDirs.slice(0, maxIterations)) {
    const iterationDir = path.join(runsSkillRoot, iterationName);
    const scenarios: IterationHistory["scenarios"] = [];
    for (const bundleName of listDirs(iterationDir)) {
      const bundleDir = path.join(iterationDir, bundleName);
      const judgePath = path.join(bundleDir, "judge-verdicts.json");
      if (!fs.existsSync(judgePath)) continue;
      let judgeData: any;
      try {
        judgeData = readJson(judgePath);
      } catch {
        continue;
      }
      const rationale =
        (judgeData.individual_verdicts ?? []).find((entry: any) => entry.rationale)?.rationale ?? "";
      let checks: Array<Record<string, any>> = [];
      const checksPath = path.join(bundleDir, "programmatic-checks.json");
      if (fs.existsSync(checksPath)) {
        try {
          checks = readJson(checksPath).checks ?? [];
        } catch {
          checks = [];
        }
      }
      scenarios.push({
        eval_id: judgeData.scenario_id ?? bundleName.split("-", 1)[0],
        verdict: judgeData.verdict ?? "TIE",
        rationale,
        checks,
      });
    }
    if (scenarios.length) history.push({ iteration: iterationName, scenarios });
  }
  return history;
}

function loadCoverage(coveragePath: string, skill: string): { uncovered_sections: string[]; uncovered_apis: string[] } {
  if (!fs.existsSync(coveragePath)) return { uncovered_sections: [], uncovered_apis: [] };
  const coverage = readJson(coveragePath);
  const skillCoverage = coverage.skills?.[skill] ?? {};
  return {
    uncovered_sections: skillCoverage.uncovered_sections ?? [],
    uncovered_apis: skillCoverage.uncovered_apis ?? [],
  };
}

function formatEvaluationHistory(history: IterationHistory[]): string {
  if (!history.length) return "No evaluation history available.";
  const lines: string[] = [];
  for (const iteration of history) {
    lines.push(`### Iteration ${iteration.iteration}\n`);
    for (const scenario of iteration.scenarios) {
      const failedChecks = scenario.checks.filter((check) => check.result === "fail");
      lines.push(`**${scenario.eval_id}** - Verdict: ${scenario.verdict}`);
      lines.push(`Checks: ${failedChecks.length ? "some failures" : "all passing"}`);
      for (const check of failedChecks) {
        lines.push(`  - FAIL: ${check.type} - ${check.detail ?? ""}`);
      }
      lines.push(`Rationale: ${scenario.rationale}`);
      lines.push("");
    }
    lines.push("---\n");
  }
  return lines.join("\n");
}

function formatCoverageGaps(coverage: { uncovered_sections: string[]; uncovered_apis: string[] }): [string, string] {
  const sections = coverage.uncovered_sections;
  const apis = coverage.uncovered_apis;
  let sectionList = sections.slice(0, 20).map((section) => `- ${section}`).join("\n");
  if (sections.length > 20) sectionList += `\n... and ${sections.length - 20} more`;
  let apiList = apis.slice(0, 30).map((api) => `- ${api}`).join("\n");
  if (apis.length > 30) apiList += `\n... and ${apis.length - 30} more`;
  return [sectionList || "None", apiList || "None"];
}

/** Strip any narration preamble before the SKILL.md YAML frontmatter. */
export function stripPreamble(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "---") continue;
    const block = lines.slice(i + 1, i + 7);
    if (block.some((line) => line.trim().startsWith("name:") || line.trim().startsWith("description:"))) {
      return lines.slice(i).join("\n");
    }
  }
  return text;
}

/** Human-readable notes for environment drift recorded in the decision. */
function formatEnvironmentNotes(mismatch: Record<string, { baseline: unknown; candidate: unknown }> | undefined): string {
  if (!mismatch || !Object.keys(mismatch).length) {
    return "None. The baseline and candidate were rendered in matching environments.";
  }
  const lines = Object.entries(mismatch).map(
    ([key, delta]) => `- ${key}: baseline=${JSON.stringify(delta.baseline)} candidate=${JSON.stringify(delta.candidate)}`,
  );
  return [
    "The following environment differences were detected between the baseline and candidate evidence.",
    "Losses may stem from these causes (browser, GPU, or model changes) rather than the skill content —",
    "do not over-correct the skill for failures plausibly explained by them:",
    ...lines,
  ].join("\n");
}

function renderTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

function generateHypothesis(
  decision: Record<string, any>,
  history: IterationHistory[],
  coverage: { uncovered_sections: string[]; uncovered_apis: string[] },
): string {
  const lines = [
    "# Candidate Skill Hypothesis",
    "",
    "## Motivation",
    "",
    `Last decision: ${decision.decision ?? "UNKNOWN"}`,
    `Rule fired: ${decision.rule_fired ?? "unknown"}`,
    `Counts: ${JSON.stringify(decision.counts ?? {})}`,
    "",
    "### Last Decision Rationale",
    "",
    decision.rationale ?? "No rationale provided",
    "",
  ];

  if (history.length) {
    lines.push("## Recent Evaluation Losses", "");
    let lossesFound = false;
    for (const iteration of history) {
      const losses = iteration.scenarios.filter((scenario) => scenario.verdict === "BASELINE");
      if (losses.length) {
        lossesFound = true;
        lines.push(`### Iteration ${iteration.iteration}`);
        for (const scenario of losses) {
          lines.push(`- **${scenario.eval_id}**: ${scenario.rationale.slice(0, 200)}...`);
        }
        lines.push("");
      }
    }
    if (!lossesFound) lines.push("No significant losses in recent history.", "");
  }

  if (coverage.uncovered_sections.length || coverage.uncovered_apis.length) {
    lines.push(
      "## Coverage Gaps",
      "",
      `- ${coverage.uncovered_sections.length} uncovered sections`,
      `- ${coverage.uncovered_apis.length} uncovered APIs`,
      "",
      "Note: Coverage gaps are informational. The proposer should only add content if it addresses specific evaluation failures.",
      "",
    );
  }

  lines.push(
    "## Proposed Changes",
    "",
    "The candidate skill has been revised to address the above evidence.",
    "Specific changes are embedded in the skill markdown itself.",
    "",
  );
  return lines.join("\n");
}

function nextIteration(skill: string): string {
  const candidatesDir = fromRepoRoot("optimization", "candidates", skill);
  const existing = listDirs(candidatesDir)
    .map((name) => Number.parseInt(name, 10))
    .filter((value) => Number.isInteger(value));
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  return String(next).padStart(3, "0");
}

export interface ProposeOptions {
  skill: string;
  skillPath?: string;
  decisionPath?: string;
  coveragePath?: string;
  outputDir?: string;
  iteration?: string;
  maxHistory?: number;
  harness?: string;
  model?: string;
  variant?: string;
  temperature?: number;
  promptVersion?: string;
}

export async function proposeCommand(ctx: EvalContext, options: ProposeOptions): Promise<number> {
  const skillPath = options.skillPath ?? fromRepoRoot("skills", options.skill, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    console.error(`Skill file not found: ${skillPath}`);
    return 2;
  }
  const decisionPath = options.decisionPath ?? fromRepoRoot("optimization", "results", options.skill, "latest", "decision.json");
  const coveragePath = options.coveragePath ?? fromRepoRoot("optimization", "results", "coverage.json");
  const iteration = options.iteration ?? nextIteration(options.skill);
  const outputDir = options.outputDir ?? fromRepoRoot("optimization", "candidates", options.skill, iteration);
  const promptVersion = options.promptVersion ?? "propose-v1";
  const overrides = { harness: options.harness, model: options.model, variant: options.variant };

  console.log(`Loading skill from: ${repoRelative(skillPath)}`);
  const currentSkill = fs.readFileSync(skillPath, "utf-8");

  console.log(`Loading decision from: ${repoRelative(decisionPath)}`);
  const decision = loadDecision(decisionPath);

  const maxHistory = options.maxHistory ?? 3;
  console.log(`Loading evaluation history (last ${maxHistory} iterations)`);
  const history = loadEvaluationHistory(options.skill, maxHistory);

  console.log(`Loading coverage from: ${repoRelative(coveragePath)}`);
  const coverage = loadCoverage(coveragePath, options.skill);

  const templatePath = fromRepoRoot("optimization", "prompts", "proposer", `${promptVersion}.txt`);
  if (!fs.existsSync(templatePath)) {
    console.error(`Prompt template not found: ${repoRelative(templatePath)}`);
    return 2;
  }
  const [uncoveredSections, uncoveredApis] = formatCoverageGaps(coverage);
  const prompt = renderTemplate(fs.readFileSync(templatePath, "utf-8"), {
    current_skill: currentSkill,
    last_decision: decision.decision ?? "UNKNOWN",
    last_rule: decision.rule_fired ?? "unknown",
    last_rationale: decision.rationale ?? "No rationale provided",
    environment_notes: formatEnvironmentNotes(decision.environment_mismatch),
    wins: decision.counts?.wins ?? 0,
    losses: decision.counts?.losses ?? 0,
    ties: decision.counts?.ties ?? 0,
    history_count: history.length,
    evaluation_history: formatEvaluationHistory(history),
    uncovered_section_count: coverage.uncovered_sections.length,
    uncovered_sections: uncoveredSections,
    uncovered_api_count: coverage.uncovered_apis.length,
    uncovered_apis: uncoveredApis,
  });

  const described = describeAgent(ctx, "proposer", overrides);
  console.log(
    `Calling proposer (harness=${described.harness}, model=${described.model}, variant=${described.variant}, ` +
      `temperature=${options.temperature ?? 1.0})...`,
  );
  const researchDirs = ["skills", "optimization", "wiki"].map((dir) => fromRepoRoot(dir)).filter(fs.existsSync);
  const invocation = await invokeAgent(ctx, "proposer", {
    prompt,
    allowedTools: ["Read", "Grep", "Glob"],
    addDirs: researchDirs,
    title: "skill optimization proposer",
    overrides,
  });
  const candidateSkill = stripPreamble(invocation.text);
  const hypothesis = generateHypothesis(decision, history, coverage);

  fs.mkdirSync(outputDir, { recursive: true });
  const skillOut = path.join(outputDir, "SKILL.md");
  fs.writeFileSync(skillOut, candidateSkill);
  fs.writeFileSync(path.join(outputDir, "hypothesis.md"), hypothesis);
  writeJsonPlain(path.join(outputDir, "proposer-metadata.json"), {
    skill: options.skill,
    iteration,
    harness: invocation.agent.harness,
    model_id: invocation.agent.model,
    model_variant: invocation.agent.variant,
    // Seed provenance: explicit_seed = a decision record was handed in (e.g.
    // a human-confirmed scorecard focus), vs the loop's own default chain.
    explicit_seed: Boolean(options.decisionPath),
    decision_path: fs.existsSync(decisionPath) ? repoRelative(decisionPath) : null,
    temperature: options.temperature ?? 1.0,
    prompt_version: promptVersion,
    timestamp_utc: new Date().toISOString(),
    current_skill_hash: sha256Text(currentSkill),
    candidate_skill_hash: sha256Text(candidateSkill),
    decision_summary: {
      decision: decision.decision ?? null,
      rule_fired: decision.rule_fired ?? null,
      counts: decision.counts ?? null,
    },
    history_iterations: history.length,
    uncovered_sections_count: coverage.uncovered_sections.length,
    uncovered_apis_count: coverage.uncovered_apis.length,
  });

  console.log(`Candidate skill written to: ${repoRelative(skillOut)}`);
  console.log(`\nProposal complete for iteration ${iteration}`);
  return 0;
}
