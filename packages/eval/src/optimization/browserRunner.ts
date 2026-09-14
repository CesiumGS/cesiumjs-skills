/**
 * Browser runner: renders generated CesiumJS snippets in a headless browser
 * and writes evidence bundles (screenshots, console, scene state, checks,
 * metadata) under optimization/runs/<skill>/<iteration>/<scenario-slug>/.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as zlib from "node:zlib";
import { AddressInfo } from "node:net";
import { readJson, canonicalStringify, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, isUnder, repoRelative } from "../lib/paths.js";
import { gitCommit, sha256File, sha256Text } from "../lib/proc.js";
import { runChecks } from "./checksEngine.js";
import type { BrowserConfig, EvalContext } from "../config/types.js";

// ---------------------------------------------------------------------------
// Ion token handling
// ---------------------------------------------------------------------------
const PLACEHOLDER_TOKEN_MARKERS = ["placeholder", "your-token", "TODO", "example", "xxx"];
const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function resolveIonToken(): string {
  for (const name of ["CESIUM_ION_TOKEN", "CESIUM_ACCESS_TOKEN"]) {
    const value = process.env[name];
    if (!value) continue;
    if (PLACEHOLDER_TOKEN_MARKERS.some((marker) => value.toLowerCase().includes(marker))) {
      throw new Error(`${name} looks like a placeholder. Refusing to run.`);
    }
    if (!JWT_RE.test(value)) {
      throw new Error(`${name} is not in JWT format (expected three base64url segments). Refusing to run.`);
    }
    return value;
  }
  throw new Error(
    "Set CESIUM_ION_TOKEN (or CESIUM_ACCESS_TOKEN) before running browser evals. Get one at https://ion.cesium.com/tokens",
  );
}

/**
 * The Ion token when one is configured, null when none is.
 *
 * A token that IS set but malformed still throws: a typo'd token has to fail
 * loudly rather than silently degrade every render into a token-less one. Only
 * the "no token at all" case is permitted to continue, and only for callers
 * that opt in (baseline bootstrapping, where scenarios bringing their own
 * imagery render fine and Ion-dependent ones still produce a globe).
 */
export function resolveOptionalIonToken(): string | null {
  const configured = ["CESIUM_ION_TOKEN", "CESIUM_ACCESS_TOKEN"].some((name) => Boolean(process.env[name]));
  return configured ? resolveIonToken() : null;
}

