/**
 * Read-only access to the self-optimization loop's artifacts
 * (results/runs/scenarios trees) for the evaluation console.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, readJsonOrNull, readJsonl } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs, repoRelative } from "../lib/paths.js";
import { parseTs } from "../lib/format.js";

export const WIN = "CANDIDATE";
export const LOSS = "BASELINE";
export const TIE = "TIE";

const resultsRoot = () => fromRepoRoot("optimization", "results");
const runsRoot = () => fromRepoRoot("optimization", "runs");
const scenariosRoot = () => fromRepoRoot("optimization", "scenarios");
const skillsRoot = () => fromRepoRoot("skills");

/** A non-terminal journal older than this is stalled, not running. */
export function isFresh(tsValue: unknown, maxAgeSeconds: number): boolean {
  const ts = parseTs(tsValue);
  if (ts === null) return false;
  return (Date.now() - ts.getTime()) / 1000 <= maxAgeSeconds;
}

function iterSortKey(name: string): [number, string] {
  if (name === "baseline") return [-1, name];
  const match = /^(\d+)/.exec(name);
  return [match ? Number(match[1]) : 10_000, name];
}

export function scenarioLabel(dirname: string): [string, string] {
  const match = /^(eval-\d+)-(.*)$/.exec(dirname);
  if (!match) return [dirname, dirname.replace(/-/g, " ")];
  return [match[1], match[2].replace(/-/g, " ")];
}

function screenshots(bundle: string): string[] {
  return globFiles(bundle, "screenshot", ".png").map(repoRelative);
}

// ---------------------------------------------------------------------------
// summary.md scores
// ---------------------------------------------------------------------------
const SCORE_PATTERNS: Record<string, RegExp> = {
  programmatic: /\*\*Programmatic Correctness:\*\*\s*([\d.]+)%/,
  api: /\*\*API Accuracy:\*\*\s*([\d.]+)%/,
  visual_win_rate: /\*\*Visual Win Rate:\*\*\s*([\d.]+)%/,
  coverage_delta: /\*\*Coverage Delta:\*\*\s*([-\d.]+)%/,
};

function parseScores(summaryMd: string): Record<string, number | null> {
  const out: Record<string, number | null> = Object.fromEntries(Object.keys(SCORE_PATTERNS).map((key) => [key, null]));
  if (!fs.existsSync(summaryMd)) return out;
  const text = fs.readFileSync(summaryMd, "utf-8");
  for (const [key, pattern] of Object.entries(SCORE_PATTERNS)) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (!Number.isNaN(value)) out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// iteration-level reads
// ---------------------------------------------------------------------------
export function iterationDirs(skill: string): string[] {
  return listDirs(path.join(resultsRoot(), skill)).sort((a, b) => {
    const [na, sa] = iterSortKey(a);
    const [nb, sb] = iterSortKey(b);
    return na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0);
  });
}

export function journalFor(skill: string, iteration: string): Array<Record<string, any>> {
  return readJsonl(path.join(resultsRoot(), skill, iteration, "journal.jsonl"));
}

export function iterationSummary(skill: string, iteration: string, runningMaxAgeSeconds: number): Record<string, any> {
  const decision = readJsonOrNull(path.join(resultsRoot(), skill, iteration, "decision.json")) ?? {};
  const scores = parseScores(path.join(resultsRoot(), skill, iteration, "summary.md"));
  const journal = journalFor(skill, iteration);
  const started = journal.find((e) => e.event === "iteration_started")?.timestamp_utc ?? null;
  const finished = [...journal].reverse().find((e) => e.event === "iteration_completed")?.timestamp_utc ?? null;
  const counts = decision.counts ?? {};
  const events = new Set(journal.map((e) => e.event));

  let status: string;
  if (iteration === "baseline") status = "baseline";
  else if (events.has("iteration_completed")) status = "completed";
  else if (events.has("iteration_failed")) status = "failed";
  else if (journal.length) {
    status = isFresh(journal[journal.length - 1]?.timestamp_utc, runningMaxAgeSeconds) ? "running" : "stalled";
  } else status = "empty";

  const failedStep = [...journal].reverse().find((e) => e.event === "iteration_failed")?.step ?? null;

  return {
    iteration,
    is_baseline: iteration === "baseline",
    status,
    failed_step: failedStep,
    decision: decision.decision ?? null,
    rule_fired: decision.rule_fired ?? null,
    rationale: decision.rationale ?? null,
    counts: {
      wins: counts.wins ?? 0,
      losses: counts.losses ?? 0,
      ties: counts.ties ?? 0,
      critical_failures: counts.critical_failures ?? 0,
      check_failures: counts.check_failures ?? 0,
    },
    scores,
    started_utc: started,
    finished_utc: finished,
    has_runs: fs.existsSync(path.join(runsRoot(), skill, iteration)),
  };
}

