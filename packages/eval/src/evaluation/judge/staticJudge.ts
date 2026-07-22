/**
 * Static, single-render qualitative judge: a panel of N judges (distinct
 * seeds and lenses) scores one rendered bundle against the protocol rubric;
 * per-dimension medians plus liveness/subject gates produce one
 * `visual_review_item`.
 *
 * The LLM call is injected (`JudgeCall`), so the panel logic is pure and unit
 * testable; production wires it to the configured judge agent, tests and the
 * `fake` adapter inject canned responses.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonOrNull } from "../../lib/json.js";
import { round } from "../../lib/format.js";
import { repoRelative } from "../../lib/paths.js";

/** One LLM call: fully-rendered prompt + image files + readable dirs -> raw text. */
export type JudgeCall = (prompt: string, files: string[], addDirs: string[]) => string;

export interface JudgePanelOptions {
  call: JudgeCall;
  /** Model id recorded in the emitted item (provenance only). */
  model: string | null;
  nJudges: number;
  seeds: number[];
  /** Protocol id; resolves `<promptsDir>/<protocol>.{system,user}.txt`. */
  protocol: string;
  promptsDir: string;
  reviewer?: string;
}

/** Rubric dimensions and weights for the static-visual protocol. */
export const DIMENSION_WEIGHTS: Record<string, number> = {
  render_liveness: 0.2,
  subject_presence_and_recognizability: 0.22,
  framing_and_composition: 0.18,
  prompt_and_behavior_fidelity: 0.22,
  visual_correctness_and_artifacts: 0.1,
  legibility_and_clarity: 0.08,
};

/** Lenses appended to the system prompt, one per judge index. */
export const LENSES = [
  "FAILURE-MODE AUDITOR: default to skepticism; your priority is catching " +
    "dead/empty/wrong frames; do not reward a confident-looking but empty or " +
    "wrong render.",
  "PROMPT-FIDELITY READER: focus on whether the visible viewing geometry and " +
    "content match the prompt and expected behaviors.",
  "NEUTRAL HOLISTIC: balanced overall assessment.",
];

const BAND_PASS = 7.0;
const BAND_BORDERLINE_LOW = 4.5;

export const BLOCKING_FAILURE_FLAGS = new Set([
  "black_frame_ion_auth",
  "starfield_only",
  "gray_unloaded_globe",
  "wrong_subject",
  "missing_required_subject",
  "camera_inside_geometry",
]);

