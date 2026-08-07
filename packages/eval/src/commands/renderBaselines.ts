/**
 * `cesium-eval render-baselines` — render each skill's archived baseline code
 * into a screenshot the visual audit can judge.
 *
 * This closes the "starting data" gap: the baseline fixtures ship generated
 * code and programmatic evidence but no screenshots, so a visual audit had
 * nothing to look at and short-circuited. This renders the baseline code in a
 * headless browser and writes <out>/<skill>/<caseId>/screenshot.png, which
 * `audit --bundle-root <out>` then resolves per case.
 *
 * The Ion token is OPTIONAL here: scenarios that bring their own imagery
 * (OpenStreetMap, custom providers) render fully without it. Scenarios that
 * rely on Ion imagery/terrain still render (globe + entities), just without
 * the Ion basemap. Set CESIUM_ION_TOKEN to render those faithfully.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, globFiles, repoRelative } from "../lib/paths.js";
import type { EvalContext } from "../config/types.js";
import { resolveIonToken } from "../optimization/browserRunner.js";

export interface RenderBaselinesOptions {
  skills?: string;
  out?: string;
  only?: string;
  force?: boolean;
}

const FIXTURES_ROOT = () => fromRepoRoot("evaluation", "fixtures");
const DEFAULT_OUT = "evaluation/artifacts/baselines";

/**
 * The bundle directory the AUDIT will look in for this case's screenshot,
 * under a given bundle-root. This mirrors audit.ts bundleDirFor exactly so a
 * rendered screenshot lands precisely where the audit resolves it:
 *   run_artifact_path .../baseline/<slug> -> <out>/<skill>/baseline/<slug>
 *   (no artifact path)                    -> <out>/<skill>/<caseId>
 */
function auditBundleDir(outAbs: string, evidence: Record<string, any>, skill: string, caseId: string): string {
  const rel = evidence.run_artifact_path;
  if (!rel) return path.join(outAbs, skill, caseId);
  const parts = String(rel).split(/[\\/]/);
  const baselineIndex = parts.indexOf("baseline");
  return baselineIndex > 0
    ? path.join(outAbs, ...parts.slice(baselineIndex - 1))
    : path.join(outAbs, path.basename(String(rel)));
}

/** Baseline fixtures for a skill: the *.evidence.json with generated code. */
function baselineFixtures(skill: string): string[] {
  return globFiles(path.join(FIXTURES_ROOT(), skill), "", ".evidence.json").sort();
}

