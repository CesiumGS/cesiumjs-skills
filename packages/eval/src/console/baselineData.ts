/**
 * Baseline-screenshot coverage + on-demand rendering for the console.
 *
 * A visual study can only judge skills that have rendered baseline
 * screenshots. This reports coverage per skill and renders missing ones so
 * the launcher can guarantee the visual lane actually runs instead of
 * short-circuiting to "incomplete".
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { EvalContext } from "../config/types.js";
import { fromRepoRoot } from "../lib/paths.js";
import { runBaselineBootstrap } from "../commands/renderBaselines.js";
import {
  baselineScenarios,
  baselineSkills,
  bundleScreenshots,
  generatedCodePath,
  isBundleComplete,
  resolveBundleDir,
} from "../evaluation/baselines.js";

export const BASELINE_ROOT = "evaluation/artifacts/baselines";

export interface SkillCoverage {
  skill: string;
  cases: number;
  generated: number;
  screenshots: number;
  /** Bundles carrying every artifact the audit reads, not just a screenshot. */
  auditable: number;
  covered: boolean;
}

/**
 * The repo-relative bundle root a request is talking about.
 *
 * Everything the console measures, renders into, and launches against must
 * name the same directory, so an omitted root resolves to BASELINE_ROOT here
 * rather than being left for a downstream default to invent.
 */
export function normalizeBundleRoot(value: unknown): string {
  if (value === undefined || value === null || value === "") return BASELINE_ROOT;
  const root = String(value);
  if (path.isAbsolute(root) || root.split(/[\\/]/).includes("..")) {
    throw new Error("bundle_root must be a repo-relative path");
  }
  return root;
}

/**
 * Coverage for a skill, counted over the same scenarios the audit will judge
 * and at the same bundle locations it resolves (both via ../evaluation/
 * baselines.js). Reporting a different case set — or a different root — than
 * the audit is what made the launcher promise a visual lane the run could not
 * deliver.
 */
function coverageForSkill(skill: string, bundleRoot: string): SkillCoverage {
  const rootAbs = fromRepoRoot(bundleRoot);
  const scenarios = baselineScenarios(skill);
  let generated = 0;
  let screenshots = 0;
  let auditable = 0;
  for (const scenario of scenarios) {
    if (fs.existsSync(generatedCodePath(scenario))) generated += 1;
    // Any screenshot counts: a multi-shot scenario writes screenshot-0.png,
    // never a plain screenshot.png, and used to read as uncovered forever.
    const bundleDir = resolveBundleDir(scenario, rootAbs);
    if (bundleDir !== null && bundleScreenshots(bundleDir).length > 0) screenshots += 1;
    if (isBundleComplete(scenario, rootAbs)) auditable += 1;
  }
  return {
    skill,
    cases: scenarios.length,
    generated,
    screenshots,
    auditable,
    covered: scenarios.length > 0 && screenshots === scenarios.length,
  };
}

export interface BaselineCoverage {
  /** The root these counts were measured at — the one a launch must judge. */
  root: string;
  skills: SkillCoverage[];
  /** Live render activity, so the console can SHOW a render in progress
   * instead of claiming nothing is running while screenshots are produced. */
  rendering: { active: boolean; skill: string | null };
}

export function baselineCoverage(ctx: EvalContext, skills?: string[], root?: string): BaselineCoverage {
  const bundleRoot = normalizeBundleRoot(root);
  const known = baselineSkills();
  const target = skills && skills.length ? skills.filter((s) => known.includes(s)) : known;
  return {
    root: bundleRoot,
    skills: target.map((skill) => coverageForSkill(skill, bundleRoot)),
    rendering: { active: renderingSkill !== null, skill: renderingSkill },
  };
}

// One render in flight at a time (headless browser + network): a second
// request while one is running is rejected so the launcher can disable
// re-entry rather than spawn overlapping browsers. The active skill is
// exposed via baselineCoverage so any client can see the work happening.
let renderingSkill: string | null = null;
export class RenderBusyError extends Error {}

/** The (harness, provider, model, variant) the console picked for codegen. */
export function baselineCodegenSelection(payload: Record<string, any>): {
  harness?: string;
  provider?: string;
  model?: string;
  variant?: string;
} {
  return {
    harness: payload.codegen_harness ? String(payload.codegen_harness) : undefined,
    provider: payload.codegen_provider ? String(payload.codegen_provider) : undefined,
    model: payload.codegen_model ? String(payload.codegen_model) : undefined,
    variant: payload.codegen_variant ? String(payload.codegen_variant) : undefined,
  };
}

function requestedSkills(payload: Record<string, any>): string[] {
  const requested = Array.isArray(payload.skills) ? payload.skills.map(String) : [];
  if (!requested.length) throw new Error("no skills given to prepare");
  const known = new Set(baselineSkills());
  const unknown = requested.filter((skill) => !known.has(skill));
  if (unknown.length) throw new Error(`unknown baseline skill(s): ${unknown.join(", ")}`);
  return [...new Set(requested)];
}

/** Render bundles for source that already exists. Never spends codegen money:
 * a skill with no generated baseline is reported as uncovered, not silently
 * sent to an agent. Use prepareBaselines for the full bootstrap. */
export async function renderBaselines(ctx: EvalContext, payload: Record<string, any>): Promise<BaselineCoverage> {
  const requested = requestedSkills(payload);
  if (renderingSkill !== null) throw new RenderBusyError("a baseline render is already running");
  renderingSkill = requested.join(",");
  try {
    await runBaselineBootstrap(ctx, { skills: requested.join(","), out: BASELINE_ROOT, skipCodegen: true });
  } finally {
    renderingSkill = null;
  }
  return baselineCoverage(ctx, requested);
}

/** Complete clean-checkout bootstrap: generate any missing current-best
 * baseline JS with the configured codegen agent, then render it into complete
 * evidence bundles at the exact root the audit consumes. Existing source and
 * bundles remain cached, so retrying resumes rather than starting over.
 *
 * Partial success is success: the returned coverage reports exactly what
 * landed, and only a run that produced nothing at all is an error. Failing the
 * whole request because one scenario of forty broke would discard the other
 * thirty-nine and force the operator to start over. */
export async function prepareBaselines(ctx: EvalContext, payload: Record<string, any>): Promise<BaselineCoverage> {
  const requested = requestedSkills(payload);
  if (renderingSkill !== null) throw new RenderBusyError("a baseline preparation is already running");
  renderingSkill = requested.join(",");
  try {
    const codegen = baselineCodegenSelection(payload);
    const summary = await runBaselineBootstrap(ctx, {
      skills: requested.join(","),
      out: BASELINE_ROOT,
      codegenHarness: codegen.harness,
      codegenProvider: codegen.provider,
      codegenModel: codegen.model,
      codegenVariant: codegen.variant,
    });
    if (summary.complete === 0) {
      const reason = summary.failures[0]?.reason ?? "no bundles were produced";
      throw new Error(`baseline preparation produced no usable bundles for ${requested.join(", ")}: ${reason}`);
    }
  } finally {
    renderingSkill = null;
  }
  return baselineCoverage(ctx, requested);
}
