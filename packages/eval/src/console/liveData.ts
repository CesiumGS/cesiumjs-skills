/**
 * Read-only live progress for eval runs happening NOW: optimization-loop
 * iterations and combined baseline audits, derived from journals plus
 * on-disk artifacts. Also owns launching audits from the console.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, readJsonl, readJsonOrNull, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs, walkFiles } from "../lib/paths.js";
import { parseTs } from "../lib/format.js";
import { isFresh, journalFor, scenarioLabel } from "./optimizationData.js";
import type { EvalContext } from "../config/types.js";

const resultsRoot = () => fromRepoRoot("optimization", "results");
const runsRoot = () => fromRepoRoot("optimization", "runs");
const generatedRoot = () => fromRepoRoot("optimization", "generated");
const scenariosRoot = () => fromRepoRoot("optimization", "scenarios");
const auditsRoot = () => fromRepoRoot("evaluation", "artifacts", "audits");
const fixturesRoot = () => fromRepoRoot("evaluation", "fixtures");

const BUNDLE_REQUIRED = ["console.json", "programmatic-checks.json", "scene-state.json", "metadata.json", "screenshot-quality.json"];

const ITER_PHASES: Array<[string, string, number]> = [
  ["proposer", "Proposer", 0.16],
  ["skills_adapter", "Codegen", 0.22],
  ["browser_runner", "Render", 0.3],
  ["judges", "Judges", 0.26],
  ["decision", "Decision", 0.02],
  ["report", "Report", 0.02],
  ["archive", "Archive", 0.02],
];

const BASELINE_PHASES: Array<[string, string, number]> = [
  ["baseline_check", "Baseline check", 0.04],
  ["baseline_generation", "Baseline codegen", 0.38],
  ["baseline_browser_eval", "Baseline render", 0.58],
];

const ITER_TERMINAL = new Set(["iteration_completed", "iteration_failed"]);
const BASELINE_TERMINAL = new Set([
  "baseline_check_completed",
  "baseline_generation_failed",
  "baseline_browser_eval_completed",
  "baseline_browser_eval_failed",
]);
const AUDIT_TERMINAL = new Set(["audit_completed", "audit_failed", "audit_cancelled"]);

export const AUDIT_JOURNAL_NAME = "progress.jsonl";
export const LAUNCH_META_NAME = "launch.json";

// ---------------------------------------------------------------------------
// scenario/trial helpers
// ---------------------------------------------------------------------------
function scenarios(skill: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const scenarioPath of globFiles(path.join(scenariosRoot(), skill), "eval-", ".json")) {
    let data: any;
    try {
      data = readJson(scenarioPath);
    } catch {
      continue;
    }
    const scenarioId = String(data.id ?? path.basename(scenarioPath, ".json"));
    const [, label] = scenarioLabel(`${scenarioId}-${data.name ?? path.basename(scenarioPath, ".json")}`);
    out.push({
      scenario_id: scenarioId,
      label,
      runnable: (data.runner_mode ?? "global-js") !== "review-only",
    });
  }
  return out;
}

function bundleComplete(bundle: string): boolean {
  if (!fs.existsSync(bundle)) return false;
  if (!globFiles(bundle, "screenshot", ".png").length) return false;
  return BUNDLE_REQUIRED.every((name) => fs.existsSync(path.join(bundle, name)));
}

function findBundle(runsDir: string, scenarioId: string): string | null {
  const exact = path.join(runsDir, scenarioId);
  if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) return exact;
  for (const item of listDirs(runsDir)) {
    if (item.startsWith(`${scenarioId}-`)) return path.join(runsDir, item);
  }
  return null;
}

function trials(skill: string, artifactIter: string): Array<Record<string, any>> {
  const genDir = path.join(generatedRoot(), skill, artifactIter);
  const runsDir = path.join(runsRoot(), skill, artifactIter);
  return scenarios(skill).map((scenario) => {
    const sid = scenario.scenario_id;
    const bundle = findBundle(runsDir, sid);
    return {
      ...scenario,
      codegen_done: fs.existsSync(path.join(genDir, `${sid}.js`)),
      render_done: bundle !== null && bundleComplete(bundle),
      judged: bundle !== null && fs.existsSync(path.join(bundle, "judge-verdicts.json")),
    };
  });
}

function lastArtifactMtime(skill: string, artifactIter: string): Date | null {
  let newest: number | null = null;
  for (const base of [path.join(generatedRoot(), skill, artifactIter), path.join(runsRoot(), skill, artifactIter)]) {
    if (!fs.existsSync(base)) continue;
    for (const filePath of walkFiles(base)) {
      try {
        const mtime = fs.statSync(filePath).mtimeMs;
        if (newest === null || mtime > newest) newest = mtime;
      } catch {
        // raced deletion
      }
    }
  }
  return newest === null ? null : new Date(newest);
}

// ---------------------------------------------------------------------------
// phase-state machine (journal -> pending|active|done|failed)
// ---------------------------------------------------------------------------
function phaseStates(
  journal: Array<Record<string, any>>,
  phases: Array<[string, string, number]>,
  kind: "iteration" | "baseline",
): Array<Record<string, any>> {
  const rows = phases.map(([id, label, weight]) => ({ id, label, weight, state: "pending", started_utc: null as string | null }));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const apply = (pid: string, eventKind: string, ts: unknown) => {
    const row = byId.get(pid);
    if (!row) return;
    if (eventKind === "started" && row.state === "pending") {
      row.state = "active";
      row.started_utc = typeof ts === "string" ? ts : null;
    } else if (eventKind === "completed" && row.state !== "failed") {
      row.state = "done";
    } else if (eventKind === "failed") {
      row.state = "failed";
    }
  };

  for (const event of journal) {
    const name = String(event.event ?? "");
    const ts = event.timestamp_utc;
    if (kind === "iteration") {
      if (["step_started", "step_completed", "step_failed"].includes(name)) {
        apply(String(event.step ?? ""), name.split("_")[1], ts);
      }
    } else {
      for (const [suffix, eventKind] of [
        ["_started", "started"],
        ["_completed", "completed"],
        ["_failed", "failed"],
      ] as const) {
        if (name.endsWith(suffix)) {
          apply(name.slice(0, -suffix.length), eventKind, ts);
          break;
        }
      }
    }
  }
  return rows;
}

function applyTrialCounts(phases: Array<Record<string, any>>, trialRows: Array<Record<string, any>>): void {
  const runnable = trialRows.filter((t) => t.runnable);
  const counts: Record<string, [number, number]> = {
    skills_adapter: [trialRows.filter((t) => t.codegen_done).length, trialRows.length],
    browser_runner: [runnable.filter((t) => t.render_done).length, runnable.length],
    judges: [runnable.filter((t) => t.judged).length, runnable.length],
    baseline_generation: [trialRows.filter((t) => t.codegen_done).length, trialRows.length],
    baseline_browser_eval: [runnable.filter((t) => t.render_done).length, runnable.length],
  };
  for (const phase of phases) {
    const doneTotal = counts[phase.id];
    if (doneTotal === undefined) {
      phase.trials_done = null;
      phase.trials_total = null;
    } else {
      [phase.trials_done, phase.trials_total] = doneTotal;
    }
  }
}

function progressOf(phases: Array<Record<string, any>>): number {
  let total = 0;
  for (const phase of phases) {
    if (phase.state === "done") total += phase.weight;
    else if (phase.state === "active" || phase.state === "failed") {
      const done = phase.trials_done;
      const count = phase.trials_total;
      if (done !== null && done !== undefined && count) total += phase.weight * Math.min(1, done / count);
    }
  }
  return Math.round(Math.min(1, total) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// optimization-loop live rows
// ---------------------------------------------------------------------------
function liveRun(
  skill: string,
  iteration: string,
  journalIn: Array<Record<string, any>>,
  maxAgeSeconds: number,
): Record<string, any> | null {
  if (!journalIn.length) return null;
  const kind = iteration === "baseline" ? "baseline" : "iteration";

  // Only the segment after the most recent start event describes this attempt.
  let journal = journalIn;
  const startEvents = kind === "baseline" ? new Set(["baseline_check_started"]) : new Set(["iteration_started"]);
  for (let idx = journal.length - 1; idx >= 0; idx--) {
    if (startEvents.has(String(journal[idx].event ?? ""))) {
      journal = journal.slice(idx);
      break;
    }
  }

  const last = journal[journal.length - 1];
  const lastEvent = String(last.event ?? "");
  const terminal = kind === "baseline" ? BASELINE_TERMINAL : ITER_TERMINAL;
  if (terminal.has(lastEvent)) return null;

  const phases = phaseStates(journal, kind === "baseline" ? BASELINE_PHASES : ITER_PHASES, kind);
  if (kind === "iteration" && journal.some((e) => e.step === "promote_current_best")) {
    phases.push(...phaseStates(journal, [["promote_current_best", "Promote", 0]], "iteration"));
  }

  const trialRows = trials(skill, iteration);
  applyTrialCounts(phases, trialRows);

  const startedTs = parseTs(journal[0].timestamp_utc);
  const journalTs = parseTs(last.timestamp_utc);
  const artifactTs = lastArtifactMtime(skill, iteration);
  const candidates = [journalTs, artifactTs].filter((ts): ts is Date => ts !== null);
  const lastActivity = candidates.length ? new Date(Math.max(...candidates.map((ts) => ts.getTime()))) : null;

  const status = lastActivity !== null && isFresh(lastActivity.toISOString(), maxAgeSeconds) ? "running" : "stalled";
  const active = phases.find((p) => p.state === "active" || p.state === "failed") ?? null;
  const doneCount = phases.filter((p) => p.state === "done").length;

  return {
    skill,
    iteration,
    kind,
    status,
    started_utc: startedTs?.toISOString() ?? null,
    last_activity_utc: lastActivity?.toISOString() ?? null,
    elapsed_s: startedTs !== null ? Math.max(0, Math.floor((Date.now() - startedTs.getTime()) / 1000)) : null,
    current_phase: active?.id ?? null,
    current_phase_label: active?.label ?? null,
    phase_index: phases.length ? Math.min(doneCount + 1, phases.length) : 0,
    phase_total: phases.length,
    phases,
    trials: trialRows,
    trials_total: trialRows.length,
    progress: progressOf(phases),
    last_event: { event: lastEvent, step: last.step ?? null, timestamp_utc: last.timestamp_utc ?? null },
    journal_tail: journal.slice(-60),
  };
}

// ---------------------------------------------------------------------------
// combined baseline audits (journaled by `cesium-eval audit --journal`)
// ---------------------------------------------------------------------------
function auditPhaseSpec(judge: boolean): Array<[string, string, number]> {
  if (judge) {
    return [
      ["judge", "Visual Judge", 0.82],
      ["score", "Deterministic Score", 0.13],
      ["write", "Scorecard", 0.05],
    ];
  }
  return [
    ["score", "Deterministic Score", 0.85],
    ["write", "Scorecard", 0.15],
  ];
}

function auditPhases(journal: Array<Record<string, any>>, judge: boolean): Array<Record<string, any>> {
  const rows = auditPhaseSpec(judge).map(([id, label, weight]) => ({
    id,
    label,
    weight,
    state: "pending",
    started_utc: null as string | null,
    trials_done: null as number | null,
    trials_total: null as number | null,
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const mark = (pid: string, state: string, ts: unknown = null) => {
    const row = byId.get(pid);
    if (!row) return;
    if (state === "active" && row.state === "pending") {
      row.state = "active";
      row.started_utc = typeof ts === "string" ? ts : null;
    } else if (state === "done" && row.state !== "failed") {
      row.state = "done";
    } else if (state === "failed") {
      row.state = "failed";
    }
  };

  for (const event of journal) {
    const name = String(event.event ?? "");
    const ts = event.timestamp_utc;
    if (name === "judge_started") {
      mark("judge", "active", ts);
      const judgeRow = byId.get("judge");
      if (judgeRow) {
        judgeRow.trials_total = event.total ?? null;
        judgeRow.trials_done = 0;
      }
    } else if (name === "judge_case_completed") {
      const judgeRow = byId.get("judge");
      if (judgeRow) {
        judgeRow.trials_done = event.index ?? null;
        judgeRow.trials_total = event.total ?? null;
      }
    } else if (name === "judge_completed") {
      mark("judge", "done");
    } else if (name === "scoring_started") {
      mark("judge", "done");
      mark("score", "active", ts);
      const scoreRow = byId.get("score");
      if (scoreRow) {
        scoreRow.trials_total = event.total ?? null;
        scoreRow.trials_done = 0;
      }
    } else if (name === "scoring_case_completed") {
      const scoreRow = byId.get("score");
      if (scoreRow) {
        scoreRow.trials_done = event.index ?? null;
        scoreRow.trials_total = event.total ?? null;
      }
    } else if (name === "scoring_completed") {
      mark("score", "done");
      mark("write", "active", ts);
    } else if (name === "scorecard_written") {
      mark("write", "done");
    } else if (name === "audit_failed") {
      const failing = rows.find((row) => row.state === "active") ?? rows[rows.length - 1];
      failing.state = "failed";
    }
  }
  return rows;
}

function auditTrials(journal: Array<Record<string, any>>): Array<Record<string, any>> {
  const started = journal.find((e) => String(e.event) === "audit_started");
  let roster: Array<[string, string]> = [];
  if (started && Array.isArray(started.cases)) {
    roster = started.cases
      .filter((c: any) => c !== null && typeof c === "object")
      .map((c: any) => [String(c.skill ?? ""), String(c.case_id ?? "")]);
  }
  const judged = new Set<string>();
  const scored = new Set<string>();
  // Journal-truth parallelism: cases the judge lane has opened but not closed.
  const inflight = new Set<string>();
  const verdicts = new Map<string, string>();
  // Which worker currently holds each in-flight case (cleared on completion),
  // so the live board can show "Worker 3 → camera·eval-108".
  const workerByKey = new Map<string, number>();
  for (const event of journal) {
    const name = String(event.event ?? "");
    const key = `${event.skill ?? ""}\u0000${event.case_id ?? ""}`;
    if (name === "judge_case_started") {
      inflight.add(key);
      if (typeof event.worker_id === "number") workerByKey.set(key, event.worker_id);
    } else if (name === "judge_case_completed") {
      inflight.delete(key);
      workerByKey.delete(key);
      judged.add(key);
      if (typeof event.status === "string" && event.status) verdicts.set(key, event.status);
    } else if (name === "scoring_case_completed") scored.add(key);
  }
  if (!roster.length) {
    roster = [...new Set([...judged, ...scored])].sort().map((key) => key.split("\u0000") as [string, string]);
  }
  const multiSkill = new Set(roster.map(([skill]) => skill)).size > 1;
  return roster.map(([skill, caseId]) => {
    const key = `${skill}\u0000${caseId}`;
    const short = skill.replace(/^cesiumjs-/, "");
    return {
      scenario_id: multiSkill ? `${short}\u00b7${caseId}` : caseId,
      label: multiSkill ? "" : short,
      group: short,
      case_id: caseId,
      runnable: true,
      codegen_done: false,
      render_done: scored.has(key),
      judged: judged.has(key),
      inflight: inflight.has(key),
      worker: workerByKey.get(key) ?? null,
      verdict: verdicts.get(key) ?? null,
    };
  });
}

/** Whether a recorded launch pid still names a live process. Missing/invalid
 *  pids read as dead; EPERM means the process exists under another owner. */
