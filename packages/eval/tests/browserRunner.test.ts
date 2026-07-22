import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addScreenshotQualityChecks,
  applySettleToQuality,
  invokePageFunction,
  shouldWaitForTiles,
  waitForSceneSettled,
  type SettlePage,
} from "../src/optimization/browserRunner.js";

/** Fake page: serves queued probe results and advances a mocked clock on waits. */
function fakePage(probes: Array<Record<string, any> | Error>): SettlePage & { polls: () => number } {
  let now = 0;
  let index = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    polls: () => index,
    evaluate: async () => {
      const probe = probes[Math.min(index, probes.length - 1)];
      index += 1;
      if (probe instanceof Error) throw probe;
      return probe;
    },
    waitForTimeout: async (ms: number) => {
      now += ms;
    },
  };
}

const settled = { available: true, globe_loaded: true, tilesets_total: 1, tilesets_loaded: 1, settled: true };
const loading = { available: true, globe_loaded: false, tilesets_total: 1, tilesets_loaded: 0, settled: false };
const noViewer = { available: false };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waitForSceneSettled", () => {
  const options = { timeoutMs: 45_000, pollMs: 250, quietPolls: 3 };

  it("settles after the required consecutive quiet polls", async () => {
    const page = fakePage([settled]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(result.viewer_unavailable).toBe(false);
    expect(result.polls).toBe(3);
  });

  it("resets the quiet counter when tile loading flickers", async () => {
    const page = fakePage([settled, settled, loading, settled, settled, settled]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.polls).toBe(6);
  });

  it("reports an honest timeout when tiles never finish", async () => {
    const page = fakePage([loading]);
    const result = await waitForSceneSettled(page, { ...options, timeoutMs: 1_000 });
    expect(result.settled).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.viewer_unavailable).toBe(false);
    expect(result.last_probe).toMatchObject({ settled: false });
  });

  it("bails out early when no viewer ever appears", async () => {
    const page = fakePage([noViewer]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(false);
    expect(result.timed_out).toBe(false);
    expect(result.viewer_unavailable).toBe(true);
    expect(result.waited_ms).toBeGreaterThanOrEqual(5_000);
  });

  it("still settles when the viewer appears late", async () => {
    const page = fakePage([noViewer, noViewer, settled, settled, settled]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.viewer_unavailable).toBe(false);
  });

  it("treats evaluate failures as viewer-unavailable", async () => {
    const page = fakePage([new Error("page crashed")]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(false);
    expect(result.viewer_unavailable).toBe(true);
  });
});

describe("invokePageFunction", () => {
  // Playwright evaluates string sources as plain expressions: a bare
  // arrow-function string serializes to undefined without running. The
  // helper must wrap the source in an explicit invocation.
  const page = (scripts: string[]): SettlePage => ({
    evaluate: async (script: string) => {
      scripts.push(script);
      return undefined;
    },
    waitForTimeout: async () => {},
  });

  it("wraps the source in an explicit call with the JSON-serialized argument", async () => {
    const scripts: string[] = [];
    await invokePageFunction(page(scripts), "({ x }) => x", { x: 21 });
    expect(scripts).toEqual(['(({ x }) => x)({"x":21})']);
  });

  it("invokes argument-less functions with an empty call", async () => {
    const scripts: string[] = [];
    await invokePageFunction(page(scripts), "() => 1");
    expect(scripts).toEqual(["(() => 1)()"]);
  });
});

describe("shouldWaitForTiles", () => {
  it("defaults to waiting", () => {
    expect(shouldWaitForTiles({}, {})).toBe(true);
  });

  it("honors the shot-level opt-out", () => {
    expect(shouldWaitForTiles({ wait_for_tiles: false }, {})).toBe(false);
  });

  it("honors the scenario-level opt-out", () => {
    expect(shouldWaitForTiles({}, { wait_for_tiles: false })).toBe(false);
  });

  it("lets the shot override the scenario", () => {
    expect(shouldWaitForTiles({ wait_for_tiles: true }, { wait_for_tiles: false })).toBe(true);
  });
});

describe("applySettleToQuality", () => {
  const base = () => ({ filename: "screenshot.png", warnings: [] as string[], passed: true, detail: "ok" });

  it("records a skip when the settle wait was opted out", () => {
    const quality = applySettleToQuality(base(), null);
    expect(quality.tile_settle).toEqual({ skipped: true });
    expect(quality.passed).toBe(true);
  });

  it("keeps a settled capture passing", () => {
    const quality = applySettleToQuality(base(), {
      settled: true,
      timed_out: false,
      viewer_unavailable: false,
      waited_ms: 750,
      polls: 3,
      last_probe: settled,
    });
    expect(quality.passed).toBe(true);
    expect(quality.tile_settle.settled).toBe(true);
  });

  it("fails the quality report when tiles were still loading at capture", () => {
    const quality = applySettleToQuality(base(), {
      settled: false,
      timed_out: true,
      viewer_unavailable: false,
      waited_ms: 45_000,
      polls: 180,
      last_probe: loading,
    });
    expect(quality.passed).toBe(false);
    expect(quality.detail).toContain("tiles still loading");
  });

  it("does not fail on timeout when the viewer never existed", () => {
    const quality = applySettleToQuality(base(), {
      settled: false,
      timed_out: true,
      viewer_unavailable: true,
      waited_ms: 1_000,
      polls: 5,
      last_probe: noViewer,
    });
    expect(quality.passed).toBe(true);
  });
});

describe("addScreenshotQualityChecks tiles_loaded emission", () => {
  const check = (result: Record<string, any>, id: string) =>
    (result.checks as Array<Record<string, any>>).find((c) => c.check_id === id);

  it("emits a passing tiles_loaded check for a settled capture", () => {
    const result = addScreenshotQualityChecks(
      { checks: [] },
      {
        screenshots: [
          { filename: "screenshot.png", passed: true, detail: "ok", tile_settle: { settled: true, waited_ms: 500 } },
        ],
      },
    );
    expect(check(result, "tiles_loaded:screenshot.png")).toMatchObject({ result: "pass" });
    expect(result.summary).toMatchObject({ total: 2, passed: 2, failed: 0 });
  });

  it("emits a failing tiles_loaded check for a partial-load capture", () => {
    const result = addScreenshotQualityChecks(
      { checks: [] },
      {
        screenshots: [
          {
            filename: "screenshot-2.png",
            passed: false,
            detail: "tiles still loading",
            tile_settle: { settled: false, timed_out: true, viewer_unavailable: false, waited_ms: 45_000 },
          },
        ],
      },
    );
    const tiles = check(result, "tiles_loaded:screenshot-2.png");
    expect(tiles).toMatchObject({ result: "fail" });
    expect(tiles?.detail).toContain("may not reflect the fully loaded scene");
  });

  it("emits no tiles_loaded check for opted-out or viewer-less captures", () => {
    const result = addScreenshotQualityChecks(
      { checks: [] },
      {
        screenshots: [
          { filename: "a.png", passed: true, detail: "ok", tile_settle: { skipped: true } },
          { filename: "b.png", passed: true, detail: "ok", tile_settle: { settled: false, viewer_unavailable: true } },
          { filename: "c.png", passed: true, detail: "ok" },
        ],
      },
    );
    const tileChecks = (result.checks as Array<Record<string, any>>).filter((c) => c.type === "tiles_loaded");
    expect(tileChecks).toHaveLength(0);
    expect(result.summary).toMatchObject({ total: 3 });
  });
});