function harnessHtml(cesiumVersion: string, ionToken: string | null, code: string): string {
  // Token line is emitted only when present, so a missing token is a no-op
  // rather than a thrown "invalid token" at page load.
  const tokenLine = ionToken ? `Cesium.Ion.defaultAccessToken = ${JSON.stringify(ionToken)};` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Baseline render</title>
<script src="https://cesium.com/downloads/cesiumjs/releases/${cesiumVersion}/Build/Cesium/Cesium.js"></script>
<link href="https://cesium.com/downloads/cesiumjs/releases/${cesiumVersion}/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
<style>html,body,#cesiumContainer{width:100%;height:100%;margin:0;padding:0;overflow:hidden}</style></head>
<body><div id="cesiumContainer"></div><script>
window.__evalErrors = [];
addEventListener("error", (e) => window.__evalErrors.push(String(e.error || e.message || "error")));
addEventListener("unhandledrejection", (e) => window.__evalErrors.push(String(e.reason || "rejection")));
try { ${tokenLine} } catch (e) {}
(async () => { try { ${code} } catch (e) { window.__evalErrors.push("THROW: " + (e && e.stack || e)); } })();
</script></body></html>`;
}

interface RenderResult {
  skill: string;
  caseId: string;
  ok: boolean;
  screenshot: string | null;
  errors: string[];
}

async function renderOne(
  browser: Browser,
  html: string,
  outFile: string,
  viewport: { width: number; height: number },
  settleMs: number,
): Promise<{ ok: boolean; errors: string[] }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 60_000 });
    // Let the scene settle: poll tilesLoaded, fall back to a fixed wait so a
    // scene that never reports loaded (no imagery) still gets captured.
    const deadline = Date.now() + settleMs;
    while (Date.now() < deadline) {
      const settled = await page
        .evaluate(() => {
          const v = (globalThis as any).viewer;
          return !v || !v.scene || v.scene.globe?.tilesLoaded !== false;
        })
        .catch(() => true);
      if (settled) break;
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1_500);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile });
    const errors = (await page.evaluate(() => (globalThis as any).__evalErrors ?? []).catch(() => [])) as string[];
    return { ok: fs.existsSync(outFile), errors: errors.slice(0, 5) };
  } finally {
    await page.close().catch(() => {});
    server.close();
  }
}

export async function renderBaselinesCommand(ctx: EvalContext, options: RenderBaselinesOptions): Promise<number> {
  const allSkills = fs
    .readdirSync(FIXTURES_ROOT(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const requested = !options.skills || options.skills === "all" ? allSkills : options.skills.split(",").map((s) => s.trim());
  const unknown = requested.filter((s) => !allSkills.includes(s));
  if (unknown.length) {
    console.error(`error: unknown skill(s): ${unknown.join(", ")}`);
    return 2;
  }
  const onlyCases = options.only ? new Set(options.only.split(",").map((s) => s.trim())) : null;

  const outRoot = options.out ?? DEFAULT_OUT;
  const outAbs = fromRepoRoot(outRoot);
  const { cesiumVersion, viewport, tileSettleTimeoutMs } = ctx.config.browser;

  // Token optional: use it if the environment has a valid one, otherwise
  // render without Ion imagery rather than refusing to run.
  let ionToken: string | null = null;
  try {
    ionToken = resolveIonToken();
    console.log("[render-baselines] Ion token found — rendering with Ion imagery.");
  } catch {
    console.log("[render-baselines] No Ion token — rendering without Ion imagery (scenarios with their own imagery are unaffected).");
  }

  const browser = await chromium.launch();
  const results: RenderResult[] = [];
  try {
    for (const skill of requested) {
      for (const fixture of baselineFixtures(skill)) {
        const evidence = readJson(fixture);
        const caseId = String(evidence.case_id ?? "");
        if (onlyCases && !onlyCases.has(caseId)) continue;
        const code = typeof evidence.generated_code === "string" ? evidence.generated_code : "";
        const outFile = path.join(auditBundleDir(outAbs, evidence, skill, caseId), "screenshot.png");
        if (!code) {
          results.push({ skill, caseId, ok: false, screenshot: null, errors: ["fixture has no generated_code"] });
          continue;
        }
        if (!options.force && fs.existsSync(outFile)) {
          results.push({ skill, caseId, ok: true, screenshot: repoRelative(outFile), errors: [] });
          console.log(`[render-baselines] ${skill}/${caseId} — cached`);
          continue;
        }
        const { ok, errors } = await renderOne(browser, harnessHtml(cesiumVersion, ionToken, code), outFile, viewport, tileSettleTimeoutMs);
        results.push({ skill, caseId, ok, screenshot: ok ? repoRelative(outFile) : null, errors });
        console.log(`[render-baselines] ${skill}/${caseId} — ${ok ? "rendered" : "FAILED"}${errors.length ? ` (${errors[0]})` : ""}`);
      }
    }
  } finally {
    await browser.close();
  }

  const manifestPath = path.join(outAbs, "manifest.json");
  fs.mkdirSync(outAbs, { recursive: true });
  writeJsonPlain(manifestPath, { generated_utc: null, out_root: outRoot, results });
  const rendered = results.filter((r) => r.ok).length;
  console.log(`[render-baselines] ${rendered}/${results.length} rendered -> ${outRoot}`);
  console.log(`[render-baselines] run: cesium-eval audit --skills ${requested.join(",")} --bundle-root ${outRoot} ...`);
  return rendered > 0 ? 0 : 1;
}