function pidAlive(pid: unknown): boolean {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/** Last few non-empty lines of a launch's stdout/stderr log, used to explain a
 *  launch that died before its audit could journal a failure of its own. */
function launchLogTail(auditDir: string, maxLines = 4): string | null {
  const logPath = path.join(auditDir, "launch.log");
  if (!fs.existsSync(logPath)) return null;
  let text: string;
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  return lines.slice(-maxLines).join("\n");
}

/** Assemble a live-run row from a launch's journal + metadata. The caller has
 *  already classified the run, so `status`/`error` come in ready to attach. */
function auditRunRow(
  auditDir: string,
  launchMeta: Record<string, any>,
  journal: Array<Record<string, any>>,
  status: string,
  error: string | null,
): Record<string, any> {
  const startedEvent = journal.find((e) => String(e.event) === "audit_started");
  const judge = Boolean(startedEvent?.judge ?? launchMeta.judge ?? true);
  const skills: string[] = [...(startedEvent?.skills ?? launchMeta.skills ?? [])];
  const judgeStarted = journal.find((e) => String(e.event) === "judge_started");
  const concurrency = Math.max(1, Number(judgeStarted?.concurrency ?? launchMeta.concurrency ?? 1) || 1);
  const phases = auditPhases(journal, judge);
  const trialRows = auditTrials(journal);

  const startedTs = parseTs(journal[0]?.timestamp_utc) ?? parseTs(launchMeta.started_utc);
  const last = journal.length ? journal[journal.length - 1] : {};
  const lastEvent = String(last.event ?? "");
  const journalTs = parseTs(last.timestamp_utc);
  let logTs: Date | null = null;
  const logPath = path.join(auditDir, "launch.log");
  if (fs.existsSync(logPath)) {
    try {
      logTs = new Date(fs.statSync(logPath).mtimeMs);
    } catch {
      logTs = null;
    }
  }
  const candidates = [journalTs, logTs].filter((ts): ts is Date => ts !== null);
  const lastActivity = candidates.length ? new Date(Math.max(...candidates.map((ts) => ts.getTime()))) : null;

  const active = phases.find((p) => p.state === "active" || p.state === "failed") ?? null;
  const doneCount = phases.filter((p) => p.state === "done").length;
  const label = skills.length === 1 ? `Audit \u00b7 ${skills[0]}` : "Combined Audit";

  return {
    skill: skills.length === 1 ? skills[0] : "baseline-audit",
    label: skills.length > 1 ? `${label} (${skills.length} Skills)` : label,
    iteration: path.basename(auditDir),
    kind: "audit",
    launch_id: launchMeta.launch_id ?? null,
    judge,
    judge_harness: launchMeta.judge_harness ?? null,
    codegen_harness: launchMeta.codegen_harness ?? null,
    concurrency,
    status,
    error,
    started_utc: startedTs?.toISOString() ?? null,
    last_activity_utc: lastActivity?.toISOString() ?? null,
    elapsed_s: startedTs !== null ? Math.max(0, Math.floor((Date.now() - startedTs.getTime()) / 1000)) : null,
    current_phase: active?.id ?? null,
    current_phase_label: active?.label ?? null,
    phase_index: phases.length ? Math.min(doneCount + 1, phases.length) : 0,
    phase_total: phases.length,
    phases,
    trials: trialRows,
    trials_total: trialRows.length,
    progress: progressOf(phases),
    last_event: { event: lastEvent, step: last.step ?? null, timestamp_utc: last.timestamp_utc ?? null },
    journal_tail: journal.slice(-60),
  };
}

function auditLiveRun(auditDir: string, maxAgeSeconds: number): Record<string, any> | null {
  const journal = readJsonl(path.join(auditDir, AUDIT_JOURNAL_NAME));
  const launchMeta = readJsonOrNull(path.join(auditDir, LAUNCH_META_NAME)) ?? {};
  const hasLaunch = Object.keys(launchMeta).length > 0;
  const scorecardWritten = fs.existsSync(path.join(auditDir, "scorecard.json"));

  const last = journal.length ? journal[journal.length - 1] : null;
  const lastEvent = last ? String(last.event ?? "") : "";

  // A finished or deliberately cancelled run leaves the live view: its scorecard
  // surfaces under Recent Runs, and a cancel was intentional.
  if (AUDIT_TERMINAL.has(lastEvent) && lastEvent !== "audit_failed") return null;

  // The run journalled its own failure: keep it visible with a reason instead of
  // dropping it on the floor.
  if (lastEvent === "audit_failed") {
    const reason = (last && typeof last.error === "string" && last.error) || launchLogTail(auditDir) || "audit failed";
    return auditRunRow(auditDir, launchMeta, journal, "failed", String(reason));
  }

  // A console launch whose process is gone but that never reached a terminal
  // event and left no scorecard died silently (bad flag, missing harness CLI,
  // early crash). Surface it as a failed study carrying its launch-log tail,
  // rather than a phantom "running" row that later vanishes with no trace.
  if (hasLaunch && !pidAlive(launchMeta.pid) && !scorecardWritten) {
    const reason = launchLogTail(auditDir) || (journal.length ? "process exited before completing" : "launch produced no output");
    return auditRunRow(auditDir, launchMeta, journal, "failed", reason);
  }

  // No journal yet: the process is coming up (pid alive) or the launch is still
  // fresh. Show it as a pending/running launch while it settles.
  if (!journal.length) {
    if (!hasLaunch) return null;
    const started = String(launchMeta.started_utc ?? "");
    if (!isFresh(started, maxAgeSeconds)) return null;
    const seeded = [{ timestamp_utc: started, event: "launch_accepted" }];
    return auditRunRow(auditDir, launchMeta, seeded, "running", null);
  }

  // Journal in progress: running if there was recent activity, else stalled.
  const journalTs = parseTs(last!.timestamp_utc);
  let logTs: Date | null = null;
  const logPath = path.join(auditDir, "launch.log");
  if (fs.existsSync(logPath)) {
    try {
      logTs = new Date(fs.statSync(logPath).mtimeMs);
    } catch {
      logTs = null;
    }
  }
  const candidates = [journalTs, logTs].filter((ts): ts is Date => ts !== null);
  const lastActivity = candidates.length ? new Date(Math.max(...candidates.map((ts) => ts.getTime()))) : null;
  const status = lastActivity !== null && isFresh(lastActivity.toISOString(), maxAgeSeconds) ? "running" : "stalled";
  return auditRunRow(auditDir, launchMeta, journal, status, null);
}

function auditLiveRuns(maxAgeSeconds: number): Array<Record<string, any>> {
  const rows: Array<Record<string, any>> = [];
  if (!fs.existsSync(auditsRoot())) return rows;
  for (const name of listDirs(auditsRoot())) {
    const auditDir = path.join(auditsRoot(), name);
    if (!fs.existsSync(path.join(auditDir, AUDIT_JOURNAL_NAME)) && !fs.existsSync(path.join(auditDir, LAUNCH_META_NAME))) continue;
    try {
      const run = auditLiveRun(auditDir, maxAgeSeconds);
      if (run) rows.push(run);
    } catch {
      // One corrupt dir must not take down the endpoint.
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
export function liveStatus(ctx: EvalContext): Record<string, any> {
  const maxAge = ctx.config.liveness.runningMaxAgeSeconds;
  const active: Array<Record<string, any>> = [];
  if (fs.existsSync(resultsRoot())) {
    for (const skill of listDirs(resultsRoot())) {
      for (const iteration of listDirs(path.join(resultsRoot(), skill))) {
        const run = liveRun(skill, iteration, journalFor(skill, iteration), maxAge);
        if (run) active.push(run);
      }
    }
  }
  active.push(...auditLiveRuns(maxAge));
  active.sort((a, b) => {
    if ((a.status !== "running") !== (b.status !== "running")) return a.status !== "running" ? 1 : -1;
    const ta = parseTs(a.last_activity_utc)?.getTime() ?? 0;
    const tb = parseTs(b.last_activity_utc)?.getTime() ?? 0;
    return tb - ta;
  });
  return {
    generated_at: new Date().toISOString(),
    running: active.some((run) => run.status === "running"),
    poll_ms: ctx.config.server.pollMs,
    max_age_s: maxAge,
    active,
  };
}

export function availableSkills(): string[] {
  return listDirs(fixturesRoot());
}

/**
 * Validate and start a combined baseline audit as a detached child process;
 * progress flows back exclusively through the journal.
 */
export function launchRun(ctx: EvalContext, payload: Record<string, any>): Record<string, any> {
  const kind = String(payload.kind ?? "audit");
  if (kind !== "audit") throw new Error(`unsupported launch kind: '${kind}' (supported: audit)`);

  const known = availableSkills();
  const requested = payload.skills;
  const allRequested =
    requested === null || requested === undefined || (Array.isArray(requested) && !requested.length) || requested === "all" || requested === "ALL";
  let skills: string[];
  if (allRequested) {
    skills = known;
  } else {
    if (!Array.isArray(requested)) throw new Error("skills must be a list of skill ids or omitted for all");
    skills = requested.map(String);
    const unknown = skills.filter((skill) => !known.includes(skill));
    if (unknown.length) throw new Error(`unknown skill(s): ${unknown.join(", ")}`);
  }
  if (!skills.length) throw new Error("no skills available to audit");

  const judge = Boolean(payload.judge ?? true);
  const judgeHarness = String(payload.judge_harness ?? ctx.resolveRole("judge").harness.id);
  const validJudgeHarnesses = new Set([...ctx.registry.harnesses.map((harness) => harness.id), "fake"]);
  if (!validJudgeHarnesses.has(judgeHarness)) {
    throw new Error(`unknown judge_harness: '${judgeHarness}' (supported: ${[...validJudgeHarnesses].sort().join(", ")})`);
  }
  const nJudges = Number(payload.n_judges ?? ctx.config.judgePanel.size);
  if (!Number.isInteger(nJudges)) throw new Error("n_judges must be an integer");
  if (nJudges < 1 || nJudges > 5) throw new Error("n_judges must be between 1 and 5");

  let concurrency: number | null = null;
  if (payload.concurrency !== undefined && payload.concurrency !== null && payload.concurrency !== "") {
    concurrency = Number(payload.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new Error("concurrency must be an integer between 1 and 8");
    }
  }

  // Optional codegen provenance stamp (mirrors audit --codegen-harness). Must be
  // a real registry harness: "fake" is a judge-lane smoke harness, not a codegen
  // origin.
  let codegenHarness: string | null = null;
  if (payload.codegen_harness !== undefined && payload.codegen_harness !== null && payload.codegen_harness !== "") {
    codegenHarness = String(payload.codegen_harness);
    const validHarnesses = new Set(ctx.registry.harnesses.map((harness) => harness.id));
    if (!validHarnesses.has(codegenHarness)) {
      throw new Error(`unknown codegen_harness: '${codegenHarness}' (supported: ${[...validHarnesses].sort().join(", ")})`);
    }
  }

  // Optional advanced flags (mirror the audit CLI surface).
  let judgeModel: string | null = null;
  if (payload.judge_model !== undefined && payload.judge_model !== null && payload.judge_model !== "") {
    judgeModel = String(payload.judge_model);
    if (judgeModel.length > 200 || !/^[\w./:-]+$/.test(judgeModel)) throw new Error("invalid judge_model");
  }
  // Reasoning effort / variant ids ("low", "high", "xhigh", "max"…) for the
  // judge lane, plus codegen model/effort provenance stamps for the scorecard.
  const effortField = (value: unknown, field: string): string | null => {
    if (value === undefined || value === null || value === "") return null;
    const effort = String(value);
    if (effort.length > 32 || !/^[\w-]+$/.test(effort)) throw new Error(`invalid ${field}`);
    return effort;
  };
  const judgeVariant = effortField(payload.judge_variant, "judge_variant");
  const codegenVariant = effortField(payload.codegen_variant, "codegen_variant");
  let codegenModel: string | null = null;
  if (payload.codegen_model !== undefined && payload.codegen_model !== null && payload.codegen_model !== "") {
    codegenModel = String(payload.codegen_model);
    if (codegenModel.length > 200 || !/^[\w./:-]+$/.test(codegenModel)) throw new Error("invalid codegen_model");
  }
  let threshold: number | null = null;
  if (payload.threshold !== undefined && payload.threshold !== null && payload.threshold !== "") {
    threshold = Number(payload.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error("threshold must be in (0, 1]");
  }
  let bundleRoot: string | null = null;
  if (payload.bundle_root !== undefined && payload.bundle_root !== null && payload.bundle_root !== "") {
    bundleRoot = String(payload.bundle_root);
    if (path.isAbsolute(bundleRoot) || bundleRoot.split(/[\\/]/).includes("..")) {
      throw new Error("bundle_root must be a repo-relative path");
    }
    if (!fs.existsSync(path.join(ctx.repoRoot, bundleRoot))) throw new Error(`bundle_root does not exist: ${bundleRoot}`);
  }

  const launchId = "live-" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outDir = path.join(auditsRoot(), launchId);
  fs.mkdirSync(outDir, { recursive: true });
  const journalPath = path.join(outDir, AUDIT_JOURNAL_NAME);
  const logPath = path.join(outDir, "launch.log");

  // Re-invoke this same CLI entry point as a detached audit run. "--skills all"
  // stays literal so the recorded argv reads the way a human would type it.
  const cliEntry = path.resolve(fileURLToPath(import.meta.url), "..", "..", "cli", "main.js");
  const argv = [
    cliEntry,
    "audit",
    "--skills",
    allRequested ? "all" : skills.join(","),
    "--journal",
    journalPath,
    "--output-dir",
    outDir,
    "--judge-harness",
    judgeHarness,
    "--n-judges",
    String(nJudges),
  ];
  if (!judge) argv.push("--no-judge");
  if (judge && concurrency !== null && concurrency > 1) argv.push("--concurrency", String(concurrency));
  if (judgeModel) argv.push("--judge-model", judgeModel);
  if (judgeVariant) argv.push("--judge-variant", judgeVariant);
  if (codegenHarness) argv.push("--codegen-harness", codegenHarness);
  if (codegenModel) argv.push("--codegen-model", codegenModel);
  if (codegenVariant) argv.push("--codegen-variant", codegenVariant);
  if (threshold !== null) argv.push("--threshold", String(threshold));
  if (bundleRoot) argv.push("--bundle-root", bundleRoot);

  const logFd = fs.openSync(logPath, "w");
  const child = spawn(process.execPath, argv, {
    cwd: ctx.repoRoot,
    stdio: ["ignore", logFd, logFd],
    detached: true, // survives console restarts; owns its group
  });
  child.unref();
  fs.closeSync(logFd);

  const record = {
    launch_id: launchId,
    kind: "audit",
    pid: child.pid ?? -1,
    skills,
    judge,
    judge_harness: judgeHarness,
    n_judges: nJudges,
    concurrency,
    judge_model: judgeModel,
    judge_variant: judgeVariant,
    codegen_harness: codegenHarness,
    codegen_model: codegenModel,
    codegen_variant: codegenVariant,
    threshold,
    bundle_root: bundleRoot,
    argv: [process.execPath, ...argv],
    journal: journalPath,
    log: logPath,
    output_dir: outDir,
    started_utc: new Date().toISOString(),
  };
  writeJsonPlain(path.join(outDir, LAUNCH_META_NAME), record);
  return record;
}

/**
 * Cancel a console-launched audit run: SIGTERM its detached process group and
 * append a terminal `audit_cancelled` journal event so the live poll settles.
 */
export function cancelRun(payload: Record<string, any>): Record<string, any> {
  const launchId = String(payload.launch_id ?? "");
  if (!/^live-[0-9TZ]+$/.test(launchId)) throw new Error(`invalid launch_id: '${launchId}'`);
  const outDir = path.join(auditsRoot(), launchId);
  const meta = readJsonOrNull(path.join(outDir, LAUNCH_META_NAME));
  if (!meta) throw new Error(`no launch record for ${launchId}`);
  const pid = Number(meta.pid ?? -1);
  let killed = false;
  if (Number.isInteger(pid) && pid > 1) {
    try {
      process.kill(-pid, "SIGTERM"); // detached => own process group
      killed = true;
    } catch {
      try {
        process.kill(pid, "SIGTERM");
        killed = true;
      } catch {
        killed = false; // already gone
      }
    }
  }
  const journalPath = path.join(outDir, AUDIT_JOURNAL_NAME);
  fs.appendFileSync(
    journalPath,
    JSON.stringify({ timestamp_utc: new Date().toISOString(), event: "audit_cancelled", via: "console", pid, killed }) + "\n",
  );
  return { launch_id: launchId, pid, killed, cancelled_utc: new Date().toISOString() };
}
