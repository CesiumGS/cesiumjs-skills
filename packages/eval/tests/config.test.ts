import { describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";

describe("loadContext", () => {
  it("loads the repository config and harness registry", () => {
    const context = loadContext();

    expect(context.config.registry).toBe("config/harness-registry.json");
    expect(context.registry.harnesses.map((harness) => harness.id)).toEqual(["codex", "opencode"]);
    expect(context.resolveRole("codegen").harness.id).toBe("opencode");
    expect(context.resolveRole("codegen").variant).toBe("low");
  });

  it("applies explicit role overrides", () => {
    const context = loadContext();
    const resolved = context.resolveRole("judge", {
      harness: "codex",
      model: "gpt-5.6-sol",
      variant: "high",
    });

    expect(resolved.harness.id).toBe("codex");
    expect(resolved.model).toBe("gpt-5.6-sol");
    expect(resolved.variant).toBe("high");
  });
});