const LIVENESS_FLAG_MODES = ["black_frame_ion_auth", "starfield_only", "gray_unloaded_globe"];
const SUBJECT_FLAG_MODES = ["wrong_subject", "missing_required_subject", "subject_tiny_speck", "camera_inside_geometry"];

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------
function tryLoadObject(text: string): Record<string, any> | null {
  try {
    const obj = JSON.parse(text);
    return obj !== null && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/** Tolerantly parse a judge's JSON response (fences, prose, first balanced object). */
export function parseJudgeJson(raw: string): Record<string, any> | null {
  if (!raw) return null;
  const text = raw.trim();

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    const parsed = tryLoadObject(fence[1].trim());
    if (parsed !== null) return parsed;
  }

  const direct = tryLoadObject(text);
  if (direct !== null) return direct;

  let start = text.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryLoadObject(text.slice(start, i + 1));
          if (parsed !== null) return parsed;
          break;
        }
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// prompt rendering
// ---------------------------------------------------------------------------
function formatList(value: unknown): string {
  if (value === null || value === undefined) return "(none specified)";
  if (Array.isArray(value)) {
    const items = value.map(String).filter((item) => item.trim());
    return items.length ? items.map((item) => `- ${item}`).join("\n") : "(none specified)";
  }
  const text = String(value).trim();
  return text || "(none specified)";
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

function summarizeConsole(consoleData: any, limit = 30): string {
  if (consoleData === null || consoleData === undefined) return "(no console output captured)";
  const messages = consoleData?.console_messages;
  if (Array.isArray(messages)) {
    const errors = messages.filter((m: any) => m?.type === "error");
    const shown = (errors.length ? errors : messages).slice(0, limit);
    const lines = shown
      .filter((m: any) => m !== null && typeof m === "object")
      .map((m: any) => `[${m.type ?? "?"}] ${String(m.text ?? "").trim().slice(0, 240)}`);
    return `${errors.length} error(s), ${messages.length} message(s) total.\n` + (lines.length ? lines.join("\n") : "(no messages)");
  }
  return JSON.stringify(consoleData, null, 2).slice(0, 4000);
}

function summarizeChecks(checksData: any): string {
  if (checksData === null || checksData === undefined) return "(no programmatic checks captured)";
  const checks = checksData?.checks;
  if (Array.isArray(checks)) {
    const lines: string[] = [];
    for (const check of checks) {
      if (check === null || typeof check !== "object") continue;
      const result = String(check.result ?? "?").toUpperCase();
      const checkId = check.check_id ?? check.type ?? "(unknown)";
      const detail = String(check.detail ?? check.description ?? "").trim();
      lines.push(`[${result}] ${checkId}: ${detail.slice(0, 240)}`);
    }
    const summary = checksData.summary;
    if (summary !== null && typeof summary === "object" && !Array.isArray(summary)) {
      lines.push(`Summary: ${summary.passed ?? "?"}/${summary.total ?? "?"} passed, ${summary.failed ?? "?"} failed`);
    }
    return lines.length ? lines.join("\n") : "(programmatic checks present but empty)";
  }
  return JSON.stringify(checksData, null, 2).slice(0, 4000);
}

function summarizeJson(value: any, missing: string): string {
  if (value === null || value === undefined) return missing;
  return JSON.stringify(value, null, 2).slice(0, 4000);
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------
function clampScore(value: unknown): number | null {
  const asNumber = Number(value);
  if (value === null || value === undefined || Number.isNaN(asNumber)) return null;
  return Math.max(0, Math.min(10, Math.round(asNumber)));
}

function medianInt(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

interface Aggregation {
  nParsed: number;
  dimMedians: Record<string, number>;
  flagCounts: Record<string, number>;
}

function aggregate(parsedResults: Array<Record<string, any> | null>): Aggregation {
  const parsed = parsedResults.filter((j): j is Record<string, any> => j !== null);

  const dimMedians: Record<string, number> = {};
  for (const dim of Object.keys(DIMENSION_WEIGHTS)) {
    const scores = parsed
      .map((j) => clampScore(j.dimensions?.[dim]?.score))
      .filter((score): score is number => score !== null);
    dimMedians[dim] = scores.length ? medianInt(scores) : 0; // missing = failing, conservatively
  }

  const flagCounts: Record<string, number> = {};
  for (const j of parsed) {
    const flags = new Set<string>();
    if (Array.isArray(j.failure_modes_detected)) {
      for (const flag of j.failure_modes_detected) if (String(flag).trim()) flags.add(String(flag));
    }
    for (const entry of Object.values(j.dimensions ?? {})) {
      const modes = (entry as any)?.failure_modes;
      if (Array.isArray(modes)) {
        for (const flag of modes) if (String(flag).trim()) flags.add(String(flag));
      }
    }
    for (const flag of flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  }

  return { nParsed: parsed.length, dimMedians, flagCounts };
}

function bandOf(overall: number): string {
  if (overall >= BAND_PASS) return "PASS";
  if (overall >= BAND_BORDERLINE_LOW) return "BORDERLINE";
  return "FAIL";
}

function dimensionStatus(score: number, gated: boolean): string {
  if (gated || score <= 2) return "fail";
  if (score <= 4) return "needs_review";
  if (score >= 7) return "pass";
  return "needs_review";
}

// ---------------------------------------------------------------------------
// core
// ---------------------------------------------------------------------------
function listScreenshots(bundleDir: string): string[] {
  const shots: string[] = [];
  const primary = path.join(bundleDir, "screenshot.png");
  if (fs.existsSync(primary)) shots.push(primary);
  try {
    shots.push(
      ...fs
        .readdirSync(bundleDir)
        .filter((name) => name.startsWith("screenshot-") && name.endsWith(".png"))
        .sort()
        .map((name) => path.join(bundleDir, name)),
    );
  } catch {
    // missing bundle dir handled by the no-screenshot path below
  }
  return shots;
}

/** Run the judge panel over one bundle and emit a `visual_review_item`. */
export function judgeRender(
  caseMeta: Record<string, any>,
  bundleDir: string,
  options: JudgePanelOptions,
): Record<string, any> {
  const reviewer = options.reviewer ?? "screenshot-visual-judge";
  const skill = caseMeta.skill ?? "";
  const rawCaseId = String(caseMeta.id ?? caseMeta.case_id ?? "");
  const match = /eval-(\d{3})/.exec(rawCaseId);
  const caseId = match ? `eval-${match[1]}` : rawCaseId;

  const screenshots = listScreenshots(bundleDir);
  const screenshotRel = screenshots.map(repoRelative);
  const reviewedAt = new Date().toISOString();

  const seeds = options.seeds.slice(0, options.nJudges);
  while (seeds.length < options.nJudges) {
    seeds.push(options.seeds[seeds.length % options.seeds.length]);
  }

  const base = {
    skill,
    case_id: caseId,
    reviewer,
    reviewed_at: reviewedAt,
    screenshots: screenshotRel,
    judgeMeta: {
      model: options.model,
      n_judges: options.nJudges,
      seeds,
      aggregation: "median",
      protocol_version: options.protocol,
      screenshot_input_mode: "attached_image_files",
      screenshots_attached: screenshots.length,
    },
  };

  if (!screenshots.length) {
    return fallbackItem(base, {
      status: "not_reviewed",
      blocking: false,
      summary: "Not reviewed: no screenshot.png found in bundle.",
      dimensionsStatus: "not_applicable",
      risks: ["no screenshot.png found in bundle"],
      perJudge: [],
    });
  }

  const systemTemplate = fs.readFileSync(path.join(options.promptsDir, `${options.protocol}.system.txt`), "utf-8");
  const userTemplate = fs.readFileSync(path.join(options.promptsDir, `${options.protocol}.user.txt`), "utf-8");

  const userPrompt = renderTemplate(userTemplate, {
    scenario_id: String(caseMeta.id ?? caseMeta.case_id ?? "(unknown)"),
    scenario_name: String(caseMeta.name ?? "(unnamed)"),
    scenario_description: String(caseMeta.description ?? "(no description)"),
    scenario_prompt: String(caseMeta.prompt ?? "(no prompt)"),
    expected_behaviors: formatList(caseMeta.expected_behaviors),
    visual_expectations: formatList(caseMeta.visual_expectations),
    screenshots: screenshotRel.length ? screenshotRel.map((name) => `- ${name}`).join("\n") : "(no screenshot available)",
    console: summarizeConsole(readJsonOrNull(path.join(bundleDir, "console.json"))),
    scene_state: summarizeJson(readJsonOrNull(path.join(bundleDir, "scene-state.json")), "(no scene state captured)"),
    checks: summarizeChecks(readJsonOrNull(path.join(bundleDir, "programmatic-checks.json"))),
    screenshot_quality: summarizeJson(
      readJsonOrNull(path.join(bundleDir, "screenshot-quality.json")),
      "(no screenshot-quality evidence captured)",
    ),
  });

  const addDir = path.resolve(bundleDir);
  const screenshotFiles = screenshots.map((p) => path.resolve(p));
  const perJudge: Array<Record<string, any>> = [];
  const parsedResults: Array<Record<string, any> | null> = [];

  for (let idx = 0; idx < options.nJudges; idx++) {
    const lens = LENSES[idx % LENSES.length];
    const seed = seeds[idx];
    const systemPrompt = systemTemplate.split("{lens}").join(lens);
    const fullPrompt = `${systemPrompt}\n\n[Deterministic judge seed: ${seed}]\n\n${userPrompt}`;
    const record: Record<string, any> = { judge_index: idx, seed, lens };
    let parsed: Record<string, any> | null = null;
    let raw = "";
    try {
      raw = options.call(fullPrompt, screenshotFiles, [addDir]);
      parsed = parseJudgeJson(raw);
    } catch (exc: any) {
      record.error = `${exc?.constructor?.name ?? "Error"}: ${exc?.message ?? exc}`;
    }

    if (parsed === null) {
      record.parsed = false;
      record.error ??= "unparseable judge response";
      record.raw_excerpt = raw.slice(0, 500);
    } else {
      record.parsed = true;
      record.observed = parsed.observed ?? null;
      record.dimensions = Object.fromEntries(
        Object.keys(DIMENSION_WEIGHTS).map((dim) => {
          const entry = parsed!.dimensions?.[dim] ?? {};
          return [dim, { score: clampScore(entry.score), justification: entry.justification ?? null, failure_modes: entry.failure_modes ?? [] }];
        }),
      );
      record.failure_modes_detected = parsed.failure_modes_detected ?? [];
      record.overall = parsed.overall ?? null;
      record.band = parsed.band ?? null;
      record.confidence = parsed.confidence ?? null;
      record.rationale = parsed.rationale ?? null;
    }
    perJudge.push(record);
    parsedResults.push(parsed);
  }

  const agg = aggregate(parsedResults);
  if (agg.nParsed === 0) {
    return fallbackItem(base, {
      status: "needs_review",
      blocking: true,
      summary: "Judge unavailable: no judge returned a parseable response.",
      dimensionsStatus: "needs_review",
      risks: ["All judges failed or returned unparseable output; manual review required."],
      perJudge,
    });
  }

  return scoredItem(base, options, perJudge, agg);
}

// ---------------------------------------------------------------------------
// item builders
// ---------------------------------------------------------------------------
interface ItemBase {
  skill: string;
  case_id: string;
  reviewer: string;
  reviewed_at: string;
  screenshots: string[];
  judgeMeta: Record<string, any>;
}

function scoredItem(
  base: ItemBase,
  options: JudgePanelOptions,
  perJudge: Array<Record<string, any>>,
  agg: Aggregation,
): Record<string, any> {
  const { dimMedians, flagCounts, nParsed } = agg;
  const majority = Math.floor(nParsed / 2) + 1;
  const weightedSum = Object.entries(DIMENSION_WEIGHTS).reduce((sum, [dim, weight]) => sum + dimMedians[dim] * weight, 0);

  let cap: number | null = null;
  const gatesTriggered: string[] = [];
  const gatedDims = new Set<string>();

  const livenessFlagCount = LIVENESS_FLAG_MODES.reduce((sum, flag) => sum + (flagCounts[flag] ?? 0), 0);
  const subjectFlagCount = SUBJECT_FLAG_MODES.reduce((sum, flag) => sum + (flagCounts[flag] ?? 0), 0);

  if (dimMedians.render_liveness <= 2 || livenessFlagCount >= majority) {
    cap = 2.0;
    gatesTriggered.push("liveness_gate");
    gatedDims.add("render_liveness");
  }
  if (dimMedians.subject_presence_and_recognizability <= 2 || subjectFlagCount >= majority) {
    cap = cap === null ? 3.5 : Math.min(cap, 3.5);
    gatesTriggered.push("subject_gate");
    gatedDims.add("subject_presence_and_recognizability");
  }

  const overallScore = Math.max(0, Math.min(10, round(cap !== null ? Math.min(weightedSum, cap) : weightedSum, 1)));
  const band = bandOf(overallScore);

  const failureFlags = Object.entries(flagCounts)
    .filter(([, count]) => count >= majority)
    .map(([flag]) => flag)
    .sort();
  const blockingFired = failureFlags.some((flag) => BLOCKING_FAILURE_FLAGS.has(flag)) || gatedDims.size > 0;

  let status: string;
  if (blockingFired && failureFlags.length) status = "fail";
  else if (overallScore >= 7.0) status = "pass";
  else if (overallScore >= 5.0) status = "needs_review";
  else status = "fail";

  const bands = perJudge.filter((r) => r.parsed).map((r) => r.band);
  const overalls = perJudge.filter((r) => r.parsed && typeof r.overall === "number").map((r) => r.overall as number);
  const agree = bands.filter((b) => b === band).length;
  const spread = overalls.length >= 2 ? Math.max(...overalls) - Math.min(...overalls) : 0;
  let confidence: string;
  if (!bands.length) confidence = "low";
  else if (agree === bands.length && spread <= 1.5) confidence = "high";
  else if (agree >= Math.max(1, Math.floor(bands.length / 2) + 1) && spread <= 3.0) confidence = "medium";
  else confidence = "low";

  const dimensions = Object.fromEntries(
    Object.entries(dimMedians).map(([dim, score]) => {
      const note = perJudge.find((r) => r.parsed && r.dimensions?.[dim]?.justification)?.dimensions?.[dim]?.justification;
      return [dim, { score, status: dimensionStatus(score, gatedDims.has(dim)), note: note ? String(note).slice(0, 400) : "" }];
    }),
  );

  const risks: string[] = [];
  if (failureFlags.length) risks.push("Consensus failure modes: " + failureFlags.join(", "));
  if (gatesTriggered.length) risks.push("Gates triggered: " + [...new Set(gatesTriggered)].sort().join(", "));
  if (confidence === "low" || band === "BORDERLINE") risks.push("Flagged for human review (low confidence or borderline band).");
  if (nParsed < options.nJudges) risks.push(`Only ${nParsed}/${options.nJudges} judges returned parseable JSON.`);

  const summaryParts = [`${band} (${overallScore}/10, status=${status}).`];
  const rationale = perJudge.find((r) => r.parsed && r.rationale)?.rationale;
  if (rationale) summaryParts.push(String(rationale).slice(0, 500));
  if (failureFlags.length) summaryParts.push("Failure modes: " + failureFlags.join(", ") + ".");

  return {
    skill: base.skill,
    case_id: base.case_id,
    status,
    score: round(overallScore / 10, 4),
    overall_score: overallScore,
    summary: summaryParts.join(" "),
    dimensions,
    failure_flags: failureFlags,
    observations: perJudge.filter((r) => r.parsed && r.observed).map((r) => r.observed),
    risks,
    screenshots: base.screenshots,
    required: true,
    blocking: true,
    reviewer: base.reviewer,
    reviewed_at: base.reviewed_at,
    judge: {
      ...base.judgeMeta,
      band,
      confidence,
      weighted_sum: round(weightedSum, 3),
      cap_applied: cap,
      gates_triggered: [...new Set(gatesTriggered)].sort(),
      n_parsed: nParsed,
      per_judge: perJudge,
    },
  };
}

function fallbackItem(
  base: ItemBase,
  options: {
    status: string;
    blocking: boolean;
    summary: string;
    dimensionsStatus: string;
    risks: string[];
    perJudge: Array<Record<string, any>>;
  },
): Record<string, any> {
  return {
    skill: base.skill,
    case_id: base.case_id,
    status: options.status,
    score: null,
    overall_score: null,
    summary: options.summary,
    dimensions: Object.fromEntries(
      Object.keys(DIMENSION_WEIGHTS).map((dim) => [dim, { score: 0, status: options.dimensionsStatus, note: "not assessed" }]),
    ),
    failure_flags: [],
    observations: [],
    risks: options.risks,
    screenshots: base.screenshots,
    required: true,
    blocking: options.blocking,
    reviewer: base.reviewer,
    reviewed_at: base.reviewed_at,
    judge: { ...base.judgeMeta, per_judge: options.perJudge },
  };
}

/** Canned "live, correct render" response for smoke runs and CI (`--adapter fake`). */
export function fakeJudgeCall(): JudgeCall {
  const canned = JSON.stringify({
    observed: "A loaded 3D globe with the intended subject centered in frame.",
    dimensions: {
      render_liveness: { score: 9, justification: "Loaded textured globe, no black/gray frame.", failure_modes: [] },
      subject_presence_and_recognizability: { score: 8, justification: "Subject clearly identifiable center-frame.", failure_modes: [] },
      framing_and_composition: { score: 8, justification: "Subject fills a meaningful, inspectable fraction.", failure_modes: [] },
      prompt_and_behavior_fidelity: { score: 8, justification: "Viewing geometry matches the prompt.", failure_modes: [] },
      visual_correctness_and_artifacts: { score: 9, justification: "Clean render, no artifacts.", failure_modes: [] },
      legibility_and_clarity: { score: 8, justification: "Overlays readable and uncluttered.", failure_modes: [] },
    },
    failure_modes_detected: [],
    gates_triggered: [],
    weighted_sum: 8.3,
    overall: 8.3,
    band: "PASS",
    confidence: "high",
    rationale: "Live scene with correct, well-framed subject matching the prompt.",
  });
  return () => canned;
}
