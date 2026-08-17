import { describe, expect, it } from "vitest";
import { healthTone, isSyntheticRun } from "./grade";
import type { RunSummary } from "../types";

describe("healthTone", () => {
  it("grades high scores green even when the verdict is FAIL", () => {
    expect(healthTone(90)).toBe("good");
    expect(healthTone(93)).toBe("good");
    expect(healthTone(100)).toBe("good");
  });

  it("grades the middle band amber", () => {
    expect(healthTone(70)).toBe("warn");
    expect(healthTone(89)).toBe("warn");
  });

  it("grades low scores red", () => {
    expect(healthTone(0)).toBe("bad");
    expect(healthTone(69)).toBe("bad");
  });

  it("keeps missing or invalid percentages unknown", () => {
    expect(healthTone(null)).toBe("unknown");
    expect(healthTone(undefined)).toBe("unknown");
    expect(healthTone(Number.NaN)).toBe("unknown");
  });
});

describe("isSyntheticRun", () => {
  const run = (source?: RunSummary["source"]): RunSummary =>
    ({ source }) as RunSummary;

  it("marks pure fixtures runs synthetic", () => {
    expect(isSyntheticRun(run("fixtures"))).toBe(true);
  });

  it("keeps agent, mixed, and unstamped runs in", () => {
    expect(isSyntheticRun(run("agent"))).toBe(false);
    expect(isSyntheticRun(run("mixed"))).toBe(false);
    expect(isSyntheticRun(run(undefined))).toBe(false);
  });
});