/** Sanity-check the Ion token against the live API before launching scenarios. */
export async function preflightIon(ionToken: string, assetId: number, allowSkip: boolean): Promise<void> {
  if (allowSkip) {
    console.log("[render] Ion preflight skipped (EVAL_SKIP_ION_PREFLIGHT=1).");
    return;
  }
  const url = `https://api.cesium.com/v1/assets/${assetId}/endpoint`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${ionToken}` }, signal: AbortSignal.timeout(10_000) });
  } catch (exc: any) {
    throw new Error(`Ion preflight network error: ${exc.message}. Check internet access, or set EVAL_SKIP_ION_PREFLIGHT=1.`);
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(
      `Ion preflight failed: HTTP ${response.status}. Your token is missing or invalid. Body: ${body}. ` +
        "Get a fresh token at https://ion.cesium.com/tokens, or set EVAL_SKIP_ION_PREFLIGHT=1 if your scenarios don't need Ion.",
    );
  }
  console.log(`[render] Ion preflight OK (asset ${assetId} reachable).`);
}

// ---------------------------------------------------------------------------
// eval page
// ---------------------------------------------------------------------------
function renderHtml(cesiumVersion: string, ionToken: string | null, generatedCode: string): string {
  // The assignment is emitted only when a token exists: assigning an empty
  // token makes every Ion request fail with a confusing 401 instead of simply
  // rendering without Ion.
  const tokenLine = ionToken !== null ? `Cesium.Ion.defaultAccessToken = ${JSON.stringify(ionToken)};` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CesiumJS public eval</title>
  <script src="https://cesium.com/downloads/cesiumjs/releases/${cesiumVersion}/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/${cesiumVersion}/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
  <style>
    html, body, #cesiumContainer {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div id="cesiumContainer"></div>
  <script>
    window.__CESIUM_EVAL_ERRORS__ = [];
    window.addEventListener("error", event => {
      window.__CESIUM_EVAL_ERRORS__.push({ message: event.message, source: event.filename, line: event.lineno });
    });
    window.addEventListener("unhandledrejection", event => {
      window.__CESIUM_EVAL_ERRORS__.push({ message: String(event.reason) });
    });
    // Record the live Viewer/CesiumWidget on window.__EVAL_VIEWER__. The
    // generated code runs inside an async wrapper, so its "const viewer" is
    // function-scoped, not a global; without this capture the settle probe
    // and scene-state extraction can silently lose the scene and the
    // partial-load safeguard never engages. The Cesium namespace exposes its
    // exports through getter-only properties (so Cesium.Viewer cannot be
    // reassigned); prototype methods stay writable, and the widget's default
    // render loop calls widget.render() every frame, which hands us the
    // instance.
    (function () {
      for (const name of ["Viewer", "CesiumWidget"]) {
        const Type = Cesium[name];
        if (!Type || !Type.prototype || typeof Type.prototype.render !== "function") continue;
        const originalRender = Type.prototype.render;
        Type.prototype.render = function (...args) {
          if (this && this.scene) window.__EVAL_VIEWER__ = this;
          return originalRender.apply(this, args);
        };
      }
    })();
    ${tokenLine}
    (async () => {
      try {
${generatedCode}
      } catch (error) {
        window.__CESIUM_EVAL_ERRORS__.push({ message: error && error.message ? error.message : String(error) });
        throw error;
      }
    })();
  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// screenshot quality analysis (PNG structural + sampled-pixel signals)
// ---------------------------------------------------------------------------
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function pngChunks(data: Buffer): Array<[string, Buffer]> {
  const chunks: Array<[string, Buffer]> = [];
  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("latin1");
    chunks.push([type, data.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

export function analyzeScreenshot(filePath: string, expectedWidth: number, expectedHeight: number): Record<string, any> {
  const data = fs.readFileSync(filePath);
  const report: Record<string, any> = {
    filename: path.basename(filePath),
    file_size_bytes: data.length,
    expected_width: expectedWidth,
    expected_height: expectedHeight,
    warnings: [] as string[],
  };

  if (!data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ...report, passed: false, detail: "not a PNG file" };
  }

  const chunks = pngChunks(data);
  const ihdr = chunks.find(([type]) => type === "IHDR")?.[1];
  if (!ihdr || ihdr.length < 13) {
    return { ...report, passed: false, detail: "missing PNG IHDR chunk" };
  }

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  Object.assign(report, { width, height, bit_depth: bitDepth, color_type: colorType, interlace });

  if (width !== expectedWidth || height !== expectedHeight) {
    report.warnings.push(`unexpected dimensions ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`);
  }
  if (expectedWidth * expectedHeight >= 10_000 && data.length < 1024) {
    report.warnings.push("screenshot file is suspiciously small");
  }

  const bytesPerPixelByColorType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bytesPerPixel = bytesPerPixelByColorType[colorType];
  if (bitDepth === 8 && interlace === 0 && bytesPerPixel !== undefined) {
    try {
      const idat = Buffer.concat(chunks.filter(([type]) => type === "IDAT").map(([, chunk]) => chunk));
      const raw = zlib.inflateSync(idat);
      const stride = width * bytesPerPixel;
      let previous = Buffer.alloc(stride);
      const pixels = Buffer.alloc(stride * height);
      let offset = 0;
      for (let row = 0; row < height; row++) {
        const filterType = raw[offset];
        offset += 1;
        const line = Buffer.from(raw.subarray(offset, offset + stride));
        offset += stride;
        for (let i = 0; i < stride; i++) {
          const left = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0;
          const up = previous[i];
          const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
          if (filterType === 1) line[i] = (line[i] + left) & 0xff;
          else if (filterType === 2) line[i] = (line[i] + up) & 0xff;
          else if (filterType === 3) line[i] = (line[i] + Math.floor((left + up) / 2)) & 0xff;
          else if (filterType === 4) line[i] = (line[i] + paeth(left, up, upLeft)) & 0xff;
          else if (filterType !== 0) throw new Error(`unsupported PNG filter type ${filterType}`);
        }
        line.copy(pixels, row * stride);
        previous = line;
      }

      const sampleStride = Math.max(
        bytesPerPixel,
        Math.floor(Math.floor(pixels.length / 10_000) / bytesPerPixel) * bytesPerPixel,
      );
      const sampledColors = new Set<string>();
      const luminances: number[] = [];
      for (let i = 0; i + bytesPerPixel <= pixels.length; i += sampleStride) {
        const sample = pixels.subarray(i, i + bytesPerPixel);
        sampledColors.add(sample.toString("hex"));
        const luminance =
          colorType === 2 || colorType === 6 ? 0.2126 * sample[0] + 0.7152 * sample[1] + 0.0722 * sample[2] : sample[0];
        luminances.push(luminance);
      }
      if (luminances.length) {
        const luminanceSpan = Math.max(...luminances) - Math.min(...luminances);
        report.distinct_sampled_colors = sampledColors.size;
        report.luminance_span = Math.round(luminanceSpan * 100) / 100;
        if (sampledColors.size < 8) report.warnings.push("screenshot has too few distinct sampled colors");
        if (luminanceSpan < 10) report.warnings.push("screenshot has very low luminance variation");
      }
    } catch (exc: any) {
      report.warnings.push(`could not compute pixel variation: ${exc.message}`);
    }
  } else {
    report.warnings.push("pixel variation check skipped for this PNG encoding");
  }

  report.passed = report.warnings.length === 0;
  report.detail = report.passed ? "ok" : report.warnings.join("; ");
  return report;
}

// ---------------------------------------------------------------------------
// checks assembly
// ---------------------------------------------------------------------------
// 401/403 are auth failures; 429 is rate limiting. All three are environment
// problems, not candidate bugs (a candidate's bad asset id yields a 404).
// Bare 401s match anywhere (Cesium's Resource errors omit the host); 403/429
// must be cesium.com-scoped to avoid claiming third-party tile throttling.
const ION_AUTH_RE = /401|cesium\.com.*?(?:Unauthor|forbidden|rate limit|403|429)|(?:403|429).*?cesium\.com/i;
const ION_AUTH_STATUSES = new Set(["401", "403", "429"]);

export function detectIonAuthFailure(
  consoleMessages: Array<Record<string, any>>,
  networkFailures: Array<Record<string, any>>,
): Record<string, any> | null {
  const ionFailures = [
    ...consoleMessages.filter((m) => m.type === "error" && ION_AUTH_RE.test(m.text ?? "")),
    ...networkFailures.filter(
      (nf) => ION_AUTH_STATUSES.has(String(nf.status ?? "")) && String(nf.url ?? "").toLowerCase().includes("cesium"),
    ),
  ];
  if (!ionFailures.length) return null;
  return {
    check_id: "ion_auth_failure",
    type: "ion_auth_failure",
    description: "Trial is environment-invalid: Ion auth or rate-limit failure during run.",
    result: "fail",
    detail:
      `${ionFailures.length} Ion 401/403/429 error(s) observed in console/network log. ` +
      "This trial's screenshot and downstream judge verdict are not reliable; re-run after verifying CESIUM_ION_TOKEN scopes.",
    environment_invalid: true,
  };
}

function withSummary(result: Record<string, any>): Record<string, any> {
  const checks: Array<Record<string, any>> = result.checks ?? [];
  const passed = checks.filter((c) => c.result === "pass").length;
  result.summary = {
    total: checks.length,
    passed,
    failed: checks.length - passed,
    pass_rate: checks.length ? passed / checks.length : 1.0,
  };
  return result;
}

export function runProgrammaticChecks(
  scenario: Record<string, any>,
  generatedCode: string,
  errors: Array<Record<string, any>>,
  sceneState: Record<string, any> | null,
  consoleMessages: Array<Record<string, any>>,
  networkFailures: Array<Record<string, any>>,
): Record<string, any> {
  const result: Record<string, any> = runChecks(scenario, generatedCode, { errors }, sceneState);
  const ionCheck = detectIonAuthFailure(consoleMessages, networkFailures);
  if (ionCheck !== null) {
    result.checks.push(ionCheck);
    result.environment_invalid = true;
  }
  return withSummary(result);
}

export function addScreenshotQualityChecks(
  checksResult: Record<string, any>,
  qualityReport: Record<string, any>,
): Record<string, any> {
  const checks: Array<Record<string, any>> = (checksResult.checks ??= []);
  for (const screenshot of qualityReport.screenshots ?? []) {
    checks.push({
      check_id: `screenshot_quality:${screenshot.filename}`,
      type: "screenshot_quality",
      description: "Captured screenshot is nonblank and has the expected viewport dimensions",
      result: screenshot.passed ? "pass" : "fail",
      detail: screenshot.detail ?? "",
    });
    const settle = screenshot.tile_settle;
    // Only emit a tiles_loaded verdict when the scene gave a definite answer:
    // opted-out shots have no check, and a missing viewer is already surfaced
    // by scene-state and error checks.
    if (settle && !settle.skipped && !settle.viewer_unavailable) {
      checks.push({
        check_id: `tiles_loaded:${screenshot.filename}`,
        type: "tiles_loaded",
        description:
          "Globe surface, imagery layers, 3D tilesets, models, and entity visualizers finished loading before the screenshot was captured",
        result: settle.settled ? "pass" : "fail",
        detail: settle.settled
          ? `scene settled after ${settle.waited_ms}ms${settle.settled_with_motion ? " (camera kept moving; load streams settled)" : ""}`
          : `scene still loading when captured (waited ${settle.waited_ms}ms; ${settle.blockers ?? "cause unknown"}); image may not reflect the fully loaded scene`,
      });
    }
  }
  return withSummary(checksResult);
}

/**
 * Fold the tile-settle outcome into a screenshot's quality report so a
 * partial-load capture can never silently pass as a good screenshot.
 */
export function applySettleToQuality(quality: Record<string, any>, settle: SettleResult | null): Record<string, any> {
  if (!settle) {
    quality.tile_settle = { skipped: true };
    return quality;
  }
  quality.tile_settle = {
    settled: settle.settled,
    timed_out: settle.timed_out,
    viewer_unavailable: settle.viewer_unavailable,
    waited_ms: settle.waited_ms,
    polls: settle.polls,
    camera_moved_polls: settle.camera_moved_polls,
    settled_with_motion: settle.settled_with_motion,
  };
  if (settle.timed_out && !settle.viewer_unavailable) {
    const blockers = summarizeSettleBlockers(settle.last_probe);
    quality.tile_settle.blockers = blockers;
    const warnings: string[] = (quality.warnings ??= []);
    warnings.push(`scene still loading when screenshot was captured (waited ${settle.waited_ms}ms; ${blockers})`);
    quality.passed = false;
    quality.detail = warnings.join("; ");
  }
  return quality;
}

// ---------------------------------------------------------------------------
// panorama capture
// ---------------------------------------------------------------------------
const CARDINAL_PANORAMA_SHOTS = [0, 90, 180, 270].map((heading) => ({
  timing: `orbit_${heading}`,
  heading_degrees: heading,
  description: `Orbit view of the subject from heading ${heading} deg (subject kept centered)`,
}));

const ORBIT_PANORAMA_PITCH_DEG = -30;

const ORBIT_PANORAMA_JS = String.raw`
({ headingDegrees, index }) => {
  const C = Cesium;
  let globalViewer = null;
  try { globalViewer = (typeof viewer !== 'undefined' && viewer && viewer.scene) ? viewer : null; } catch (e) {}
  const viewerRef = globalViewer || window.__EVAL_VIEWER__;
  if (!viewerRef || !viewerRef.scene) return;
  const scene = viewerRef.scene, camera = scene.camera;
  if (index === 0) {
    const p = camera.positionWC;
    window.__PANO_SETTLED__ = { pos: [p.x, p.y, p.z], heading: camera.heading, pitch: camera.pitch, roll: camera.roll };
    window.__PANO_ORBIT__ = null;
  }
  function subjectSphere() {
    const spheres = [];
    try {
      const prims = scene.primitives;
      for (let i = 0; i < prims.length; i++) {
        const pr = prims.get(i);
        try {
          const bs = pr && pr.boundingSphere;
          if (bs && C.defined(bs.center) && isFinite(bs.radius) && bs.radius > 0 && bs.radius < 2.0e6) spheres.push(bs);
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const dsd = viewerRef.dataSourceDisplay, scr = new C.BoundingSphere(), now = viewerRef.clock ? viewerRef.clock.currentTime : undefined;
      for (const e of viewerRef.entities.values) {
        let got = false;
        try {
          const st = dsd.getBoundingSphere(e, false, scr);
          if (st === C.BoundingSphereState.DONE && isFinite(scr.radius) && scr.radius >= 0) { spheres.push(C.BoundingSphere.clone(scr)); got = true; }
        } catch (e2) {}
        if (!got) { try { const pos = e.position && e.position.getValue(now); if (C.defined(pos)) spheres.push(new C.BoundingSphere(pos, 10)); } catch (e3) {} }
      }
    } catch (e) {}
    if (!spheres.length) return undefined;
    return spheres.length === 1 ? spheres[0] : C.BoundingSphere.fromBoundingSpheres(spheres);
  }
  if (!window.__PANO_ORBIT__) {
    const bs = subjectSphere();
    if (bs) {
      window.__PANO_ORBIT__ = { mode: 'sphere', c: [bs.center.x, bs.center.y, bs.center.z], radius: bs.radius, range: Math.max(bs.radius * 3.2, bs.radius + 60) };
    } else {
      const px = new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
      let t;
      try { t = scene.pickPosition(px); } catch (e) {}
      if (!C.defined(t) || isNaN(t.x)) { try { t = camera.pickEllipsoid(px, scene.globe.ellipsoid); } catch (e) {} }
      if (!C.defined(t)) t = C.Cartesian3.add(camera.positionWC, C.Cartesian3.multiplyByScalar(camera.directionWC, 1500, new C.Cartesian3()), new C.Cartesian3());
      window.__PANO_ORBIT__ = { mode: 'look', c: [t.x, t.y, t.z], range: Math.max(50, C.Cartesian3.distance(camera.positionWC, t)) };
    }
  }
  const o = window.__PANO_ORBIT__;
  const center = new C.Cartesian3(o.c[0], o.c[1], o.c[2]);
  const hpr = new C.HeadingPitchRange(C.Math.toRadians(headingDegrees), C.Math.toRadians(%PITCH%), o.range);
  if (o.mode === 'sphere') camera.viewBoundingSphere(new C.BoundingSphere(center, o.radius), hpr);
  else camera.lookAt(center, hpr);
  camera.lookAtTransform(C.Matrix4.IDENTITY);
}
`.replace("%PITCH%", String(ORBIT_PANORAMA_PITCH_DEG));

const ORBIT_RESTORE_JS = `
() => {
  const C = Cesium;
  let globalViewer = null;
  try { globalViewer = (typeof viewer !== 'undefined' && viewer && viewer.scene) ? viewer : null; } catch (e) {}
  const viewerRef = globalViewer || window.__EVAL_VIEWER__;
  if (!viewerRef || !viewerRef.scene) return;
  viewerRef.scene.camera.lookAtTransform(C.Matrix4.IDENTITY);
  const s = window.__PANO_SETTLED__;
  if (s) {
    viewerRef.scene.camera.setView({
      destination: new C.Cartesian3(s.pos[0], s.pos[1], s.pos[2]),
      orientation: { heading: s.heading, pitch: s.pitch, roll: s.roll }
    });
  }
}
`;

// ---------------------------------------------------------------------------
// scene settle safeguard: never capture while the scene is still loading
// ---------------------------------------------------------------------------
/**
 * In-page probe of Cesium's load state, modeled on how CesiumGS/cesium's own
 * test suite decides a scene is ready to assert against (verified against the
 * 1.142 sources):
 *
 * - Renders a frame before reading anything, the page analogue of the
 *   `scene.renderForSpecs()` call inside every `pollToPromise` iteration
 *   (Specs/Cesium3DTilesTester.js, Specs/Scene/GlobeSpec.js). Tile selection,
 *   request dispatch, and resource processing only advance during a rendered
 *   frame, and every readiness getter reports the state of the *last
 *   completed* pass — after a camera move the getters read stale-true until a
 *   frame renders. The explicit render also keeps requestRenderMode scenes
 *   and throttled headless pages streaming.
 * - Globe: `tilesLoaded` (all three surface load queues empty) plus the
 *   stricter `_surface._debug.tilesWaitingForChildren === 0` gate that
 *   GlobeSurfaceTileProviderSpec's updateUntilDone uses, plus a guard for the
 *   async-terrain window where `globe.terrainProvider` is still undefined and
 *   `tilesLoaded` reads a vacuous true over an unloaded gray globe.
 * - Imagery: every shown ImageryLayer must be `ready` (async providers). A
 *   provider whose creation promise rejected latches ready=false forever, so
 *   the probe hooks each layer's errorEvent and stops gating on layers whose
 *   provider terminally failed — the failure is still reported so evidence
 *   and checks can attribute the miss instead of burning the whole timeout.
 * - Primitives: every shown Cesium3DTileset must report `tilesLoaded`; every
 *   shown primitive or collection with a boolean `ready` (Model, Primitive,
 *   GroundPrimitive, BillboardCollection/LabelCollection texture loads) must
 *   be ready. `show === false` subtrees and empty collections are skipped:
 *   they contribute no pixels, and some (hidden or empty billboard
 *   collections) never update, so their `ready` can never turn true.
 * - Entities: `dataSourceDisplay.ready` (geometry batches, plus the one-shot
 *   ApproximateTerrainHeights asset fetch it bootstraps with; entity-backed
 *   glTF models are covered by the Model walk above).
 *
 * The driven render intentionally ticks the widget clock (that is what the
 * default render loop does per frame, and dataSourceDisplay.ready only
 * progresses on ticks); clock-sensitive scenarios opt out via
 * wait_for_tiles: false.
 *
 * Defensive by design: pages without a reachable viewer report
 * `available: false`, and scenes without a globe treat it as loaded.
 */
export const SCENE_SETTLE_PROBE_JS = String.raw`
() => {
  let globalViewer = null;
  try { globalViewer = (typeof viewer !== 'undefined' && viewer && viewer.scene) ? viewer : null; } catch (e) {}
  const viewerRef = globalViewer || window.__EVAL_VIEWER__;
  if (!viewerRef || !viewerRef.scene) return { available: false };
  const scene = viewerRef.scene;

  let renderErrors = 0;
  try { scene.requestRender(); } catch (e) {}
  try {
    if (typeof viewerRef.render === 'function') viewerRef.render();
    else { scene.initializeFrame(); scene.render(); }
  } catch (e) { renderErrors += 1; }

  const defined = (value) => value !== undefined && value !== null;

  const globe = scene.globe;
  const globeOff = !defined(globe) || globe.show === false;
  const terrainPending = !globeOff && !defined(globe.terrainProvider);
  let tilesWaiting = 0;
  try {
    const debug = !globeOff && globe._surface && globe._surface._debug;
    if (debug && typeof debug.tilesWaitingForChildren === 'number') tilesWaiting = debug.tilesWaitingForChildren;
  } catch (e) {}
  const globeLoaded = globeOff || (!terrainPending && globe.tilesLoaded === true && tilesWaiting === 0);

  let imageryTotal = 0;
  let imageryReady = 0;
  let imageryFailed = 0;
  try {
    const layers = viewerRef.imageryLayers || scene.imageryLayers;
    if (layers && typeof layers.length === 'number' && typeof layers.get === 'function') {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers.get(i);
        if (!layer) continue;
        // Watch for terminal provider failures: a rejected async provider
        // (Ion 401/429, bad URL) leaves ready=false forever. An error with
        // ready=true is a transient tile error, ignored by the not-ready
        // guard below.
        if (!layer.__evalErrorHooked && layer.errorEvent && typeof layer.errorEvent.addEventListener === 'function') {
          layer.__evalErrorHooked = true;
          try { layer.errorEvent.addEventListener(() => { layer.__evalProviderErrored = true; }); } catch (e) {}
        }
        if (layer.show === false) continue;
        if (layer.ready === false && layer.__evalProviderErrored) {
          imageryFailed += 1;
          continue;
        }
        imageryTotal += 1;
        if (layer.ready !== false) imageryReady += 1;
      }
    }
  } catch (e) {}

  let tilesetsTotal = 0;
  let tilesetsLoaded = 0;
  let primitivesTotal = 0;
  let primitivesReady = 0;
  const visit = (collection) => {
    if (!collection || typeof collection.length !== 'number' || typeof collection.get !== 'function') return;
    for (let i = 0; i < collection.length; i++) {
      let pr;
      try { pr = collection.get(i); } catch (e) { continue; }
      if (!pr || pr.show === false) continue;
      // Empty collections render nothing but some (BillboardCollection,
      // LabelCollection) hold ready=false until an update that never comes.
      if (typeof pr.length === 'number' && pr.length === 0) continue;
      if (typeof pr.tilesLoaded === 'boolean') {
        tilesetsTotal += 1;
        if (pr.tilesLoaded) tilesetsLoaded += 1;
      } else if (typeof pr.ready === 'boolean') {
        primitivesTotal += 1;
        if (pr.ready) primitivesReady += 1;
      } else if (typeof pr.length === 'number' && typeof pr.get === 'function') {
        visit(pr);
      }
    }
  };
  try { visit(scene.primitives); } catch (e) {}
  try { visit(scene.groundPrimitives); } catch (e) {}

  let dataSourcesReady = true;
  try {
    const dsd = viewerRef.dataSourceDisplay;
    if (dsd && dsd.ready === false) dataSourcesReady = false;
  } catch (e) {}

  // Camera pose, so the waiter can reset its quiet streak while the camera is
  // still moving: cullRequestsWhileMoving (default true) suppresses tile
  // requests during motion, letting tilesLoaded read true for a view whose
  // tiles were never requested.
  let camera = null;
  try {
    const c = scene.camera;
    camera = [c.positionWC.x, c.positionWC.y, c.positionWC.z, c.heading, c.pitch, c.roll];
  } catch (e) {}

  return {
    available: true,
    globe_loaded: globeLoaded,
    terrain_provider_pending: terrainPending,
    tiles_waiting_for_children: tilesWaiting,
    imagery_layers_total: imageryTotal,
    imagery_layers_ready: imageryReady,
    imagery_layers_failed: imageryFailed,
    tilesets_total: tilesetsTotal,
    tilesets_loaded: tilesetsLoaded,
    primitives_total: primitivesTotal,
    primitives_ready: primitivesReady,
    data_sources_ready: dataSourcesReady,
    render_errors: renderErrors,
    camera: camera,
    settled:
      globeLoaded &&
      imageryReady === imageryTotal &&
      tilesetsLoaded === tilesetsTotal &&
      primitivesReady === primitivesTotal &&
      dataSourcesReady,
  };
}
`;

/** Minimal Playwright Page surface used by waitForSceneSettled (unit-testable). */
export interface SettlePage {
  evaluate(script: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
}

/**
 * Invoke a string-form page function. Playwright only auto-invokes real
 * Function objects; a string is evaluated as a plain expression, so a bare
 * arrow-function source silently serializes to undefined without ever
 * running. Wrapping it in an explicit call makes it actually execute.
 */
export function invokePageFunction(page: SettlePage, fnSource: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(`(${fnSource})(${arg === undefined ? "" : JSON.stringify(arg)})`);
}

export interface SettleOptions {
  timeoutMs: number;
  pollMs: number;
  quietPolls: number;
  /** Give up early when no viewer is resolvable within this budget — neither
   * a global `viewer` nor the window.__EVAL_VIEWER__ render-patch capture. */
  viewerGraceMs?: number;
}

export interface SettleResult {
  settled: boolean;
  timed_out: boolean;
  viewer_unavailable: boolean;
  waited_ms: number;
  polls: number;
  /** Polls where the camera pose changed since the previous poll. */
  camera_moved_polls: number;
  /** Every load stream settled, but the camera kept moving (an intentionally
   * animated scene): accepted as settled after the motion-escape streak. */
  settled_with_motion: boolean;
  last_probe: Record<string, any> | null;
}

const TWO_PI = Math.PI * 2;
/** Position (m) and angle (rad) deltas below these are floating-point noise
 * from the pose getters, not motion: heading/pitch/roll are recomputed from
 * the orientation matrix each read and roll in particular jitters across the
 * 0/2π wrap. Real camera motion moves meters and hundredths of radians. */
const POSITION_EPSILON_M = 0.05;
const ANGLE_EPSILON_RAD = 1e-5;

/** Shortest angular distance, wrap-aware (2π-ε vs ε is no movement). */
function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

/** True when two probe camera poses differ beyond floating-point noise
 * (missing poses count as static, and NaN components compare equal so a
 * transient NaN cannot read as perpetual motion). Pose layout:
 * [x, y, z (ECEF meters), heading, pitch, roll (radians)]. */
function cameraMoved(previous: unknown, current: unknown): boolean {
  if (!Array.isArray(previous) || !Array.isArray(current) || previous.length !== current.length) return false;
  return current.some((component, i) => {
    const prev = previous[i];
    if (typeof component !== "number" || typeof prev !== "number") return component !== prev;
    if (Number.isNaN(component) || Number.isNaN(prev)) return Number.isNaN(component) !== Number.isNaN(prev);
    return i >= 3 ? angularDelta(component, prev) > ANGLE_EPSILON_RAD : Math.abs(component - prev) > POSITION_EPSILON_M;
  });
}

/** Human-readable list of what kept a probe from settling (for evidence). */
export function summarizeSettleBlockers(probe: Record<string, any> | null): string {
  if (!probe || probe.available !== true) return "viewer unavailable";
  const blockers: string[] = [];
  if (probe.terrain_provider_pending) blockers.push("terrain provider still resolving");
  else if (probe.globe_loaded === false) blockers.push("globe tiles still streaming");
  if ((probe.imagery_layers_ready ?? 0) < (probe.imagery_layers_total ?? 0)) {
    blockers.push(`imagery layers ${probe.imagery_layers_ready}/${probe.imagery_layers_total} ready`);
  }
  if ((probe.imagery_layers_failed ?? 0) > 0) blockers.push(`${probe.imagery_layers_failed} imagery layer(s) failed to load`);
  if ((probe.tilesets_loaded ?? 0) < (probe.tilesets_total ?? 0)) {
    blockers.push(`3D tilesets ${probe.tilesets_loaded}/${probe.tilesets_total} loaded`);
  }
  if ((probe.primitives_ready ?? 0) < (probe.primitives_total ?? 0)) {
    blockers.push(`primitives ${probe.primitives_ready}/${probe.primitives_total} ready`);
  }
  if (probe.data_sources_ready === false) blockers.push("entity visualizers not ready");
  if ((probe.render_errors ?? 0) > 0) blockers.push("render() is throwing");
  if (!blockers.length && probe.settled === true) return "load streams settled; camera never stopped moving";
  return blockers.length ? blockers.join(", ") : "unknown";
}

/**
 * Poll the page until Cesium reports every load stream finished for
 * `quietPolls` consecutive polls, or until `timeoutMs`. The quiet streak
 * guards two documented upstream behaviors: readiness flickers as LOD
 * refines (tilesLoaded is non-monotonic), and a probe taken while the
 * camera is still moving can read stale-true because moving cameras cull
 * tile requests — so a camera-pose change also resets the streak. The
 * caller decides what a timeout means; this helper only reports honestly
 * what the scene said.
 */
export async function waitForSceneSettled(page: SettlePage, options: SettleOptions): Promise<SettleResult> {
  const started = Date.now();
  const viewerGraceMs = options.viewerGraceMs ?? 10_000;
  // A deliberately animated camera (trackedEntity, per-frame rotation) never
  // stops moving; once every load stream has been settled for this many
  // consecutive polls, accept the scene rather than burning the full timeout.
  const motionEscapePolls = Math.max(options.quietPolls * 5, 20);
  let polls = 0;
  let consecutive = 0;
  let settledStreak = 0;
  let cameraMovedPolls = 0;
  let lastCamera: unknown = null;
  let lastProbe: Record<string, any> | null = null;
  let everAvailable = false;

  for (;;) {
    let probe: Record<string, any>;
    try {
      probe = ((await invokePageFunction(page, SCENE_SETTLE_PROBE_JS)) ?? { available: false }) as Record<string, any>;
    } catch {
      probe = { available: false };
    }
    polls += 1;
    lastProbe = probe;
    const elapsed = Date.now() - started;

    if (probe.available) {
      everAvailable = true;
      const moved = cameraMoved(lastCamera, probe.camera);
      if (moved) cameraMovedPolls += 1;
      lastCamera = probe.camera ?? lastCamera;
      consecutive = probe.settled && !moved ? consecutive + 1 : 0;
      settledStreak = probe.settled ? settledStreak + 1 : 0;
      const settledWithMotion = consecutive < options.quietPolls && settledStreak >= motionEscapePolls;
      if (consecutive >= options.quietPolls || settledWithMotion) {
        return {
          settled: true,
          timed_out: false,
          viewer_unavailable: false,
          waited_ms: elapsed,
          polls,
          camera_moved_polls: cameraMovedPolls,
          settled_with_motion: settledWithMotion,
          last_probe: probe,
        };
      }
    } else {
      consecutive = 0;
      settledStreak = 0;
      if (!everAvailable && elapsed >= viewerGraceMs) {
        return {
          settled: false,
          timed_out: false,
          viewer_unavailable: true,
          waited_ms: elapsed,
          polls,
          camera_moved_polls: cameraMovedPolls,
          settled_with_motion: false,
          last_probe: probe,
        };
      }
    }

    if (elapsed >= options.timeoutMs) {
      return {
        settled: false,
        timed_out: true,
        viewer_unavailable: !everAvailable,
        waited_ms: elapsed,
        polls,
        camera_moved_polls: cameraMovedPolls,
        settled_with_motion: false,
        last_probe: probe,
      };
    }
    await page.waitForTimeout(options.pollMs);
  }
}

/**
 * Whether a screenshot spec should wait for tiles to settle. Defaults to
 * true; scenarios capturing a deliberate mid-animation moment opt out with
 * `wait_for_tiles: false` on the shot (or scenario-wide).
 */
export function shouldWaitForTiles(spec: Record<string, any>, scenario: Record<string, any>): boolean {
  if (spec.wait_for_tiles !== undefined) return spec.wait_for_tiles !== false;
  if (scenario.wait_for_tiles !== undefined) return scenario.wait_for_tiles !== false;
  return true;
}

export function screenshotSpecsFor(scenario: Record<string, any>): Array<Record<string, any>> {
  const specs = scenario.screenshots ?? [{ delay_ms: 3000, timing: "default", description: "default screenshot" }];
  if (scenario.screenshot_mode !== "cardinal_panorama") return [...specs];

  const settleMs = specs.length ? Math.max(...specs.map((item: any) => Number(item.delay_ms ?? 3000))) : 3000;
  const panoramaDelayMs = Number(scenario.panorama_delay_ms ?? 750);
  // Panorama specs are synthesized, so a shot-level wait_for_tiles opt-out on
  // the authored specs would otherwise be silently dropped: carry it over when
  // every authored shot opts out (scenario-level opt-outs already flow through
  // shouldWaitForTiles).
  const optedOut = specs.length > 0 && specs.every((item: any) => item.wait_for_tiles === false);
  return CARDINAL_PANORAMA_SHOTS.map((shot, index) => ({
    ...shot,
    delay_ms: settleMs + index * panoramaDelayMs,
    cardinal_panorama: true,
    index,
    ...(optedOut ? { wait_for_tiles: false } : {}),
  }));
}

// ---------------------------------------------------------------------------
// scenario discovery + run
// ---------------------------------------------------------------------------
export interface ScenarioRun {
  scenario: Record<string, any>;
  codePath: string;
  runDir: string;
}

export const scenarioSlug = (scenario: Record<string, any>): string => `${scenario.id}-${scenario.name}`;

export function findCodePath(generatedDir: string, scenario: Record<string, any>): string {
  const exact = path.join(generatedDir, `${scenario.id}.js`);
  if (fs.existsSync(exact)) return exact;
  const slug = path.join(generatedDir, `${scenarioSlug(scenario)}.js`);
  if (fs.existsSync(slug)) return slug;
  throw new Error(`Missing generated code for ${scenario.id}. Expected ${repoRelative(exact)} or ${repoRelative(slug)}`);
}

export interface RenderOptions {
  skill: string;
  iteration?: string;
  generatedDir?: string;
  outputDir?: string;
  only?: string;
  timeoutMs?: number;
  /** Render without Ion when no token is configured, instead of refusing to
   * run. Opt-in: the optimization loop still demands a token so its trials
   * stay comparable. A configured-but-invalid token always fails. */
  allowMissingIonToken?: boolean;
  /** Sink for per-scenario render failures. The exit code says only THAT
   * something failed; a caller re-rendering over existing bundles needs to know
   * WHICH scenarios, or it will mistake a stale bundle for a fresh one. */
  failures?: RenderFailure[];
}

export interface RenderFailure {
  scenario_id: string;
  error: string;
}

export function loadRuns(options: RenderOptions): ScenarioRun[] {
  const scenariosDir = fromRepoRoot("optimization", "scenarios", options.skill);
  if (!fs.existsSync(scenariosDir)) throw new Error(`Unknown skill or missing scenario directory: ${options.skill}`);

  const only = new Set(
    (options.only ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const iteration = options.iteration ?? "candidate";
  const generatedDir = options.generatedDir
    ? fromRepoRoot(options.generatedDir)
    : fromRepoRoot("optimization", "generated", options.skill, iteration);
  const outputDir = options.outputDir
    ? fromRepoRoot(options.outputDir)
    : fromRepoRoot("optimization", "runs", options.skill, iteration);

  const runs: ScenarioRun[] = [];
  for (const scenarioPath of globFiles(scenariosDir, "eval-", ".json")) {
    const scenario = readJson(scenarioPath);
    if (only.size && !only.has(scenario.id)) continue;
    if ((scenario.runner_mode ?? "global-js") === "review-only") {
      console.log(`[render] skipping review-only scenario ${scenario.id}`);
      continue;
    }
    runs.push({ scenario, codePath: findCodePath(generatedDir, scenario), runDir: path.join(outputDir, scenarioSlug(scenario)) });
  }
  return runs;
}

async function startStaticServer(root: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] ?? "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function renderCommand(ctx: EvalContext, options: RenderOptions): Promise<number> {
  const runs = loadRuns(options);
  if (!runs.length) {
    console.error("No runnable scenarios selected");
    return 2;
  }
  // The eval page is served from the repo root, so a run directory outside it
  // is unreachable: the page 404s, Cesium never loads, and every bundle looks
  // mysteriously broken. Refuse up front instead.
  const outside = runs.filter((run) => !isUnder(run.runDir, ctx.repoRoot));
  if (outside.length) {
    console.error(
      `Output directory must live inside the repository (the eval page is served from the repo root): ${outside[0].runDir}`,
    );
    return 2;
  }

  const browserConfig: BrowserConfig = ctx.config.browser;
  const ionToken = options.allowMissingIonToken ? resolveOptionalIonToken() : resolveIonToken();
  if (ionToken === null) {
    console.warn("[render] No Ion token configured — rendering without Ion imagery/terrain. Set CESIUM_ION_TOKEN to render those faithfully.");
  } else {
    await preflightIon(ionToken, browserConfig.ionPreflightAssetId, process.env.EVAL_SKIP_ION_PREFLIGHT === "1");
  }

  const commit = gitCommit(ctx.repoRoot);
  const timestampUtc = new Date().toISOString();
  const timeoutMs = options.timeoutMs ?? browserConfig.navigationTimeoutMs;

  const { chromium } = await import("playwright");
  const server = await startStaticServer(ctx.repoRoot);
  const browser = await chromium.launch({ headless: true });
  const chromiumVersion = browser.version();
  const playwrightVersion = await import("playwright/package.json", { with: { type: "json" } })
    .then((pkg: any) => pkg.default?.version ?? pkg.version ?? "unknown")
    .catch(() => "unknown");

  // One scenario's failure (a navigation timeout, a page crash) used to abort
  // the whole render, throwing away every bundle still queued behind it. Each
  // run is isolated instead: failures are named, the rest still render, and a
  // non-zero exit reports that the set is incomplete.
  const failures: RenderFailure[] = [];
  try {
    for (const run of runs) {
      let openPage: { close(): Promise<void> } | null = null;
      try {
        const generatedCode = fs.readFileSync(run.codePath, "utf-8");
        fs.mkdirSync(run.runDir, { recursive: true });
        const htmlPath = path.join(run.runDir, "eval.html");
        fs.writeFileSync(htmlPath, renderHtml(browserConfig.cesiumVersion, ionToken, generatedCode));

        const consoleMessages: Array<Record<string, any>> = [];
        const networkFailures: Array<Record<string, any>> = [];
        const page = await browser.newPage({ viewport: browserConfig.viewport });
        openPage = page;
        page.on("console", (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
        page.on("response", (response) => {
          if (response.status() >= 400) {
            networkFailures.push({ url: sanitizeUrl(response.url()), status: response.status(), status_text: response.statusText() });
          }
        });
        page.on("requestfailed", (request) => {
          networkFailures.push({ url: sanitizeUrl(request.url()), failure: request.failure()?.errorText ?? null });
        });

        // "load" rather than "networkidle": streaming scenes never reach idle.
        await page.goto(`${server.baseUrl}/${repoRelative(htmlPath)}`, { waitUntil: "load", timeout: timeoutMs });

        const specs = screenshotSpecsFor(run.scenario);
        const screenshotsTaken: Array<Record<string, any>> = [];
        const screenshotQuality: Array<Record<string, any>> = [];
        let anySettleTimedOut = false;
        // Failures of the harness's own page helpers, folded into the bundle's
        // error list so they are evidence rather than a lost run.
        const harnessErrors: Array<Record<string, any>> = [];
        const settleOptions: SettleOptions = {
          timeoutMs: browserConfig.tileSettleTimeoutMs,
          pollMs: browserConfig.tileSettlePollMs,
          quietPolls: browserConfig.tileSettleQuietPolls,
          viewerGraceMs: browserConfig.tileSettleViewerGraceMs,
        };

        for (let i = 0; i < specs.length; i++) {
          const spec = specs[i];
          const delayMs = Number(spec.delay_ms ?? 1000);
          await page.waitForTimeout(i === 0 ? delayMs : delayMs - Number(specs[i - 1].delay_ms ?? 0));
          if (spec.cardinal_panorama) {
            try {
              await invokePageFunction(page, ORBIT_PANORAMA_JS, {
                headingDegrees: Number(spec.heading_degrees ?? 0),
                index: Number(spec.index ?? i),
              });
            } catch (exc: any) {
              // The orbit helper needs Cesium on the page; when the library
              // itself failed to load it throws. Losing the whole bundle to
              // that would also lose the console log that explains it, so the
              // capture continues and the reason is recorded as an error.
              const message = exc?.message ?? String(exc);
              console.warn(`[render] ${run.scenario.id} shot ${i}: panorama orbit failed: ${message}`);
              harnessErrors.push({ message: `panorama orbit failed: ${message}`, source: "harness" });
            }
            await page.waitForTimeout(250);
          }
          // Safeguard against partial-load captures: the fixed delay is only a
          // floor. Before the shutter fires, wait until every load stream the
          // scene exposes reports finished (camera moves — panorama included —
          // restart streaming). Timeouts are recorded, never hidden. After one
          // shot times out, later shots in the same scenario run against a
          // reduced budget: a terminally latched blocker (failed provider,
          // 404'd model) would otherwise burn the full timeout once per shot.
          let settle: SettleResult | null = null;
          if (shouldWaitForTiles(spec, run.scenario)) {
            const timeoutMs = anySettleTimedOut
              ? Math.max(settleOptions.quietPolls * settleOptions.pollMs + 2_000, Math.floor(settleOptions.timeoutMs / 4))
              : settleOptions.timeoutMs;
            settle = await waitForSceneSettled(page, { ...settleOptions, timeoutMs });
            if (settle.timed_out) {
              anySettleTimedOut = true;
              console.warn(
                `[render] ${run.scenario.id} shot ${i}: scene still loading after ${settle.waited_ms}ms ` +
                  `(${summarizeSettleBlockers(settle.last_probe)}) — capturing anyway and flagging`,
              );
            }
          }
          const filename = specs.length > 1 ? `screenshot-${i}.png` : "screenshot.png";
          const screenshotPath = path.join(run.runDir, filename);
          await page.screenshot({ path: screenshotPath, fullPage: true, timeout: browserConfig.screenshotTimeoutMs });
          screenshotsTaken.push({
            index: i,
            timing: spec.timing ?? `screenshot-${i}`,
            delay_ms: delayMs,
            description: spec.description ?? "",
            filename,
            tile_settle: settle
              ? {
                  settled: settle.settled,
                  timed_out: settle.timed_out,
                  viewer_unavailable: settle.viewer_unavailable,
                  waited_ms: settle.waited_ms,
                  camera_moved_polls: settle.camera_moved_polls,
                  settled_with_motion: settle.settled_with_motion,
                  last_probe: settle.last_probe,
                }
              : { skipped: true },
          });
          const quality = analyzeScreenshot(screenshotPath, browserConfig.viewport.width, browserConfig.viewport.height);
          applySettleToQuality(quality, settle);
          screenshotQuality.push(quality);
        }

        if (specs.some((spec) => spec.cardinal_panorama)) {
          try {
            await invokePageFunction(page, ORBIT_RESTORE_JS);
            await page.waitForTimeout(100);
          } catch {
            // camera restore is best-effort
          }
        }

        const errors: Array<Record<string, any>> = [
          ...((await page.evaluate("window.__CESIUM_EVAL_ERRORS__ || []")) as Array<Record<string, any>>),
          ...harnessErrors,
        ];
        const cesiumRenderError = await page.evaluate(`
          (() => {
            const panel = document.querySelector('.cesium-widget-errorPanel');
            const bodyText = document.body ? document.body.innerText || '' : '';
            if (panel || bodyText.includes('An error occurred while rendering. Rendering has stopped')) {
              return {
                message: bodyText.includes('An error occurred while rendering. Rendering has stopped')
                  ? 'Cesium render error panel detected'
                  : 'Cesium render error panel detected without body text',
                source: 'cesium-widget-errorPanel'
              };
            }
            return null;
          })()
        `);
        if (cesiumRenderError) errors.push(cesiumRenderError as Record<string, any>);

        let sceneState: Record<string, any>;
        try {
          sceneState = (await page.evaluate(`
            (() => {
              let globalViewer = null;
              try { globalViewer = (typeof viewer !== 'undefined' && viewer && viewer.scene) ? viewer : null; } catch (e) {}
              const viewerRef = globalViewer || window.__EVAL_VIEWER__;
              if (!viewerRef || !viewerRef.scene) {
                return { available: false };
              }
              const scene = viewerRef.scene;
              const camera = scene.camera;
              return {
                available: true,
                camera: {
                  position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                  heading: camera.heading,
                  pitch: camera.pitch,
                  roll: camera.roll
                },
                entity_count: viewerRef.entities ? viewerRef.entities.values.length : 0,
                imagery_layer_count: (viewerRef.imageryLayers || scene.imageryLayers) ? (viewerRef.imageryLayers || scene.imageryLayers).length : 0,
                primitive_count: scene.primitives ? scene.primitives.length : 0
              };
            })()
          `)) as Record<string, any>;
        } catch {
          sceneState = { available: false, error: "Failed to extract scene state" };
        }

        let webglRenderer: string | null = null;
        try {
          webglRenderer = (await page.evaluate(`
            (() => {
              const canvas = document.createElement('canvas');
              const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
              if (!gl) return null;
              const ext = gl.getExtension('WEBGL_debug_renderer_info');
              return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
            })()
          `)) as string | null;
        } catch {
          webglRenderer = null;
        }

        await page.close();
        openPage = null;

        const consoleJsonPath = path.join(run.runDir, "console.json");
        writeJsonPlain(consoleJsonPath, {
          scenario_id: run.scenario.id,
          console_messages: consoleMessages,
          errors,
          network_failures: networkFailures,
          screenshots: screenshotsTaken,
        });

        const sceneStatePath = path.join(run.runDir, "scene-state.json");
        writeJsonPlain(sceneStatePath, sceneState);

        const qualityPath = path.join(run.runDir, "screenshot-quality.json");
        const qualityReport = {
          scenario_id: run.scenario.id,
          screenshots: screenshotQuality,
          all_passed: screenshotQuality.every((item) => item.passed),
        };
        writeJsonPlain(qualityPath, qualityReport);

        const checksPath = path.join(run.runDir, "programmatic-checks.json");
        writeJsonPlain(
          checksPath,
          addScreenshotQualityChecks(
            runProgrammaticChecks(run.scenario, generatedCode, errors, sceneState, consoleMessages, networkFailures),
            qualityReport,
          ),
        );

        const metaPath = run.codePath.replace(/\.js$/, ".meta.json");
        const generationMeta = fs.existsSync(metaPath) ? readJson(metaPath) : {};
        const scenarioHash = sha256Text(canonicalStringify(run.scenario));

        const artifactHashes: Record<string, any> = {
          console: sha256File(consoleJsonPath),
          programmatic_checks: sha256File(checksPath),
          scene_state: sha256File(sceneStatePath),
          screenshot_quality: sha256File(qualityPath),
        };
        const screenshotHashes = screenshotsTaken
          .filter((info) => fs.existsSync(path.join(run.runDir, info.filename)))
          .map((info) => ({ filename: info.filename, hash: sha256File(path.join(run.runDir, info.filename)) }));
        if (screenshotHashes.length) artifactHashes.screenshots = screenshotHashes;

        const metadata: Record<string, any> = {
          scenario_version_hash: scenarioHash,
          candidate_skill_hash: generationMeta.skill_content_hash ?? sha256Text(generatedCode),
          runner_git_commit: commit,
          model_id: generationMeta.model_id ?? "unknown",
          temperature: generationMeta.temperature ?? 1.0,
          judge_protocol_version: ctx.config.judgePanel.pairwiseProtocol,
          capture_protocol_version: CAPTURE_PROTOCOL_VERSION,
          browser_viewport: browserConfig.viewport,
          playwright_version: playwrightVersion,
          chromium_version: chromiumVersion,
          webgl_renderer: webglRenderer,
          timestamp_utc: timestampUtc,
          artifact_hashes: artifactHashes,
        };
        if ("seed" in generationMeta) metadata.seed = generationMeta.seed;
        writeJsonPlain(path.join(run.runDir, "metadata.json"), metadata);

        console.log(`[render] wrote ${repoRelative(run.runDir)}`);
      } catch (exc: any) {
        const message = exc?.message ?? String(exc);
        const failure: RenderFailure = { scenario_id: run.scenario.id, error: message };
        failures.push(failure);
        options.failures?.push(failure);
        console.error(`[render] ${run.scenario.id} FAILED: ${message}`);
      } finally {
        await openPage?.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    await server.close();
  }
  if (failures.length) {
    console.error(`[render] ${failures.length}/${runs.length} scenario(s) failed to render: ${failures.map((f) => f.scenario_id).join(", ")}`);
    return 1;
  }
  return 0;
}

export function sanitizeUrl(value: string): string {
  return value.replace(/([?&](?:access_token|token|key|api_key|apiKey)=)[^&#]+/gi, "$1[REDACTED]");
}

/**
 * Version of the screenshot capture gate, stamped into bundle metadata. Bump
 * whenever the settle semantics change enough that bundles captured under the
 * old gate are not comparable with new ones (environmentMismatch flags the
 * pairing, prompting a baseline re-render).
 */
export const CAPTURE_PROTOCOL_VERSION = "settle-gate-v2";
