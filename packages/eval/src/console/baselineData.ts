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
import { renderBaselinesCommand } from "../commands/renderBaselines.js";
import { generateBaselinesCommand, type GenerateBaselinesOptions } from "../commands/optimize.js";
import { baselineScenarios, baselineSkills, generatedCodePath, resolveBundleDir } from "../evaluation/baselines.js";

export const BASELINE_ROOT = "evaluation/artifacts/baselines";

export interface SkillCoverage {
  skill: string;
  cases: number;
  generated: number;
  screenshots: number;
  covered: boolean;
}

/**
 * Coverage for a skill, counted over the same scenarios the audit will judge
 * and at the same bundle locations it resolves (both via ../evaluation/
 * baselines.js). Reporting a different case set than the audit is what made
 * the launcher promise a visual lane the run could not deliver.
 */
function coverageForSkill(skill: string): SkillCoverage {
  const bundleRoot = fromRepoRoot(BASELINE_ROOT);
  const scenarios = baselineScenarios(skill);
  let generated = 0;
  let screenshots = 0;
  for (const scenario of scenarios) {
    if (fs.existsSync(generatedCodePath(scenario))) generated += 1;
    const bundleDir = resolveBundleDir(scenario, bundleRoot);
    if (bundleDir !== null && fs.existsSync(path.join(bundleDir, "screenshot.png"))) screenshots += 1;
  }
  return {
    skill,
    cases: scenarios.length,
    generated,
    screenshots,
    covered: scenarios.length > 0 && screenshots === scenarios.length,
  };
}

export interface BaselineCoverage {
  root: string;
  skills: SkillCoverage[];
  /** Live render activity, so the console can SHOW a render in progress
   * instead of claiming nothing is running while screenshots are produced. */
  rendering: { active: boolean; skill: string | null };
}

export function baselineCoverage(ctx: EvalContext, skills?: string[]): BaselineCoverage {
  const known = baselineSkills();
  const target = skills && skills.length ? skills.filter((s) => known.includes(s)) : known;
  return {
    root: BASELINE_ROOT,
    skills: target.map(coverageForSkill),
    rendering: { active: renderingSkill !== null, skill: renderingSkill },
  };
}

// One render in flight at a time (headless browser + network): a second
// request while one is running is rejected so the launcher can disable
// re-entry rather than spawn overlapping browsers. The active skill is
// exposed via baselineCoverage so any client can see the work happening.
let renderingSkill: string | null = null;
export class RenderBusyError extends Error {}

export function baselineGenerationOptions(payload: Record<string, any>, skill: string): GenerateBaselinesOptions {
  return {
    skill,
    iteration: "baseline",
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

export async function renderBaselines(ctx: EvalContext, payload: Record<string, any>): Promise<BaselineCoverage> {
  const requested = requestedSkills(payload);
  if (renderingSkill !== null) throw new RenderBusyError("a baseline render is already running");
  renderingSkill = requested.join(",");
  try {
    await renderBaselinesCommand(ctx, { skills: requested.join(","), out: BASELINE_ROOT });
  } finally {
    renderingSkill = null;
  }
  return baselineCoverage(ctx, requested);
}

/** Complete clean-checkout bootstrap: generate any missing current-best
 * baseline JS with the configured codegen agent, then render screenshots into
 * the exact bundle root consumed by the audit. Existing JS/screenshots remain
 * cached, so retrying resumes rather than starting over. */
export async function prepareBaselines(ctx: EvalContext, payload: Record<string, any>): Promise<BaselineCoverage> {
  const requested = requestedSkills(payload);
  if (renderingSkill !== null) throw new RenderBusyError("a baseline preparation is already running");
  renderingSkill = requested.join(",");
  try {
    for (const skill of requested) {
      const generationCode = await generateBaselinesCommand(ctx, baselineGenerationOptions(payload, skill));
      if (generationCode !== 0) throw new Error(`baseline generation failed for ${skill}`);
    }
    const renderCode = await renderBaselinesCommand(ctx, { skills: requested.join(","), out: BASELINE_ROOT });
    if (renderCode !== 0) throw new Error(`baseline rendering produced no usable screenshots for ${requested.join(", ")}`);
  } finally {
    renderingSkill = null;
  }
  return baselineCoverage(ctx, requested);
}
