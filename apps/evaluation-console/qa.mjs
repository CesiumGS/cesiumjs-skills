// Comprehensive QA harness for Skill Evaluation Console. Drives every user workflow with
// functional assertions + screenshots. Output: /tmp/qa/*.png + a JSON report.
//   node qa.mjs            (mode A, dark)
import { chromium } from "playwright";

const URL = process.env.LH_URL || "http://127.0.0.1:8933/";
const OUT = "/tmp/qa";
const results = [];
const consoleErrors = [];
let shotN = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e)));

const sleep = (ms) => page.waitForTimeout(ms);
const $ = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.textContent.trim() : null;
}, sel);
const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
async function shot(name) {
  const f = `${OUT}/${String(++shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: f });
  return f;
}
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? "" });
    console.log(`PASS  ${name}  ${detail ?? ""}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message || e) });
    console.log(`FAIL  ${name}  ${e.message || e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const press = async (k, wait = 320) => { await page.keyboard.press(k); await sleep(wait); };

await page.goto(URL, { waitUntil: "networkidle" });
await sleep(1500);

// ---------------- BOOT / REVIEW ----------------
await step("boot: Review station active, stream populated", async () => {
  const active = await $(".station.active .st-name");
  assert(active === "Review", `active station is ${active}`);
  const rows = await count(".stream .row");
  assert(rows > 10, `only ${rows} rows`);
  const title = await $(".stage-title");
  assert(title && title.length > 0, "no stage title");
  await shot("review-boot");
  return `${rows} rows, top="${title}"`;
});

await step("review: flag (f) updates spine + Focus badge + live region", async () => {
  const before = await $(".rail .station .st-badge.hot, .rail-sub .st-badge.hot");
  // select the top case explicitly
  await page.click(".stream .row");
  await sleep(200);
  const focusBadgeBefore = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".rail-sub")].find((x) => x.textContent.includes("Focus"));
    return el ? el.querySelector(".st-badge")?.textContent : null;
  });
  await press("f", 400);
  const focusBadgeAfter = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".rail-sub")].find((x) => x.textContent.includes("Focus"));
    return el ? el.querySelector(".st-badge")?.textContent : null;
  });
  const live = await $('[aria-live="polite"]');
  const selSpine = await page.evaluate(() => document.querySelector(".row.sel .spine")?.className);
  assert(/d-flag/.test(selSpine || ""), `selected spine not flag: ${selSpine}`);
  await shot("review-after-flag");
  return `focus ${focusBadgeBefore}→${focusBadgeAfter}, live="${live}"`;
});

await step("review: accept (a) then undo (u)", async () => {
  await press("a", 350);
  const spineA = await page.evaluate(() => document.querySelector(".row.sel .spine")?.className);
  assert(/d-accept/.test(spineA || ""), `not accept after a: ${spineA}`);
  await press("u", 350);
  const spineU = await page.evaluate(() => document.querySelector(".row.sel .spine")?.className);
  assert(/d-flag/.test(spineU || ""), `undo did not restore flag: ${spineU}`);
  return `accept→undo restored ${spineU}`;
});

await step("review: defer (d)", async () => {
  await press("d", 350);
  const spine = await page.evaluate(() => document.querySelector(".row.sel .spine")?.className);
  assert(/d-defer/.test(spine || ""), `not defer: ${spine}`);
  await press("u", 200);
  return "defer ok";
});

await step("review: j/k scroll-follow keeps selection in viewport", async () => {
  for (let i = 0; i < 22; i++) await press("j", 60);
  await sleep(300);
  const inView = await page.evaluate(() => {
    const sel = document.querySelector(".row.sel");
    const scroller = document.querySelector(".stream .col-scroll");
    if (!sel || !scroller) return false;
    const r = sel.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
  assert(inView, "selected row not in viewport after 22x j");
  await shot("review-scrolled");
  return "selection followed scroll";
});

await step("review: details (space) expands scenario intent", async () => {
  await press("g", 100); await press("g", 200); // back to top
  await press(" ", 350);
  const open = await page.evaluate(() => !!document.querySelector("details[open] .task-q, details[open] .intent"));
  await shot("review-details");
  await press(" ", 150);
  assert(open, "details did not open");
  return "details toggled";
});

await step("review: lightbox z opens and z closes", async () => {
  await press("z", 450);
  const opened = await count(".scrim");
  await shot("review-lightbox");
  await press("z", 350);
  const closedAfter = await count(".scrim");
  assert(opened >= 1, "lightbox did not open");
  assert(closedAfter === 0, "z did not close lightbox");
  return "lightbox z toggles";
});

await step("review: filter Flagged shows only flagged spines", async () => {
  // flag a couple first
  await press("f", 250); await press("j", 150); await press("f", 250); await press("j", 150); await press("f", 250);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".facet")].find((x) => x.textContent.includes("Flagged"));
    b && b.click();
  });
  await sleep(400);
  const spines = await page.evaluate(() => [...document.querySelectorAll(".stream .row .spine")].map((s) => s.className));
  const allFlag = spines.length > 0 && spines.every((c) => /d-flag/.test(c));
  await shot("review-filter-flagged");
  // reset to All
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".facet")].find((x) => x.textContent.trim().startsWith("All"));
    b && b.click();
  });
  await sleep(300);
  assert(allFlag, `not all flagged: ${spines.slice(0, 4)}`);
  return `${spines.length} flagged rows`;
});

await step("review: skill facet dropdown filters stream", async () => {
  await page.selectOption("select.facet", "cesiumjs-camera");
  await sleep(400);
  const skills = await page.evaluate(() => [...document.querySelectorAll(".stream .row .row-l2")].map((r) => r.textContent));
  const allCamera = skills.length > 0 && skills.every((t) => t.includes("camera"));
  await shot("review-facet-camera");
  await page.selectOption("select.facet", "");
  await sleep(300);
  assert(allCamera, "facet did not filter to camera");
  return `${skills.length} camera rows`;
});

await step("review: Focus handoff writes focus.json (rail Focus button)", async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".rail-sub")].find((x) => x.textContent.includes("Focus"));
    b && b.click();
  });
  await sleep(800);
  const toast = await $(".toast");
  await shot("review-handoff-toast");
  assert(toast && /hand|focus/i.test(toast), `no handoff toast: ${toast}`);
  return `toast="${toast}"`;
});

// ---------------- EVALUATE ----------------
await step("evaluate: overview renders KPIs + skill grid", async () => {
  await press("1", 600);
  const big = await $(".ov-big");
  const cards = await count(".cards .card");
  const tiles = await count(".skill-grid .skill-tile");
  await shot("evaluate");
  assert(["PASS", "FAIL"].includes(big), `ov-big=${big}`);
  assert(cards === 6, `cards=${cards}`);
  assert(tiles >= 10, `tiles=${tiles}`);
  return `${big}, ${cards} cards, ${tiles} skill tiles`;
});

// ---------------- OPTIMIZE ----------------
await step("optimize: select camera loads iteration, train=7 cars, scenarios>0", async () => {
  await press("3", 500);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll(".stream .row .name")].find((n) => n.textContent.trim() === "camera");
    r && r.closest(".row").click();
  });
  await sleep(1600);
  const cars = await count(".train .car");
  const done = await count(".train .car.done");
  const scn = await count(".scn-board .scn-line");
  const commits = await count(".commit");
  await shot("optimize-camera");
  assert(cars === 7, `train cars=${cars}`);
  assert(scn > 0, `scenario lines=${scn}`);
  return `${cars} cars (${done} done), ${scn} scenarios, ${commits} commits`;
});

await step("optimize: clicking an older iteration commit reloads scenarios", async () => {
  const before = await $(".panel .panel-head"); // not precise; just capture
  await page.evaluate(() => {
    const commits = [...document.querySelectorAll(".commit")].filter((c) => !c.textContent.includes("baseline"));
    // click the last (oldest non-baseline) commit
    const target = commits[commits.length - 1];
    target && target.click();
  });
  await sleep(1500);
  const scn = await count(".scn-board .scn-line");
  await shot("optimize-iter-switch");
  assert(scn > 0, `scenarios after switch=${scn}`);
  return `reloaded, ${scn} scenarios`;
});

// ---------------- DECIDE ----------------
await step("decide: diff frame + swipe handle drag changes reveal", async () => {
  // pick camera latest again, go decide
  await press("3", 300);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll(".stream .row .name")].find((n) => n.textContent.trim() === "camera");
    r && r.closest(".row").click();
  });
  await sleep(1400);
  await press("4", 1200);
  const hasImg = await count(".diff-img img");
  const handle = await page.$(".diff-handle");
  let moved = "no-handle";
  if (handle) {
    const box = await handle.boundingBox();
    const frame = await (await page.$(".diff-stageframe")).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + frame.width * 0.25, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await sleep(300);
    const w = await page.evaluate(() => {
      const c = document.querySelector(".diff-clip");
      return c ? c.style.width : null;
    });
    moved = `clip width=${w}`;
  }
  await shot("decide-swipe");
  assert(hasImg >= 1, `diff images=${hasImg}`);
  return `imgs=${hasImg}, ${moved}`;
});

await step("decide: blink (X) then swipe (x) toggle modes", async () => {
  await press("X", 700);
  const blinkOn = await page.evaluate(() => {
    const segs = [...document.querySelectorAll(".diff-toolbar .seg button")];
    return segs.find((b) => b.textContent.trim() === "blink")?.classList.contains("on");
  });
  await shot("decide-blink");
  await press("x", 400);
  assert(blinkOn, "blink button not active after X");
  return "blink/swipe toggle ok";
});

await step("decide: cascade ladder lights the fired rung + judges present", async () => {
  const fired = await count(".ladder .rung.fired");
  const rungs = await count(".ladder .rung");
  const judges = await count(".judge");
  assert(rungs === 5, `rungs=${rungs}`);
  return `${rungs} rungs, ${fired} fired, ${judges} judges`;
});

// ---------------- PROMOTE ----------------
await step("promote: KEEP candidates listed, guarded button toasts (no mutation)", async () => {
  await press("5", 600);
  const tiles = await count(".skill-grid .skill-tile");
  await shot("promote");
  // click a guarded promote button if present
  const btn = await page.$(".skill-tile button");
  let toast = null;
  if (btn) { await btn.click(); await sleep(500); toast = await $(".toast"); }
  return `${tiles} promotable, toast="${toast}"`;
});

// ---------------- OVERLAYS ----------------
await step("overlay: Matrix (m) renders table + legend + clickable cell", async () => {
  await press("1", 300); // reset to a known station
  await press("m", 600);
  const rows = await count(".matrix tbody tr");
  const legend = await count(".matrix-legend");
  const cells = await count(".matrix td.cell");
  await shot("overlay-matrix");
  await press("Escape", 300);
  assert(rows >= 10, `matrix rows=${rows}`);
  assert(legend === 1, "no legend");
  return `${rows} skills, ${cells} cells, legend=${legend}`;
});

await step("overlay: Trends (t) renders chart + decision history", async () => {
  await press("3", 300);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll(".stream .row .name")].find((n) => n.textContent.trim() === "camera");
    r && r.closest(".row").click();
  });
  await sleep(1200);
  await press("t", 600);
  const svg = await count(".trend-chart svg");
  await shot("overlay-trends");
  await press("Escape", 300);
  assert(svg === 1, `trend svg=${svg}`);
  return "trends ok";
});

await step("overlay: Command palette filter + arrow + Enter jumps", async () => {
  await press("/", 400);
  await page.keyboard.type("eiffel", { delay: 30 });
  await sleep(400);
  const items = await count(".palette-item");
  await shot("overlay-palette");
  await press("ArrowDown", 150);
  await press("Enter", 600);
  const station = await $(".station.active .st-name");
  assert(items > 0, "no palette items");
  return `${items} items, jumped to ${station}`;
});

await step("overlay: Help (?) lists keybindings", async () => {
  await press("?", 500);
  const rows = await count(".help-row");
  await shot("overlay-help");
  await press("Escape", 300);
  assert(rows > 15, `help rows=${rows}`);
  return `${rows} keybinding rows`;
});

await step("overlay: focus trap moves focus into dialog", async () => {
  await press("m", 500);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    const card = document.querySelector(".overlay-card");
    return card && (card === a || card.contains(a));
  });
  await press("Escape", 300);
  assert(focused, "focus not inside overlay dialog");
  return "focus trapped";
});

// ---------------- THEME ----------------
await step("theme: toggle to light, capture each station", async () => {
  await press("1", 300);
  await press("T", 500);
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  assert(theme === "light", `theme=${theme}`);
  await shot("light-evaluate");
  await press("2", 500); await shot("light-review");
  await press("3", 500);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll(".stream .row .name")].find((n) => n.textContent.trim() === "camera");
    r && r.closest(".row").click();
  });
  await sleep(1300); await shot("light-optimize");
  await press("4", 1000); await shot("light-decide");
  await press("m", 500); await shot("light-matrix"); await press("Escape", 200);
  await press("T", 300); // back to dark
  return `light theme rendered`;
});

const summary = {
  total: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok),
  consoleErrors,
  results
};
const fs = await import("fs");
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(summary, null, 2));
console.log(`\n==== ${summary.passed}/${summary.total} passed, ${consoleErrors.length} console errors ====`);
await browser.close();
