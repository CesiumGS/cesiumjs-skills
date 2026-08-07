/**
 * `cesium-eval render-baselines` — the blank run: take a clean checkout to a
 * complete set of baseline evidence bundles that `cesium-eval audit` can score.
 *
 * Three things must be true before the audit can say anything about a
 * scenario, and this command establishes all three in one pass:
 *
 *   1. generated baseline source exists (optimization/generated/<skill>/baseline),
 *   2. that source ran in a headless browser,
 *   3. the run left a COMPLETE bundle behind — not just a screenshot, but the
 *      console log, the programmatic checks, the scene state and the metadata
 *      the deterministic lane reads.
 *
 * (3) is why this delegates to the optimization browser runner instead of
 * carrying its own miniature harness: a screenshot-only bundle satisfied the
 * visual judge but failed every execution-health check, so a freshly
 * "rendered" baseline could never pass its own audit.
 *
 * The pass is resumable by design. Everything already complete is kept, only
 * the gaps are filled, and a failure in one scenario neither hides the others
 * nor stops them. `--force` re-renders, `--regenerate` re-generates the source
 * too.
 *
 * The Ion token is OPTIONAL here: scenarios that bring their own imagery
 * (OpenStreetMap, custom providers) render fully without it, and Ion-dependent
 * ones still render a globe. Set CESIUM_ION_TOKEN to render those faithfully.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, isUnder, repoRelative } from "../lib/paths.js";
import type { EvalContext } from "../config/types.js";
import { renderCommand, type RenderFailure } from "../optimization/browserRunner.js";
import { generateBaselinesCommand } from "./optimize.js";
import {
  baselineScenarios,
  baselineSkills,
  bundleDirFor,
  generatedCodePath,
  isBundleFullyRendered,
  readGeneratedCode,
  resolveBundleDir,
  type BaselineScenario,
} from "../evaluation/baselines.js";

/** Default output root: exactly where `audit` looks when given no --bundle-root. */
export const DEFAULT_OUT = "optimization/runs";

export interface RenderBaselinesOptions {
  skills?: string;
  out?: string;
  only?: string;
  /** Re-render bundles that are already complete. */
  force?: boolean;
  /** Re-generate the baseline source before rendering (implies --force). */
  regenerate?: boolean;
  /** Never invoke the codegen agent; report missing source instead. */
  skipCodegen?: boolean;
  codegenHarness?: string;
  codegenProvider?: string;
  codegenModel?: string;
  codegenVariant?: string;
}

/**
 * What each scenario still needs:
 *   complete  — a full bundle is already on disk; nothing to do
 *   render    — source exists, the bundle does not (or --force)
 *   generate  — no source yet, so codegen has to run before the render
 */
export type BaselineWorkState = "complete" | "render" | "generate";

export interface BaselineWorkItem {
  skill: string;
  caseId: string;
  scenario: BaselineScenario;
  /** The bundle already on disk, or null when nothing is rendered. */
  bundleDir: string | null;
  state: BaselineWorkState;
}

export interface PlanOptions {
  bundleRoot: string;
  only?: Set<string> | null;
  force?: boolean;
  regenerate?: boolean;
}

/**
 * Classify every selected scenario. Pure over the filesystem and separated
 * from the doing so the plan can be asserted directly: the console, the CLI
 * and the tests all need to agree on what "already done" means.
 */
export function planBaselineWork(skills: string[], options: PlanOptions): BaselineWorkItem[] {
  const force = Boolean(options.force || options.regenerate);
  const items: BaselineWorkItem[] = [];
  for (const skill of skills) {
    for (const scenario of baselineScenarios(skill)) {
      if (options.only && !options.only.has(scenario.id)) continue;
      const bundleDir = resolveBundleDir(scenario, options.bundleRoot);
      const hasCode = readGeneratedCode(scenario) !== null;
      let state: BaselineWorkState;
      if (!force && isBundleFullyRendered(bundleDir)) state = "complete";
      else if (!hasCode || options.regenerate) state = "generate";
      else state = "render";
      items.push({ skill, caseId: scenario.id, scenario, bundleDir, state });
    }
  }
  return items;
}

export interface BaselineFailure {
  skill: string;
  case_id: string;
  reason: string;
}

export interface BaselineBootstrapSummary {
  out_root: string;
  /** Scenarios selected by --skills/--only. */
  total: number;
  /** Selected scenarios that now have a complete bundle. */
  complete: number;
  /** Complete before this run started (nothing was re-done for them). */
  cached: number;
  /** Scenarios whose source was (re)generated in this run. */
  generated: number;
  failures: BaselineFailure[];
}

