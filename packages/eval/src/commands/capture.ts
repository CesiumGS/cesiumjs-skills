/**
 * `cesium-eval capture` — capture before/after Cesium scene-state evidence
 * for an evaluation case in a headless browser.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { readJson, stableStringify } from "../lib/json.js";
import { fromRepoRoot, repoRelative } from "../lib/paths.js";
import { runCase } from "../evaluation/runner.js";
import type { BrowserConfig, EvalContext } from "../config/types.js";

const harnessHtml = (cesiumVersion: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CesiumJS Deterministic Evaluation Harness</title>
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
    window.__evalErrors = [];
    window.__evalEvents = { click_log: [] };
    window.__recordEvalClick = function(item) {
      window.__evalEvents.click_log.push(Object.assign({ type: "LEFT_CLICK" }, item || {}));
    };
    window.addEventListener("error", (event) => {
      window.__evalErrors.push(String(event.error || event.message || "unknown error"));
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__evalErrors.push(String(event.reason || "unhandled rejection"));
    });

    async function boot() {
      window.__viewer = new Cesium.Viewer("cesiumContainer", {
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        terrain: undefined
      });
      window.__viewerReady = true;
    }

    window.__applyPreflight = function(preflight) {
      const entities = (preflight && preflight.entities) || [];
      for (const item of entities) {
        const carto = item.position_cartographic || {};
        const position = Cesium.Cartesian3.fromDegrees(
          Number(carto.longitude_deg),
          Number(carto.latitude_deg),
          Number(carto.altitude_m || 0)
        );
        window.__viewer.entities.add({
          id: item.id,
          position,
          point: { pixelSize: 10, color: Cesium.Color.YELLOW }
        });
      }
    };

    function captureCamera() {
      const camera = window.__viewer.camera;
      return {
        position_ecef: [camera.position.x, camera.position.y, camera.position.z],
        direction_ecef: [camera.direction.x, camera.direction.y, camera.direction.z],
        up_ecef: [camera.up.x, camera.up.y, camera.up.z],
        heading_pitch_roll: {
          heading: camera.heading,
          pitch: camera.pitch,
          roll: camera.roll
        }
      };
    }

    function captureEntity(id, now) {
      const entity = window.__viewer.entities.getById(id);
      if (!entity) {
        return null;
      }
      const out = {};
      const value = entity.position && entity.position.getValue(now);
      if (value) {
        const carto = Cesium.Cartographic.fromCartesian(value);
        out.position_ecef = [value.x, value.y, value.z];
        out.position_cartographic = {
          longitude_deg: Cesium.Math.toDegrees(carto.longitude),
          latitude_deg: Cesium.Math.toDegrees(carto.latitude),
          altitude_m: carto.height
        };
      }
      if (entity.properties) {
        out.properties = {};
        const names = entity.properties.propertyNames || [];
        for (const name of names) {
          const property = entity.properties[name];
          out.properties[name] = property && property.getValue ? property.getValue(now) : property;
        }
      }
      return out;
    }

    function captureImageryLayers() {
      const layers = window.__viewer.imageryLayers;
      const out = [];
      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers.get(i);
        const provider = layer.imageryProvider;
        out.push({
          provider: provider && provider.constructor ? provider.constructor.name : String(provider),
          alpha: layer.alpha,
          brightness: layer.brightness,
          contrast: layer.contrast,
          hue: layer.hue,
          saturation: layer.saturation,
          gamma: layer.gamma,
          show: layer.show,
          splitDirection: layer.splitDirection
        });
      }
      return out;
    }

    function primitiveType(primitive) {
      return primitive && primitive.constructor ? primitive.constructor.name : String(primitive);
    }

    function primitiveRequiresIon(primitive) {
      const candidates = [
        primitive && primitive._url,
        primitive && primitive.url,
        primitive && primitive.resource && primitive.resource.url,
        primitive && primitive._resource && primitive._resource.url
      ].filter(Boolean).map(String);
      return candidates.some((value) => value.includes("api.cesium.com") || value.includes("ion.cesium.com"));
    }

    function capturePrimitives() {
      const out = [];
      for (let i = 0; i < window.__viewer.scene.primitives.length; i += 1) {
        const primitive = window.__viewer.scene.primitives.get(i);
        out.push({
          type: primitiveType(primitive),
          show: primitive && primitive.show,
          ready: primitive && typeof primitive.ready !== "undefined" ? Boolean(primitive.ready) : undefined,
          requiresIonToken: primitiveRequiresIon(primitive)
        });
      }
      return out;
    }

    function captureTilesets() {
      const out = [];
      for (let i = 0; i < window.__viewer.scene.primitives.length; i += 1) {
        const primitive = window.__viewer.scene.primitives.get(i);
        if (!primitive || primitiveType(primitive) !== "Cesium3DTileset") {
          continue;
        }
        const requiresIon = primitiveRequiresIon(primitive);
        const source = primitive.__evalSource || (requiresIon ? "ion-asset" : "public-url");
        const boundingSphere = primitive.boundingSphere;
        const distance = boundingSphere && window.__viewer.camera
          ? Cesium.Cartesian3.distance(window.__viewer.camera.position, boundingSphere.center)
          : undefined;
        out.push({
          type: "Cesium3DTileset",
          source,
          ready: typeof primitive.ready !== "undefined" ? Boolean(primitive.ready) : true,
          requiresIonToken: requiresIon,
          distanceToCameraMeters: distance
        });
      }
      return out;
    }

    function captureTerrain() {
      const provider = window.__viewer.terrainProvider || (window.__viewer.scene && window.__viewer.scene.terrainProvider);
      const name = provider && provider.constructor ? provider.constructor.name : String(provider);
      return {
        provider: name,
        requiresIonToken: /CesiumTerrainProvider|GoogleEarthEnterpriseTerrainProvider/.test(name)
      };
    }

    window.__captureSceneState = function(capturePaths) {
      const now = Cesium.JulianDate.now();
      const paths = capturePaths || [];
      const out = { entities: {} };
      for (const path of paths) {
        if (path.startsWith("camera.")) {
          out.camera = captureCamera();
        }
        const entityMatch = path.match(/^entities\\[([^\\]]+)\\]\\./);
        if (entityMatch) {
          const id = entityMatch[1];
          const entity = captureEntity(id, now);
          if (entity !== null) {
            out.entities[id] = Object.assign(out.entities[id] || {}, entity);
          }
        }
        if (path.startsWith("imagery_layers[*].")) {
          out.imagery_layers = captureImageryLayers();
        }
        if (path.startsWith("clock.")) {
          out.clock = {
            startTime: window.__viewer.clock.startTime && window.__viewer.clock.startTime.toString(),
            stopTime: window.__viewer.clock.stopTime && window.__viewer.clock.stopTime.toString(),
            currentTime: window.__viewer.clock.currentTime && window.__viewer.clock.currentTime.toString(),
            multiplier: window.__viewer.clock.multiplier,
            shouldAnimate: window.__viewer.clock.shouldAnimate
          };
        }
        if (path.startsWith("scene.")) {
          out.scene = {
            mode: window.__viewer.scene.mode,
            requestRenderMode: window.__viewer.scene.requestRenderMode,
            maximumRenderTimeChange: window.__viewer.scene.maximumRenderTimeChange,
            primitives_length: window.__viewer.scene.primitives.length
          };
        }
        if (path.startsWith("globe.") && window.__viewer.scene.globe) {
          out.globe = {
            show: window.__viewer.scene.globe.show,
            enableLighting: window.__viewer.scene.globe.enableLighting,
            depthTestAgainstTerrain: window.__viewer.scene.globe.depthTestAgainstTerrain,
            translucency_enabled: window.__viewer.scene.globe.translucency && window.__viewer.scene.globe.translucency.enabled
          };
        }
        if (path.startsWith("terrain.")) {
          out.terrain = captureTerrain();
        }
        if (path.startsWith("primitives[*].")) {
          out.primitives = capturePrimitives();
        }
        if (path.startsWith("tilesets[*].")) {
          out.tilesets = captureTilesets();
        }
        if (path.startsWith("data_sources[*].")) {
          out.data_sources = [];
          const sources = window.__viewer.dataSources;
          for (let i = 0; i < sources.length; i += 1) {
            const source = sources.get(i);
            out.data_sources.push({
              name: source.name,
              type: source && source.constructor ? source.constructor.name : String(source),
              entity_count: source.entities ? source.entities.values.length : 0
            });
          }
        }
        if (path.startsWith("events.")) {
          out.events = JSON.parse(JSON.stringify(window.__evalEvents || {}));
        }
      }
      return out;
    };

    window.__runCandidateSource = async function(source) {
      const fn = new Function("viewer", "Cesium", source);
      return await fn(window.__viewer, Cesium);
    };

    boot();
  </script>
</body>
</html>
`;

function caseSlug(caseDoc: Record<string, any>): string {
  return `${caseDoc.id ?? "case"}-${caseDoc.name ?? "unnamed"}`;
}

function entityIdsFromCase(caseDoc: Record<string, any>): string[] {
  const ids = new Set<string>();
  for (const item of (caseDoc.preflight ?? {}).entities ?? []) {
    if (typeof item.id === "string" && item.id) ids.add(item.id);
  }
  for (const check of caseDoc.checks ?? []) {
    if (typeof check.entity_id === "string" && check.entity_id) ids.add(check.entity_id);
  }
  for (const capture of (caseDoc.probe ?? {}).capture ?? []) {
    const match = /^entities\[([^\]]+)\]/.exec(String(capture));
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

function capturePathsFromCase(caseDoc: Record<string, any>): string[] {
  const paths = new Set<string>(((caseDoc.probe ?? {}).capture ?? []).map(String));
  for (const entityId of entityIdsFromCase(caseDoc)) {
    paths.add(`entities[${entityId}].position_ecef`);
    paths.add(`entities[${entityId}].position_cartographic`);
  }
  return [...paths].sort();
}

async function captureEvidence(
  caseDoc: Record<string, any>,
  candidateSource: string,
  htmlPath: string,
  headless: boolean,
  browser: BrowserConfig,
): Promise<Record<string, any>> {
  const capturePaths = capturePathsFromCase(caseDoc);
  if (!capturePaths.length) throw new Error("case does not declare any probe.capture paths");

  const { chromium } = await import("playwright");
  const instance = await chromium.launch({ headless });
  try {
    const page = await instance.newPage({ viewport: browser.viewport });
    const token = process.env.CESIUM_ION_TOKEN;
    if (token) {
      await page.addInitScript(`Object.defineProperty(window, '__CESIUM_ION_TOKEN', { value: ${JSON.stringify(token)} });`);
    }
    // "load" not "networkidle": streaming scenes keep the network busy forever.
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: browser.navigationTimeoutMs });
    await page.waitForFunction("window.__viewerReady === true");
    if (token) await page.evaluate("Cesium.Ion.defaultAccessToken = window.__CESIUM_ION_TOKEN");
    await page.evaluate((preflight) => (globalThis as any).__applyPreflight(preflight), caseDoc.preflight ?? {});
    const settleMs = Number((caseDoc.preflight ?? {}).settle_ms ?? 0);
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    const before = await page.evaluate((paths) => (globalThis as any).__captureSceneState(paths), capturePaths);
    await page.evaluate((source) => (globalThis as any).__runCandidateSource(source), candidateSource);
    await page.waitForTimeout(Number(caseDoc.timeout_ms ?? 1000));
    const after = await page.evaluate((paths) => (globalThis as any).__captureSceneState(paths), capturePaths);
    const errors = await page.evaluate("window.__evalErrors");

    const evidence: Record<string, any> = {
      schema_version: 1,
      case_id: caseDoc.id,
      case_name: caseDoc.name,
      skill: caseDoc.skill,
      source: "browser-capture",
      generated_code: candidateSource,
      execution: { success: !(Array.isArray(errors) && errors.length) },
      before,
      after,
    };
    if (Array.isArray(errors) && errors.length) evidence.errors = errors;
    return evidence;
  } finally {
    await instance.close().catch(() => undefined);
  }
}

export interface CaptureOptions {
  case: string;
  candidateJs: string;
  output?: string;
  runChecks?: boolean;
  noHeadless?: boolean;
}

export async function captureCommand(ctx: EvalContext, options: CaptureOptions): Promise<number> {
  const caseDoc = readJson(options.case);
  const candidateSource = fs.readFileSync(options.candidateJs, "utf-8");

  let outputPath = options.output;
  if (!outputPath) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    outputPath = fromRepoRoot(
      "evaluation",
      "artifacts",
      String(caseDoc.skill ?? "unknown-skill"),
      `${caseSlug(caseDoc)}-${stamp}.evidence.json`,
    );
  }
  outputPath = fromRepoRoot(outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const baseName = path.basename(outputPath, path.extname(outputPath));
  const runDir = path.join(path.dirname(outputPath), `${baseName}-harness`);
  fs.mkdirSync(runDir, { recursive: true });
  const htmlPath = path.join(runDir, "harness.html");
  fs.writeFileSync(htmlPath, harnessHtml(ctx.config.browser.cesiumVersion));

  const evidence = await captureEvidence(caseDoc, candidateSource, htmlPath, !options.noHeadless, ctx.config.browser);
  fs.writeFileSync(outputPath, stableStringify(evidence) + "\n");
  console.log(`[capture] wrote ${repoRelative(outputPath)}`);

  if (options.runChecks) {
    const result = runCase(caseDoc, evidence);
    console.log(stableStringify(result));
    return result.result === "pass" ? 0 : 1;
  }
  return 0;
}
