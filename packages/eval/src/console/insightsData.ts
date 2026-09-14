/**
 * Harness/model registry + observed model-by-harness insights for the console.
 * DECLARED comes from config/harness-registry.json with live pipeline defaults
 * overlaid; OBSERVED aggregates per-iteration codegen provenance from the
 * `*.meta.json` sidecars joined with each iteration's decision/counts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonOrNull } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs } from "../lib/paths.js";
import { parseTs } from "../lib/format.js";
import { resolveModel } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";
import { listSkills } from "./optimizationData.js";

const generatedRoot = () => fromRepoRoot("optimization", "generated");

export const UNRECORDED = "unrecorded";

// ---------------------------------------------------------------------------
// DECLARED — registry + live pipeline defaults
// ---------------------------------------------------------------------------
export function registry(ctx: EvalContext): Record<string, any> {
  const doc = structuredClone(ctx.registry) as Record<string, any>;
  for (const harness of doc.harnesses ?? []) {
    try {
      const agent = { role: "codegen" as const, harness: ctx.harness(harness.id), model: null, variant: null, timeoutSeconds: 0 };
      harness.default_model = resolveModel(agent);
      harness.default_effort = ctx.harness(harness.id).default_effort;
      harness.defaults_source = "live (driver discovery + registry)";
    } catch {
      harness.defaults_source = "registry fallback";
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// OBSERVED — per-iteration codegen provenance from generated *.meta.json
// ---------------------------------------------------------------------------
export function iterationProvenance(skill: string, iteration: string): Record<string, any> | null {
  const iterDir = path.join(generatedRoot(), skill, String(iteration));
  if (!fs.existsSync(iterDir)) return null;
  const combos = new Map<string, { count: number; harness: unknown; model: unknown; variant: unknown }>();
  let temperature: number | null = null;
  for (const metaPath of globFiles(iterDir, "", ".meta.json")) {
    const meta = readJsonOrNull(metaPath);
    if (meta === null) continue;
    const key = JSON.stringify([meta.harness ?? null, meta.model_id ?? null, meta.model_variant ?? null]);
    const existing = combos.get(key);
    if (existing) existing.count += 1;
    else combos.set(key, { count: 1, harness: meta.harness ?? null, model: meta.model_id ?? null, variant: meta.model_variant ?? null });
    if (temperature === null && typeof meta.temperature === "number") temperature = meta.temperature;
  }
  if (!combos.size) return null;
  let best: { count: number; harness: unknown; model: unknown; variant: unknown } | null = null;
  for (const combo of combos.values()) {
    if (!best || combo.count > best.count) best = combo;
  }
  return {
    harness: best!.harness,
    model_id: best!.model,
    model_variant: best!.variant,
    temperature,
    mixed: combos.size > 1,
  };
}

function durationSeconds(summary: Record<string, any>): number | null {
  const started = parseTs(summary.started_utc);
  const finished = parseTs(summary.finished_utc);
  if (started === null || finished === null) return null;
  const delta = (finished.getTime() - started.getTime()) / 1000;
  return delta >= 0 ? delta : null;
}

function winRate(summary: Record<string, any>): number | null {
  const counts = summary.counts ?? {};
  const wins = counts.wins ?? 0;
  const losses = counts.losses ?? 0;
  const denom = wins + losses;
  return denom ? wins / denom : null;
}

function sampleStddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
}

function newer(a: string | null, b: string | null): string | null {
  const da = parseTs(a);
  const db = parseTs(b);
  if (da === null) return db !== null ? b : null;
  if (db === null) return a;
  return da >= db ? a : b;
}

function runActivityByCombo(runs: Array<Record<string, any>>): Map<string, string> {
  const latest = new Map<string, string>();
  for (const run of runs) {
    const harness = run.harness;
    const model = run.model;
    if (!(typeof harness === "string" && harness.trim()) || !(typeof model === "string" && model.trim())) continue;
    const variant = typeof run.model_variant === "string" ? run.model_variant.trim() : "";
    const key = JSON.stringify([harness.trim(), model.trim(), variant]);
    const ts = run.timestamp_utc;
    if (typeof ts === "string" && ts.trim()) {
      latest.set(key, newer(latest.get(key) ?? null, ts) ?? ts);
    }
  }
  return latest;
}

/** Observed performance grouped by (harness, model, effort) combination. */
export function comboInsights(ctx: EvalContext, runs: Array<Record<string, any>> = []): Array<Record<string, any>> {
  const rows = new Map<string, Record<string, any>>();
  for (const overview of listSkills(ctx.config.liveness.runningMaxAgeSeconds)) {
    const skill = overview.skill;
    for (const summary of overview.history) {
      if (summary.is_baseline) continue;
      const prov = iterationProvenance(skill, summary.iteration);
      const harness = prov?.harness ?? UNRECORDED;
      const model = prov?.model_id ?? UNRECORDED;
      const variant = prov?.model_variant ?? null;
      const key = JSON.stringify([harness, model, variant ?? ""]);
      let row = rows.get(key);
      if (!row) {
        row = {
          harness,
          model_id: model,
          model_variant: variant,
          iterations: 0,
          keeps: 0,
          rejects: 0,
          undecided: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          win_rates: [] as number[],
          durations: [] as number[],
          skills: new Set<string>(),
          first_used: null as string | null,
          last_used: null as string | null,
          members: [] as Array<Record<string, any>>,
        };
        rows.set(key, row);
      }
      row.iterations += 1;
      const decision = summary.decision;
      if (decision === "KEEP") row.keeps += 1;
      else if (decision === "REJECT") row.rejects += 1;
      else row.undecided += 1;
      const counts = summary.counts ?? {};
      row.wins += counts.wins ?? 0;
      row.losses += counts.losses ?? 0;
      row.ties += counts.ties ?? 0;
      const rate = winRate(summary);
      if (rate !== null) row.win_rates.push(rate);
      const duration = durationSeconds(summary);
      if (duration !== null) row.durations.push(duration);
      row.skills.add(skill);
      const ts = summary.started_utc ?? summary.finished_utc;
      if (ts) {
        if (row.first_used === null || ts < row.first_used) row.first_used = ts;
        if (row.last_used === null || ts > row.last_used) row.last_used = ts;
      }
      row.members.push({
        skill,
        iteration: summary.iteration,
        decision: decision ?? null,
        status: summary.status ?? null,
        win_rate: rate,
        started_utc: summary.started_utc ?? null,
      });
    }
  }

  const out: Array<Record<string, any>> = [];
  for (const row of rows.values()) {
    const winRates: number[] = row.win_rates;
    const durations: number[] = row.durations;
    const decided = row.keeps + row.rejects;
    const denom = row.wins + row.losses;
    out.push({
      harness: row.harness,
      model_id: row.model_id,
      model_variant: row.model_variant,
      iterations: row.iterations,
      keeps: row.keeps,
      rejects: row.rejects,
      undecided: row.undecided,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      skills: [...row.skills].sort(),
      first_used: row.first_used,
      last_used: row.last_used,
      keep_rate: decided ? row.keeps / decided : null,
      win_rate: denom ? row.wins / denom : null,
      win_rate_stddev: sampleStddev(winRates),
      scored_iterations: winRates.length,
      mean_duration_s: durations.length ? durations.reduce((sum, v) => sum + v, 0) / durations.length : null,
      members: [...row.members].sort((a, b) => {
        const ta = a.started_utc ?? "";
        const tb = b.started_utc ?? "";
        if (ta !== tb) return ta < tb ? 1 : -1;
        return a.skill < b.skill ? 1 : -1;
      }),
    });
  }

  const runActivity = runActivityByCombo(runs);
  for (const combo of out) {
    const key = JSON.stringify([combo.harness, combo.model_id, combo.model_variant ?? ""]);
    combo.last_evaluated = runActivity.get(key) ?? null;
    combo.last_active = newer(combo.last_used, combo.last_evaluated);
  }
  out.sort((a, b) => {
    if ((a.harness === UNRECORDED) !== (b.harness === UNRECORDED)) return a.harness === UNRECORDED ? 1 : -1;
    if (a.iterations !== b.iterations) return b.iterations - a.iterations;
    return a.model_id < b.model_id ? -1 : a.model_id > b.model_id ? 1 : 0;
  });
  return out;
}

export function insights(ctx: EvalContext, runs: Array<Record<string, any>> = []): Record<string, any> {
  return { combos: comboInsights(ctx, runs) };
}
