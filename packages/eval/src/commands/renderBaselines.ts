/**
 * `cesium-eval render-baselines` — render each skill's baseline code into a
 * screenshot the visual audit can judge.
 *
 * This closes the "starting data" gap: a scenario ships a prompt and its
 * generated baseline source but no screenshot, so a visual audit had nothing
 * to look at and short-circuited. This renders that source in a headless
 * browser into exactly the bundle directory `audit --bundle-root <out>`
 * resolves for the same scenario (both sides share ../evaluation/baselines.js,
 * so coverage and judging can never disagree about where a screenshot lives).
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
import { writeJsonPlain } from "../lib/json.js";
import { fromRepoRoot, repoRelative } from "../lib/paths.js";
import type { EvalContext } from "../config/types.js";
import { resolveIonToken } from "../optimization/browserRunner.js";
import { baselineScenarios, baselineSkills, bundleDirFor, generatedCodePath, readGeneratedCode } from "../evaluation/baselines.js";

export interface RenderBaselinesOptions {
  skills?: string;
  out?: string;
  only?: string;
  force?: boolean;
}

const DEFAULT_OUT = "evaluation/artifacts/baselines";

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
  const allSkills = baselineSkills();
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
      for (const scenario of baselineScenarios(skill)) {
        const caseId = scenario.id;
        if (onlyCases && !onlyCases.has(caseId)) continue;
        // Render into exactly the directory the audit resolves for this
        // scenario, so a rendered screenshot is always the one judged.
        const outFile = path.join(bundleDirFor(scenario, outAbs), "screenshot.png");
        // An existing screenshot already satisfies the audit, so report it as
        // cached before asking for source: a rendered bundle stays usable even
        // when its generating source is not checked out.
        if (!options.force && fs.existsSync(outFile)) {
          results.push({ skill, caseId, ok: true, screenshot: repoRelative(outFile), errors: [] });
          console.log(`[render-baselines] ${skill}/${caseId} — cached`);
          continue;
        }
        const code = readGeneratedCode(scenario);
        if (!code) {
          // Nothing to draw and nothing already drawn. Say so precisely, with
          // the path we looked for, instead of a silent zero-render success.
          results.push({
            skill,
            caseId,
            ok: false,
            screenshot: null,
            errors: [`no generated baseline source at ${repoRelative(generatedCodePath(scenario))} (run the optimization loop first)`],
          });
          console.log(`[render-baselines] ${skill}/${caseId} — SKIPPED (no generated source)`);
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
