/**
 * Provider-attribution guards in invokeAgent: a provider override must be
 * served by the model actually invoked, or the run would record a lie. Both
 * cases below throw before any harness process is spawned.
 */
import { describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import { invokeAgent } from "../src/harness/invoke.js";

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
