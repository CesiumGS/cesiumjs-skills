import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addScreenshotQualityChecks,
  applySettleToQuality,
  detectIonAuthFailure,
  invokePageFunction,
  SCENE_SETTLE_PROBE_JS,
  screenshotSpecsFor,
  shouldWaitForTiles,
  summarizeSettleBlockers,
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

  it("resets the quiet streak while the camera is still moving", async () => {
    // Settled reads taken mid-camera-motion are untrustworthy: moving cameras
    // cull tile requests, so tilesLoaded can be a stale true for the new view.
    const at = (x: number) => ({ ...settled, camera: [x, 0, 0, 0, 0, 0] });
    const page = fakePage([at(0), at(500), at(500), at(500), at(500)]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.polls).toBe(5);
    expect(result.camera_moved_polls).toBe(1);
  });

  it("counts probes without camera data as static", async () => {
    const page = fakePage([settled]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.camera_moved_polls).toBe(0);
  });

  it("treats angle-wrap and floating-point pose jitter as static", async () => {
    // roll flapping between 2π-ε and ε across frames is getter noise, not
    // motion; likewise sub-centimeter position deltas.
    const jitter = (roll: number, x: number) => ({ ...settled, camera: [x, 0, 0, 0.1, -0.5, roll] });
    const page = fakePage([jitter(6.2831852860615305, 1000), jitter(1.2e-9, 1000.001), jitter(0, 1000)]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.camera_moved_polls).toBe(0);
    expect(result.polls).toBe(3);
  });

  it("treats NaN camera components as static rather than perpetual motion", async () => {
    const nanPose = { ...settled, camera: [1, 2, 3, NaN, -0.5, 0] };
    const page = fakePage([nanPose, nanPose, nanPose]);
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.camera_moved_polls).toBe(0);
  });

  it("accepts a deliberately animated camera once load streams stay settled", async () => {
    // Camera pose changes every poll (trackedEntity-style motion) so the quiet
    // streak never accumulates; the motion escape accepts the scene after the
    // settled streak instead of burning the whole timeout.
    let x = 0;
    const page: SettlePage & { polls: () => number } = {
      polls: () => x,
      evaluate: async () => ({ ...settled, camera: [(x += 1), 0, 0, 0, 0, 0] }),
      waitForTimeout: async () => {},
    };
    const result = await waitForSceneSettled(page, options);
    expect(result.settled).toBe(true);
    expect(result.settled_with_motion).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(result.polls).toBe(Math.max(options.quietPolls * 5, 20));
  });
});

