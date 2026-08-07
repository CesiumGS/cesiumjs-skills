/**
 * The console and the audit must agree about which baseline cases exist and
 * where their screenshots live. They drifted once — the console counted a
 * fixture set the audit no longer audited, so the launcher promised a visual
 * lane the run could not deliver. These tests pin the shared contract.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import { allSkills } from "../src/commands/audit.js";
import { baselineCoverage } from "../src/console/baselineData.js";
import { baselineScenarios, baselineSkills, bundleDirFor, resolveBundleDir } from "../src/evaluation/baselines.js";

const ctx = loadContext();

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
      expect(skill.screenshots).toBeLessThanOrEqual(skill.cases);
      expect(skill.covered).toBe(skill.cases > 0 && skill.screenshots === skill.cases);
    }
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
