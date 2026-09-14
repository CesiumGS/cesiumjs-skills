// Screenshot helper for Skill Evaluation Console dev iteration.
// usage: node shot.mjs <out.png> [keys csv, e.g. "2,j,j,space"] [waitMs]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/eval-console.png";
const keys = (process.argv[3] || "").split(",").map((s) => s.trim()).filter(Boolean);
const waitMs = Number(process.argv[4] || 1400);
const url = process.env.LH_URL || "http://127.0.0.1:8933/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(waitMs);
for (const k of keys) {
  await page.keyboard.press(k === "space" ? "Space" : k);
  await page.waitForTimeout(380);
}
await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) {
  console.log("CONSOLE ERRORS:\n" + errors.slice(0, 12).join("\n"));
} else {
  console.log("no console errors");
}
console.log("saved " + out);
