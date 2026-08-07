/**
 * Provider-attribution guards in invokeAgent: a provider override must be
 * served by the model actually invoked, or the run would record a lie. Both
 * cases below throw before any harness process is spawned.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import { invokeAgent } from "../src/harness/invoke.js";
import { generateScenarioCode } from "../src/optimization/skillsAdapter.js";

const ctx = loadContext();

describe("invokeAgent provider-attribution guards", () => {
  it("rejects a provider override with an auto model (codex has no discovery)", async () => {
    // codex is bound to openai; overriding to anthropic without an explicit
    // model would invoke codex's openai-bound default while stamping anthropic.
    await expect(
      invokeAgent(ctx, "judge", { prompt: "hi", provider: "anthropic", overrides: { harness: "codex" } }),
    ).rejects.toThrow(/needs an explicit model/);
  });

  it("rejects an explicit model whose provider prefix contradicts the override", async () => {
    // The reviewer's example: opencode's github-copilot/gpt-5.6-sol under an
    // openai override still hits the Copilot binding — must fail loudly.
    await expect(
      invokeAgent(ctx, "judge", {
        prompt: "hi",
        provider: "openai",
        overrides: { harness: "opencode", model: "github-copilot/gpt-5.6-sol" },
      }),
    ).rejects.toThrow(/contradicts/);
  });
});

/**
 * Codegen must route a provider the same way, through the request field the
 * guards above inspect. Folding it into `overrides` instead dropped it: the
 * run used the harness's default binding while the scorecard stamped the
 * requested provider — the exact attribution lie those guards exist to stop.
 */
describe("codegen provider routing", () => {
  it("routes a provider override through the guarded request field", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-provider-"));
    const skillPath = path.join(dir, "SKILL.md");
    fs.writeFileSync(skillPath, "# skill\n");
    try {
      // Reaching the same "needs an explicit model" guard proves the provider
      // arrived as a routed provider and not as an ignored override key. Before
      // the fix this call sailed past the guard and invoked codex's own binding.
      await expect(
        generateScenarioCode(ctx, {
          skill: "cesiumjs-camera",
          iteration: "test",
          skillPath,
          scenario: { id: "eval-001", prompt: "draw a globe" },
          overrides: { harness: "codex", provider: "anthropic" },
          outputRoot: dir,
        }),
      ).rejects.toThrow(/needs an explicit model/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