/** A bad invocation (unknown skill, empty selection, unusable --out): exit 2,
 * so a mistyped flag never reads as an evaluation failure. */
export class BaselineUsageError extends Error {}

function resolveSkills(spec: string | undefined): string[] {
  const available = baselineSkills();
  if (!spec || spec.trim().toLowerCase() === "all") return available;
  const requested = spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = requested.filter((skill) => !available.includes(skill));
  if (unknown.length) throw new BaselineUsageError(`unknown skill(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`);
  return [...new Set(requested)];
}

function parseOnly(spec: string | undefined): Set<string> | null {
  if (!spec) return null;
  const ids = spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

const bySkill = (items: BaselineWorkItem[]): Map<string, BaselineWorkItem[]> => {
  const grouped = new Map<string, BaselineWorkItem[]>();
  for (const item of items) {
    const bucket = grouped.get(item.skill);
    if (bucket) bucket.push(item);
    else grouped.set(item.skill, [item]);
  }
  return grouped;
};

/**
 * Generate, render and verify — the whole bootstrap, as data.
 *
 * Returns a summary rather than an exit code so callers that are not a CLI
 * (the console's prepare endpoint) can react to PARTIAL success instead of
 * being handed a single pass/fail bit and having to guess what happened.
 */
export async function runBaselineBootstrap(
  ctx: EvalContext,
  options: RenderBaselinesOptions,
): Promise<BaselineBootstrapSummary> {
  if (options.skipCodegen && options.regenerate) {
    throw new BaselineUsageError("--skip-codegen and --regenerate contradict each other: one forbids codegen, the other requires it");
  }
  const skills = resolveSkills(options.skills);
  const outRoot = options.out ?? DEFAULT_OUT;
  const outAbs = fromRepoRoot(outRoot);
  // The eval page is served from the repo root, so bundles written outside it
  // are unreachable to the browser: every render would 404 and every bundle
  // would look inexplicably broken.
  if (!isUnder(outAbs, ctx.repoRoot)) {
    throw new BaselineUsageError(`--out must be inside the repository (got ${outRoot}); the rendered eval page is served from the repo root`);
  }
  const items = planBaselineWork(skills, {
    bundleRoot: outAbs,
    only: parseOnly(options.only),
    force: options.force,
    regenerate: options.regenerate,
  });
  if (!items.length) throw new BaselineUsageError(`no baseline scenarios selected (skills=${skills.join(",")}${options.only ? `, only=${options.only}` : ""})`);

  const failures: BaselineFailure[] = [];
  const failedKeys = new Set<string>();
  const key = (item: { skill: string; caseId: string }) => `${item.skill}/${item.caseId}`;
  // First reason wins: a scenario that failed codegen must not also be
  // reported as a missing bundle, which is the same fact stated twice.
  const addFailure = (item: BaselineWorkItem, reason: string): void => {
    if (failedKeys.has(key(item))) return;
    failedKeys.add(key(item));
    failures.push({ skill: item.skill, case_id: item.caseId, reason });
  };
  const cached = items.filter((item) => item.state === "complete").length;
  console.log(`[render-baselines] ${items.length} scenario(s) across ${skills.length} skill(s): ${cached} already complete, ${items.length - cached} to do -> ${outRoot}`);

  // --- 1. source ------------------------------------------------------------
  let generated = 0;
  const needCode = items.filter((item) => item.state === "generate");
  if (needCode.length && options.skipCodegen) {
    for (const item of needCode) {
      addFailure(item, `no generated baseline source at ${repoRelative(generatedCodePath(item.scenario))} (drop --skip-codegen to generate it)`);
    }
  } else if (needCode.length) {
    for (const [skill, skillItems] of bySkill(needCode)) {
      console.log(`[render-baselines] ${skill}: generating baseline source for ${skillItems.length} scenario(s)`);
      // A non-zero exit means SOME scenario failed, not all: which ones is
      // recovered below by looking at what actually landed on disk.
      await generateBaselinesCommand(ctx, {
        skill,
        iteration: "baseline",
        only: skillItems.map((item) => item.caseId).join(","),
        force: options.regenerate,
        harness: options.codegenHarness,
        provider: options.codegenProvider,
        model: options.codegenModel,
        variant: options.codegenVariant,
      });
    }
    for (const item of needCode) {
      if (readGeneratedCode(item.scenario) !== null) generated += 1;
      else addFailure(item, `codegen produced no source at ${repoRelative(generatedCodePath(item.scenario))}`);
    }
  }

  // --- 2. render ------------------------------------------------------------
  const toRender = items.filter((item) => item.state !== "complete" && !failedKeys.has(key(item)));
  for (const [skill, skillItems] of bySkill(toRender)) {
    console.log(`[render-baselines] ${skill}: rendering ${skillItems.length} bundle(s)`);
    try {
      // Same iteration label the generator writes ("baseline") and the same
      // directory layout the audit resolves, so a rendered bundle is always
      // the one judged.
      const renderFailures: RenderFailure[] = [];
      const code = await renderCommand(ctx, {
        skill,
        iteration: "baseline",
        outputDir: repoRelative(path.join(outAbs, skill, "baseline")),
        only: skillItems.map((item) => item.caseId).join(","),
        allowMissingIonToken: true,
        failures: renderFailures,
      });
      // A scenario whose render failed is NOT satisfied by whatever is on
      // disk: re-rendering writes into the existing directory, so a --force
      // retry that dies leaves the previous bundle intact and complete-looking.
      // Without this the stale bundle would be counted as a fresh success.
      const byCaseId = new Map(skillItems.map((item) => [item.caseId, item]));
      for (const failure of renderFailures) {
        const item = byCaseId.get(failure.scenario_id);
        if (item) addFailure(item, `render failed: ${failure.error}`);
      }
      // Non-zero with nothing named (no runnable scenarios, an unusable output
      // directory) is a whole-batch failure — attribute it rather than let the
      // disk answer for it.
      if (code !== 0 && !renderFailures.length) {
        for (const item of skillItems) addFailure(item, `render exited ${code}`);
      }
    } catch (exc: any) {
      // A whole-skill failure (browser launch, invalid Ion token) is attributed
      // to every scenario it was supposed to cover rather than swallowed.
      const message = exc?.message ?? String(exc);
      console.error(`[render-baselines] ${skill}: render failed: ${message}`);
      for (const item of skillItems) addFailure(item, `render failed: ${message}`);
    }
  }

  // --- 3. verify ------------------------------------------------------------
  // The disk is necessary but not sufficient. A bundle counts as complete only
  // if it holds everything both audit lanes read AND nothing failed producing
  // it this run — otherwise a stale directory left by a failed re-render would
  // report as a fresh success.
  const results = items.map((item) => {
    const bundleDir = resolveBundleDir(item.scenario, outAbs);
    const onDisk = isBundleFullyRendered(bundleDir);
    if (!onDisk) {
      addFailure(
        item,
        bundleDir === null
          ? `no bundle at ${repoRelative(bundleDirFor(item.scenario, outAbs))}`
          : `incomplete bundle at ${repoRelative(bundleDir)} (missing screenshot or evidence files)`,
      );
    }
    const failed = failedKeys.has(key(item));
    if (onDisk && failed && item.state !== "complete") {
      console.error(`[render-baselines] ${key(item)}: bundle on disk is from an earlier run; this render did not replace it`);
    }
    return {
      skill: item.skill,
      case_id: item.caseId,
      state: item.state,
      /** Present and whole on disk — but see `complete` for whether THIS run produced it. */
      bundle_on_disk: onDisk,
      complete: onDisk && !failed,
      bundle_dir: bundleDir !== null ? repoRelative(bundleDir) : null,
    };
  });

  const complete = results.filter((result) => result.complete).length;
  const summary: BaselineBootstrapSummary = {
    out_root: outRoot,
    total: items.length,
    complete,
    cached,
    generated,
    failures,
  };
  fs.mkdirSync(outAbs, { recursive: true });
  writeJsonPlain(path.join(outAbs, "baseline-manifest.json"), { out_root: outRoot, summary, results });
  return summary;
}

export async function renderBaselinesCommand(ctx: EvalContext, options: RenderBaselinesOptions): Promise<number> {
  let summary: BaselineBootstrapSummary;
  try {
    summary = await runBaselineBootstrap(ctx, options);
  } catch (exc: any) {
    console.error(`[render-baselines] error: ${exc?.message ?? exc}`);
    return exc instanceof BaselineUsageError ? 2 : 1;
  }

  for (const failure of summary.failures) {
    console.error(`[render-baselines] ${failure.skill}/${failure.case_id}: ${failure.reason}`);
  }
  console.log(
    `[render-baselines] ${summary.complete}/${summary.total} complete bundles ` +
      `(${summary.cached} cached, ${summary.generated} newly generated) -> ${summary.out_root}`,
  );
  if (summary.complete < summary.total) {
    console.error(`[render-baselines] ${summary.total - summary.complete} scenario(s) have no usable bundle; the audit will score them as failures.`);
  }
  const audit = `cesium-eval audit --skills ${options.skills ?? "all"}${summary.out_root === DEFAULT_OUT ? "" : ` --bundle-root ${summary.out_root}`}`;
  console.log(`[render-baselines] next: ${audit}`);
  return summary.complete === summary.total ? 0 : 1;
}
