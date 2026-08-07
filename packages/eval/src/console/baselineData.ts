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
import { fromRepoRoot, globFiles } from "../lib/paths.js";
import { renderBaselinesCommand } from "../commands/renderBaselines.js";

const FIXTURES_ROOT = () => fromRepoRoot("evaluation", "fixtures");
export const BASELINE_ROOT = "evaluation/artifacts/baselines";

export interface SkillCoverage {
  skill: string;
  cases: number;
  screenshots: number;
  covered: boolean;
}

/** Mirror audit.ts bundleDirFor so coverage is judged where the audit looks. */
function auditBundleDir(evidence: Record<string, any>, skill: string, caseId: string): string {
  const outAbs = fromRepoRoot(BASELINE_ROOT);
  const rel = evidence.run_artifact_path;
  if (!rel) return path.join(outAbs, skill, caseId);
  const parts = String(rel).split(/[\\/]/);
  const baselineIndex = parts.indexOf("baseline");
  return baselineIndex > 0 ? path.join(outAbs, ...parts.slice(baselineIndex - 1)) : path.join(outAbs, path.basename(String(rel)));
}

function baselineFixtures(skill: string): string[] {
  return globFiles(path.join(FIXTURES_ROOT(), skill), "", ".evidence.json");
}

function coverageForSkill(skill: string): SkillCoverage {
  let cases = 0;
  let screenshots = 0;
  for (const fixture of baselineFixtures(skill)) {
    let evidence: Record<string, any>;
    try {
      evidence = JSON.parse(fs.readFileSync(fixture, "utf-8"));
    } catch {
      continue;
    }
    if (typeof evidence.generated_code !== "string" || !evidence.generated_code) continue;
    cases += 1;
    if (fs.existsSync(path.join(auditBundleDir(evidence, skill, String(evidence.case_id ?? "")), "screenshot.png"))) screenshots += 1;
  }
  return { skill, cases, screenshots, covered: cases > 0 && screenshots === cases };
}

export interface BaselineCoverage {
  root: string;
  skills: SkillCoverage[];
  /** Live render activity, so the console can SHOW a render in progress
   * instead of claiming nothing is running while screenshots are produced. */
  rendering: { active: boolean; skill: string | null };
}

export function baselineCoverage(ctx: EvalContext, skills?: string[]): BaselineCoverage {
  const known = fs
    .readdirSync(FIXTURES_ROOT(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
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

export async function renderBaselines(ctx: EvalContext, payload: Record<string, any>): Promise<BaselineCoverage> {
  const requested = Array.isArray(payload.skills) ? payload.skills.map(String) : [];
  if (!requested.length) throw new Error("no skills given to render");
  if (renderingSkill !== null) throw new RenderBusyError("a baseline render is already running");
  renderingSkill = requested.join(",");
  try {
    await renderBaselinesCommand(ctx, { skills: requested.join(","), out: BASELINE_ROOT });
  } finally {
    renderingSkill = null;
  }
  return baselineCoverage(ctx, requested);
}
