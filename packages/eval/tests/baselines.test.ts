/**
 * The console and the audit must agree about which baseline cases exist and
 * where their screenshots live. They drifted once — the console counted a
 * fixture set the audit no longer audited, so the launcher promised a visual
 * lane the run could not deliver. These tests pin the shared contract.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import { allSkills } from "../src/commands/audit.js";
import { BASELINE_ROOT, baselineCoverage, baselineGenerationOptions, normalizeBundleRoot } from "../src/console/baselineData.js";
import { launchRun } from "../src/console/liveData.js";
import {
  BUNDLE_EVIDENCE_FILES,
  baselineScenarios,
  baselineSkills,
  bundleDirFor,
  isBundleComplete,
  resolveBundleDir,
} from "../src/evaluation/baselines.js";

const ctx = loadContext();

// Scratch bundle roots live under the gitignored artifacts tree so a test root
// is never mistaken for a real one.
const scratchRoots: string[] = [];
function scratchRoot(label: string): string {
  const root = path.join("evaluation/artifacts", `test-${label}-${process.pid}`);
  fs.mkdirSync(path.join(ctx.repoRoot, root), { recursive: true });
  scratchRoots.push(root);
  return root;
}
afterAll(() => {
  for (const root of scratchRoots) fs.rmSync(path.join(ctx.repoRoot, root), { recursive: true, force: true });
});

describe("baseline scenario contract", () => {
  it("exposes the same skill set to the audit and the console", () => {
    expect(baselineSkills()).toEqual(allSkills());
    expect(baselineSkills().length).toBeGreaterThan(0);
  });

  it("reports console coverage over exactly the cases the audit will judge", () => {
    const coverage = baselineCoverage(ctx);
    const bySkill = new Map(coverage.skills.map((s) => [s.skill, s.cases]));
    for (const skill of baselineSkills()) {
      expect(bySkill.get(skill)).toBe(baselineScenarios(skill).length);
    }
  });

  it("never counts more screenshots than cases", () => {
    for (const skill of baselineCoverage(ctx).skills) {
      expect(skill.generated).toBeLessThanOrEqual(skill.cases);
      expect(skill.screenshots).toBeLessThanOrEqual(skill.cases);
      expect(skill.covered).toBe(skill.cases > 0 && skill.screenshots === skill.cases);
    }
  });

  it("passes the console codegen selection through to baseline generation", () => {
    expect(
      baselineGenerationOptions(
        {
          codegen_harness: "codex",
          codegen_provider: "openai",
          codegen_model: "gpt-5.6",
          codegen_variant: "high",
        },
        "cesiumjs-camera",
      ),
    ).toEqual({
      skill: "cesiumjs-camera",
      iteration: "baseline",
      harness: "codex",
      provider: "openai",
      model: "gpt-5.6",
      variant: "high",
    });
  });

  it("gives every scenario a unique, stable bundle directory", () => {
    for (const skill of baselineSkills()) {
      const dirs = baselineScenarios(skill).map((s) => bundleDirFor(s, "/tmp/root"));
      expect(new Set(dirs).size).toBe(dirs.length);
      // Deterministic: the same scenario always resolves to the same path.
      for (const scenario of baselineScenarios(skill)) {
        expect(bundleDirFor(scenario, "/tmp/root")).toBe(bundleDirFor(scenario, "/tmp/root"));
      }
    }
  });

  it("separates a screenshot-covered bundle from an auditable one", () => {
    const root = scratchRoot("complete");
    const rootAbs = path.join(ctx.repoRoot, root);
    const scenario = baselineScenarios(baselineSkills()[0])[0];
    const dir = bundleDirFor(scenario, rootAbs);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, "screenshot.png"), "");
    // A screenshot is enough for the visual lane and NOT enough for the
    // deterministic one — the two predicates must stay distinct.
    expect(isBundleComplete(scenario, rootAbs)).toBe(false);
    expect(baselineCoverage(ctx, [scenario.skill], root).skills[0].screenshots).toBe(1);
    expect(baselineCoverage(ctx, [scenario.skill], root).skills[0].auditable).toBe(0);

    for (const file of BUNDLE_EVIDENCE_FILES) fs.writeFileSync(path.join(dir, file), "");
    expect(isBundleComplete(scenario, rootAbs)).toBe(true);
    expect(baselineCoverage(ctx, [scenario.skill], root).skills[0].auditable).toBe(1);
  });

  it("resolves a rendered bundle to a directory that really holds its screenshot", () => {
    const root = path.join(ctx.repoRoot, "evaluation/artifacts/baselines");
    let checked = 0;
    for (const skill of baselineSkills()) {
      for (const scenario of baselineScenarios(skill)) {
        const dir = resolveBundleDir(scenario, root);
        if (dir === null) continue;
        expect(fs.statSync(dir).isDirectory()).toBe(true);
        checked += 1;
      }
    }
    // Nothing to assert about counts (a fresh checkout renders none), but any
    // bundle that does resolve must be a real directory.
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});

/**
 * The coverage guard and the audit it launches must judge one directory.
 * They did not: coverage always counted `evaluation/artifacts/baselines`
 * while an omitted bundle_root let the child audit fall back to
 * `optimization/runs/<skill>/baseline`, so a guard satisfied by partial
 * coverage cleared a run that scored a different (often empty) tree.
 */
describe("launch bundle root", () => {
  it("defaults an omitted root to the one coverage measures", () => {
    expect(normalizeBundleRoot(undefined)).toBe(BASELINE_ROOT);
    expect(normalizeBundleRoot(null)).toBe(BASELINE_ROOT);
    expect(normalizeBundleRoot("")).toBe(BASELINE_ROOT);
    expect(baselineCoverage(ctx, undefined).root).toBe(BASELINE_ROOT);
  });

  it("keeps a caller-supplied root, and refuses one that escapes the repo", () => {
    expect(normalizeBundleRoot("optimization/runs")).toBe("optimization/runs");
    expect(() => normalizeBundleRoot("/etc")).toThrow(/repo-relative/);
    expect(() => normalizeBundleRoot("../elsewhere")).toThrow(/repo-relative/);
  });

  it("counts coverage at the root it is asked about, not a fixed one", () => {
    const root = scratchRoot("measured");
    const scenario = baselineScenarios(baselineSkills()[0])[0];
    const dir = bundleDirFor(scenario, path.join(ctx.repoRoot, root));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "screenshot.png"), "");

    const measured = baselineCoverage(ctx, [scenario.skill], root);
    expect(measured.root).toBe(root);
    expect(measured.skills[0].screenshots).toBe(1);
    // The same skill at an empty root reports nothing: coverage follows the
    // root, so the guard can never vouch for a directory the audit won't read.
    const elsewhere = baselineCoverage(ctx, [scenario.skill], scratchRoot("empty"));
    expect(elsewhere.skills[0].screenshots).toBe(0);
  });

  it("rejects a visual launch whose own bundle root holds no screenshots", () => {
    const root = scratchRoot("unrendered");
    const skill = baselineSkills()[0];
    // Previously the guard was skipped whenever a custom root was given, so
    // this launch started and landed 'incomplete' with nothing to judge.
    expect(() => launchRun(ctx, { skills: [skill], judge: true, bundle_root: root })).toThrow(
      `baseline screenshots under ${root}`,
    );
  });

  it("rejects a bundle root that does not exist", () => {
    expect(() => launchRun(ctx, { skills: [baselineSkills()[0]], judge: true, bundle_root: "evaluation/artifacts/nope" })).toThrow(
      /bundle_root does not exist/,
    );
  });
});