describe("SCENE_SETTLE_PROBE_JS readiness matrix", () => {
  /** Execute the actual in-page probe source against a mock viewer/window. */
  function runProbe(viewer: any, win: Record<string, any> = {}): Record<string, any> {
    const fn = new Function("viewer", "window", `return (${SCENE_SETTLE_PROBE_JS})();`);
    return fn(viewer, win);
  }

  const collection = (items: any[]) => ({ length: items.length, get: (i: number) => items[i] });

  function mockViewer(mutate?: (v: any) => void): any {
    const viewer: any = {
      renders: 0,
      render() {
        viewer.renders += 1;
      },
      imageryLayers: collection([]),
      dataSourceDisplay: { ready: true },
      scene: {
        renderRequests: 0,
        requestRender() {
          viewer.scene.renderRequests += 1;
        },
        globe: {
          show: true,
          tilesLoaded: true,
          terrainProvider: {},
          _surface: { _debug: { tilesWaitingForChildren: 0 } },
        },
        camera: { positionWC: { x: 1, y: 2, z: 3 }, heading: 0.1, pitch: -0.5, roll: 0 },
        primitives: collection([]),
        groundPrimitives: collection([]),
      },
    };
    mutate?.(viewer);
    return viewer;
  }

  it("reports unavailable without a viewer, and finds the captured fallback viewer", () => {
    expect(runProbe(undefined)).toEqual({ available: false });
    const captured = mockViewer();
    const viaWindow = runProbe(undefined, { __EVAL_VIEWER__: captured });
    expect(viaWindow.available).toBe(true);
    expect(viaWindow.settled).toBe(true);
  });

  it("drives a render before reading any signal, like renderForSpecs in upstream specs", () => {
    const viewer = mockViewer();
    runProbe(viewer);
    expect(viewer.renders).toBe(1);
    expect(viewer.scene.renderRequests).toBe(1);
  });

  it("tolerates a throwing render and records it", () => {
    const viewer = mockViewer((v) => {
      v.render = () => {
        throw new Error("render error panel");
      };
    });
    const probe = runProbe(viewer);
    expect(probe.render_errors).toBe(1);
    expect(probe.settled).toBe(true);
  });

  it("settles a fully loaded scene and reports the camera pose", () => {
    const probe = runProbe(mockViewer());
    expect(probe.settled).toBe(true);
    expect(probe.camera).toEqual([1, 2, 3, 0.1, -0.5, 0]);
  });

  it("blocks on the async-terrain window (terrainProvider undefined, tilesLoaded vacuously true)", () => {
    const probe = runProbe(mockViewer((v) => (v.scene.globe.terrainProvider = undefined)));
    expect(probe.terrain_provider_pending).toBe(true);
    expect(probe.globe_loaded).toBe(false);
    expect(probe.settled).toBe(false);
  });

  it("blocks while tiles are waiting for children even when the load queues are empty", () => {
    const probe = runProbe(mockViewer((v) => (v.scene.globe._surface._debug.tilesWaitingForChildren = 4)));
    expect(probe.tiles_waiting_for_children).toBe(4);
    expect(probe.settled).toBe(false);
  });

  it("blocks while the globe's tile load queues are non-empty", () => {
    const probe = runProbe(mockViewer((v) => (v.scene.globe.tilesLoaded = false)));
    expect(probe.globe_loaded).toBe(false);
    expect(probe.settled).toBe(false);
  });

  it("treats a hidden or missing globe as vacuously loaded", () => {
    expect(runProbe(mockViewer((v) => (v.scene.globe.show = false))).settled).toBe(true);
    expect(runProbe(mockViewer((v) => (v.scene.globe = undefined))).settled).toBe(true);
  });

  it("blocks on a shown imagery layer whose async provider is not ready, ignoring hidden ones", () => {
    const blocked = runProbe(
      mockViewer((v) => (v.imageryLayers = collection([{ show: true, ready: false }]))),
    );
    expect(blocked.imagery_layers_ready).toBe(0);
    expect(blocked.settled).toBe(false);

    const hidden = runProbe(
      mockViewer((v) => (v.imageryLayers = collection([{ show: false, ready: false }]))),
    );
    expect(hidden.imagery_layers_total).toBe(0);
    expect(hidden.settled).toBe(true);
  });

  it("stops gating on a layer whose provider terminally failed, and reports it", () => {
    // A rejected async provider latches ready=false forever; the probe hooks
    // errorEvent on first sight and, once the error fires, excludes the layer
    // instead of blocking until timeout.
    let errorListener: (() => void) | null = null;
    const layer: any = {
      show: true,
      ready: false,
      errorEvent: {
        addEventListener: (fn: () => void) => {
          errorListener = fn;
        },
      },
    };
    const viewer = mockViewer((v) => (v.imageryLayers = collection([layer])));

    const before = runProbe(viewer);
    expect(before.settled).toBe(false);
    expect(before.imagery_layers_failed).toBe(0);
    expect(errorListener).not.toBeNull();

    errorListener!();
    const after = runProbe(viewer);
    expect(after.imagery_layers_failed).toBe(1);
    expect(after.imagery_layers_total).toBe(0);
    expect(after.settled).toBe(true);

    // A transient tile error on an already-ready layer never excludes it.
    layer.ready = true;
    const transient = runProbe(viewer);
    expect(transient.imagery_layers_failed).toBe(0);
    expect(transient.imagery_layers_total).toBe(1);
    expect(transient.settled).toBe(true);
  });

  it("prefers the captured viewer over a truthy sceneless global", () => {
    const probe = runProbe({ then: () => {} }, { __EVAL_VIEWER__: mockViewer() });
    expect(probe.available).toBe(true);
    expect(probe.settled).toBe(true);
  });

  it("skips empty billboard/label collections that can never become ready", () => {
    const emptyCollection = { show: true, length: 0, ready: false, get: () => undefined };
    const probe = runProbe(mockViewer((v) => (v.scene.primitives = collection([emptyCollection]))));
    expect(probe.primitives_total).toBe(0);
    expect(probe.settled).toBe(true);
  });

  it("still gates on non-empty collections exposing an aggregate ready", () => {
    const loadingCollection = { show: true, length: 2, ready: false, get: () => ({}) };
    const probe = runProbe(mockViewer((v) => (v.scene.primitives = collection([loadingCollection]))));
    expect(probe.primitives_total).toBe(1);
    expect(probe.primitives_ready).toBe(0);
    expect(probe.settled).toBe(false);
  });

  it("blocks on streaming 3D tilesets and skips hidden ones", () => {
    const streaming = runProbe(
      mockViewer((v) => (v.scene.primitives = collection([{ tilesLoaded: false }]))),
    );
    expect(streaming.tilesets_total).toBe(1);
    expect(streaming.tilesets_loaded).toBe(0);
    expect(streaming.settled).toBe(false);

    const hidden = runProbe(
      mockViewer((v) => (v.scene.primitives = collection([{ tilesLoaded: false, show: false }]))),
    );
    expect(hidden.tilesets_total).toBe(0);
    expect(hidden.settled).toBe(true);
  });

  it("blocks on unready models nested inside primitive collections", () => {
    const nested = collection([{ ready: false }]);
    const probe = runProbe(mockViewer((v) => (v.scene.primitives = collection([nested]))));
    expect(probe.primitives_total).toBe(1);
    expect(probe.primitives_ready).toBe(0);
    expect(probe.settled).toBe(false);
  });

  it("skips hidden collections whose members can never become ready", () => {
    const hiddenCollection = { ...collection([{ ready: false }]), show: false };
    const probe = runProbe(mockViewer((v) => (v.scene.primitives = collection([hiddenCollection]))));
    expect(probe.primitives_total).toBe(0);
    expect(probe.settled).toBe(true);
  });

  it("blocks on unready ground primitives", () => {
    const probe = runProbe(mockViewer((v) => (v.scene.groundPrimitives = collection([{ ready: false }]))));
    expect(probe.settled).toBe(false);
  });

  it("blocks while entity visualizers are not ready", () => {
    const probe = runProbe(mockViewer((v) => (v.dataSourceDisplay = { ready: false })));
    expect(probe.data_sources_ready).toBe(false);
    expect(probe.settled).toBe(false);
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

describe("summarizeSettleBlockers", () => {
  it("names the unavailable viewer", () => {
    expect(summarizeSettleBlockers(null)).toBe("viewer unavailable");
    expect(summarizeSettleBlockers({ available: false })).toBe("viewer unavailable");
  });

  it("names each pending load stream", () => {
    const text = summarizeSettleBlockers({
      available: true,
      terrain_provider_pending: true,
      imagery_layers_total: 2,
      imagery_layers_ready: 1,
      imagery_layers_failed: 1,
      tilesets_total: 1,
      tilesets_loaded: 0,
      primitives_total: 3,
      primitives_ready: 2,
      data_sources_ready: false,
      settled: false,
    });
    expect(text).toContain("terrain provider still resolving");
    expect(text).toContain("imagery layers 1/2 ready");
    expect(text).toContain("1 imagery layer(s) failed to load");
    expect(text).toContain("3D tilesets 0/1 loaded");
    expect(text).toContain("primitives 2/3 ready");
    expect(text).toContain("entity visualizers not ready");
  });

  it("attributes a settled-but-moving probe to camera motion", () => {
    expect(summarizeSettleBlockers({ available: true, settled: true })).toContain("camera never stopped moving");
  });
});

describe("screenshotSpecsFor panorama synthesis", () => {
  it("carries a shot-level wait_for_tiles opt-out into synthesized panorama specs", () => {
    const scenario = {
      screenshot_mode: "cardinal_panorama",
      screenshots: [{ delay_ms: 2000, wait_for_tiles: false }],
    };
    const specs = screenshotSpecsFor(scenario);
    expect(specs).toHaveLength(4);
    for (const spec of specs) {
      expect(shouldWaitForTiles(spec, scenario)).toBe(false);
    }
  });

  it("keeps waiting by default in panorama mode", () => {
    const scenario = { screenshot_mode: "cardinal_panorama", screenshots: [{ delay_ms: 2000 }] };
    for (const spec of screenshotSpecsFor(scenario)) {
      expect(shouldWaitForTiles(spec, scenario)).toBe(true);
    }
  });
});

describe("detectIonAuthFailure", () => {
  it("flags cesium.com 429 rate limiting as environment-invalid", () => {
    const check = detectIonAuthFailure([], [{ url: "https://api.cesium.com/v1/assets/1/endpoint", status: 429 }]);
    expect(check).toMatchObject({ environment_invalid: true });
  });

  it("ignores third-party 429s", () => {
    expect(detectIonAuthFailure([], [{ url: "https://tile.openstreetmap.org/1/2/3.png", status: 429 }])).toBeNull();
  });

  it("still flags bare 401 console errors", () => {
    const check = detectIonAuthFailure([{ type: "error", text: "Request has failed. Status Code: 401" }], []);
    expect(check).toMatchObject({ environment_invalid: true });
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
      camera_moved_polls: 0,
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
      camera_moved_polls: 0,
      last_probe: loading,
    });
    expect(quality.passed).toBe(false);
    expect(quality.detail).toContain("scene still loading");
  });

  it("does not fail on timeout when the viewer never existed", () => {
    const quality = applySettleToQuality(base(), {
      settled: false,
      timed_out: true,
      viewer_unavailable: true,
      waited_ms: 1_000,
      polls: 5,
      camera_moved_polls: 0,
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
