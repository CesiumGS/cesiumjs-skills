/**
 * The blank run: from a clean checkout to bundles the audit can score.
 *
 * The failure this pins down is a bundle that holds only a screenshot. It
 * satisfied the visual judge and failed every execution-health check, so a
 * freshly "rendered" baseline could never pass its own audit. "Complete" is
 * one definition, shared by the planner, the loop and the audit.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import { auditCommand } from "../src/commands/audit.js";
import { planBaselineWork, runBaselineBootstrap } from "../src/commands/renderBaselines.js";
import { BUNDLE_ARTIFACTS, baselineScenarios, bundleDirFor, isBundleFullyRendered } from "../src/evaluation/baselines.js";
import { resolveOptionalIonToken } from "../src/optimization/browserRunner.js";

// Never ingest a developer's local `.env` into a unit-test process.
const ctx = loadContext({ loadDotEnv: false });
const SKILL = "cesiumjs-camera";

let root: string;

function writeBundle(dir: string, files: string[]): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of files) fs.writeFileSync(path.join(dir, name), name.endsWith(".json") ? "{}" : "png");
  return dir;
}

const completeBundle = (dir: string) => writeBundle(dir, ["screenshot.png", ...BUNDLE_ARTIFACTS]);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-bootstrap-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("bundle completeness", () => {
  it("requires a screenshot and every evidence file both audit lanes read", () => {
    expect(isBundleFullyRendered(completeBundle(path.join(root, "full")))).toBe(true);
    expect(isBundleFullyRendered(writeBundle(path.join(root, "shot-only"), ["screenshot.png"]))).toBe(false);
    expect(isBundleFullyRendered(writeBundle(path.join(root, "no-shot"), [...BUNDLE_ARTIFACTS]))).toBe(false);
    expect(isBundleFullyRendered(path.join(root, "missing"))).toBe(false);
    expect(isBundleFullyRendered(null)).toBe(false);
  });

  it("accepts multi-shot bundles, which never write a plain screenshot.png", () => {
    const dir = writeBundle(path.join(root, "panorama"), ["screenshot-0.png", "screenshot-1.png", ...BUNDLE_ARTIFACTS]);
    expect(isBundleFullyRendered(dir)).toBe(true);
  });
});

describe("planBaselineWork", () => {
  const scenarios = baselineScenarios(SKILL);
  const first = scenarios[0];

  it("plans work for every scenario of the selected skill", () => {
    const plan = planBaselineWork([SKILL], { bundleRoot: root, readSource: () => null });
    expect(plan.map((item) => item.caseId)).toEqual(scenarios.map((s) => s.id));
    // Nothing is rendered under a fresh root, so nothing can be complete.
    expect(plan.every((item) => item.state !== "complete")).toBe(true);
  });

  it("treats a complete bundle as done and an incomplete one as work", () => {
    completeBundle(bundleDirFor(first, root));
    const done = planBaselineWork([SKILL], { bundleRoot: root, readSource: () => null }).find((item) => item.caseId === first.id);
    expect(done?.state).toBe("complete");

    fs.rmSync(path.join(bundleDirFor(first, root), "console.json"));
    const partial = planBaselineWork([SKILL], { bundleRoot: root, readSource: () => null }).find((item) => item.caseId === first.id);
    expect(partial?.state).not.toBe("complete");
  });

  it("re-does complete bundles under --force and --regenerate", () => {
    completeBundle(bundleDirFor(first, root));
    const forced = planBaselineWork([SKILL], { bundleRoot: root, force: true, readSource: () => null }).find((item) => item.caseId === first.id);
    expect(forced?.state).not.toBe("complete");
    // --regenerate implies --force, and always goes back through codegen.
    const regenerated = planBaselineWork([SKILL], { bundleRoot: root, regenerate: true, readSource: () => null }).find((item) => item.caseId === first.id);
    expect(regenerated?.state).toBe("generate");
  });

  it("honours the --only case filter", () => {
    const plan = planBaselineWork([SKILL], { bundleRoot: root, only: new Set([first.id]), readSource: () => null });
    expect(plan).toHaveLength(1);
    expect(plan[0].caseId).toBe(first.id);
  });
});

/**
 * A re-render writes into the directory that is already there, so a --force
 * retry that dies leaves the previous bundle intact and complete-looking.
 * Verifying by disk alone would count that stale directory as a fresh success
 * and exit 0 on a run that failed, so the runner has to name which scenarios
 * failed and the bootstrap has to believe it.
 */
describe("a stale bundle never counts as a fresh render", () => {
  it("reports failure when this run could not produce the bundle, however complete the directory looks", async () => {
    // A complete bundle from an earlier run, under a root inside the repo (the
    // eval page is served from there, so runBaselineBootstrap rejects anything
    // outside it).
    const outRoot = path.join("evaluation/artifacts", `test-stale-${process.pid}`);
    const outAbs = path.join(ctx.repoRoot, outRoot);
    const scenario = baselineScenarios(SKILL)[0];
    completeBundle(bundleDirFor(scenario, outAbs));
    try {
      // --force asks for a re-render. Injected source discovery and rendering
      // make this unit test independent of ignored generated code, browsers,
      // network access, and developer credentials.
      const summary = await runBaselineBootstrap(ctx, {
        skills: SKILL,
        only: scenario.id,
        out: outRoot,
        force: true,
        skipCodegen: true,
      }, {
        readSource: () => "generated baseline source",
        render: async (_context, renderOptions) => {
          renderOptions.failures?.push({ scenario_id: scenario.id, error: "synthetic render failure" });
          return 1;
        },
      });
      expect(summary.total).toBe(1);
      expect(summary.complete).toBe(0);
      expect(summary.failures).toHaveLength(1);
      // The bundle is still on disk and still whole — the run simply is not
      // entitled to claim it.
      expect(isBundleFullyRendered(bundleDirFor(scenario, outAbs))).toBe(true);
    } finally {
      fs.rmSync(outAbs, { recursive: true, force: true });
    }
  });
});

describe("audit without bundles", () => {
  it("names the command that renders them instead of a bare layout error", async () => {
    await expect(auditCommand(ctx, { skills: SKILL, bundleRoot: root, noJudge: true })).rejects.toThrow(
      /cesium-eval render-baselines --skills cesiumjs-camera/,
    );
  });
});

describe("resolveOptionalIonToken", () => {
  const saved = { CESIUM_ION_TOKEN: process.env.CESIUM_ION_TOKEN, CESIUM_ACCESS_TOKEN: process.env.CESIUM_ACCESS_TOKEN };

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("returns null when no token is configured", () => {
    delete process.env.CESIUM_ION_TOKEN;
    delete process.env.CESIUM_ACCESS_TOKEN;
    expect(resolveOptionalIonToken()).toBeNull();
  });

  it("still rejects a configured-but-malformed token", () => {
    process.env.CESIUM_ION_TOKEN = "not-a-jwt";
    expect(() => resolveOptionalIonToken()).toThrow(/JWT format/);
  });
});