// ---------------------------------------------------------------------------
// scenario-level reads (candidate-vs-baseline evidence)
// ---------------------------------------------------------------------------
function checksSummary(bundle: string): Record<string, number> {
  const data = readJsonOrNull(path.join(bundle, "programmatic-checks.json")) ?? {};
  const checks: Array<Record<string, any>> = data.checks ?? [];
  return {
    passed: checks.filter((c) => c.result === "pass").length,
    total: checks.length,
    critical_failed: checks.filter((c) => c.result === "fail" && c.critical).length,
  };
}

function consoleErrors(bundle: string): number {
  const data = readJsonOrNull(path.join(bundle, "console.json")) ?? {};
  return (data.errors ?? []).length;
}

function scenarioDetail(skill: string, iteration: string, scenarioDir: string): Record<string, any> {
  const dirname = path.basename(scenarioDir);
  const [scenarioId, label] = scenarioLabel(dirname);
  const verdicts = readJsonOrNull(path.join(scenarioDir, "judge-verdicts.json")) ?? {};
  const baselineBundle = path.join(runsRoot(), skill, "baseline", dirname);
  return {
    scenario_id: scenarioId,
    label,
    dir: dirname,
    verdict: verdicts.verdict ?? null,
    majority_count: verdicts.majority_count ?? null,
    judge_unavailable: Boolean(verdicts.judge_unavailable),
    individual_verdicts: (verdicts.individual_verdicts ?? []).map((v: any) => ({
      seed: v.seed ?? null,
      verdict: v.verdict ?? null,
      rationale: v.rationale ?? null,
      judge_index: v.judge_index ?? null,
    })),
    checks: checksSummary(scenarioDir),
    console_errors: consoleErrors(scenarioDir),
    candidate_screenshots: screenshots(scenarioDir),
    baseline_screenshots: screenshots(baselineBundle),
  };
}

export function iterationDetail(skill: string, iteration: string, runningMaxAgeSeconds: number): Record<string, any> {
  const summary = iterationSummary(skill, iteration, runningMaxAgeSeconds);
  const runsDir = path.join(runsRoot(), skill, iteration);
  const scenarios: Array<Record<string, any>> = [];
  for (const name of listDirs(runsDir)) {
    if (name.startsWith("eval-")) scenarios.push(scenarioDetail(skill, iteration, path.join(runsDir, name)));
  }
  summary.scenarios = scenarios;
  summary.journal = journalFor(skill, iteration);
  return summary;
}

// ---------------------------------------------------------------------------
// skill-level aggregation
// ---------------------------------------------------------------------------
function skillMdMeta(skill: string): Record<string, any> {
  const md = path.join(skillsRoot(), skill, "SKILL.md");
  if (!fs.existsSync(md)) return { exists: false };
  const text = fs.readFileSync(md, "utf-8");
  return { exists: true, bytes: Buffer.byteLength(text, "utf-8"), lines: text.split("\n").length };
}

export function skillOverview(skill: string, runningMaxAgeSeconds: number): Record<string, any> {
  const iters = iterationDirs(skill);
  const history = iters.map((iteration) => iterationSummary(skill, iteration, runningMaxAgeSeconds));
  const nonBaseline = history.filter((h) => !h.is_baseline);
  const kept = nonBaseline.filter((h) => h.decision === "KEEP").length;
  const rejected = nonBaseline.filter((h) => h.decision === "REJECT").length;
  const decisioned = nonBaseline.filter((h) => h.decision);
  const latest = decisioned.length ? decisioned[decisioned.length - 1] : nonBaseline.length ? nonBaseline[nonBaseline.length - 1] : null;
  return {
    skill,
    iteration_count: nonBaseline.length,
    kept,
    rejected,
    latest,
    running: nonBaseline.some((h) => h.status === "running"),
    history,
    skill_md: skillMdMeta(skill),
  };
}

export function listSkills(runningMaxAgeSeconds: number): Array<Record<string, any>> {
  if (!fs.existsSync(resultsRoot())) return [];
  return listDirs(resultsRoot())
    .filter((skill) => iterationDirs(skill).length)
    .map((skill) => skillOverview(skill, runningMaxAgeSeconds));
}

// ---------------------------------------------------------------------------
// live-run detection (disk-level signal)
// ---------------------------------------------------------------------------
const TERMINAL_EVENTS = new Set(["iteration_completed", "iteration_failed", "baseline_check_completed"]);

export function activeRuns(): Array<Record<string, any>> {
  const live: Array<Record<string, any>> = [];
  if (!fs.existsSync(resultsRoot())) return live;
  for (const skill of listDirs(resultsRoot())) {
    for (const iteration of iterationDirs(skill)) {
      const journal = journalFor(skill, iteration);
      if (!journal.length) continue;
      const last = journal[journal.length - 1];
      if (TERMINAL_EVENTS.has(last.event)) continue;
      live.push({
        skill,
        iteration,
        last_event: last.event ?? null,
        last_step: last.step ?? null,
        last_ts: last.timestamp_utc ?? null,
      });
    }
  }
  return live;
}
