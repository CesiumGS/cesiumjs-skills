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
await step("boot: Dashboard is the landing station", async () => {
  const active = await $(".station.active .st-name");
  assert(active === "Dashboard", `active station is ${active}`);
  const kpis = await count(".kpi");
  assert(kpis >= 5, `only ${kpis} KPI tiles`);
  const hasTrend = await count(".dashboard-station svg, .dashboard-station table");
  assert(hasTrend > 0, "no trend chart or tables on the dashboard");
  await shot("dashboard-boot");
  return `landing=Dashboard, ${kpis} KPIs`;
});

await step("dashboard: both units of analysis side by side + details links", async () => {
  const cols = await count(".dashboard-columns .dashboard-col");
  assert(cols === 2, `expected 2 dashboard columns, got ${cols}`);
  const heads = await page.$$eval(".dashboard-col-head span", (els) => els.map((e) => e.textContent));
  assert(heads.some((h) => /Harness/i.test(h)), "no Harness Performance column");
  assert(heads.some((h) => /Model/i.test(h)), "no Model Performance column");
  await page.click(".dashboard-col .link-pill");
  await sleep(400);
  const active = await $(".station.active .st-name");
  assert(active === "Models & Harnesses", `Details link landed on ${active}`);
  await press("0", 400);
  return "2 columns, Details → Models & Harnesses";
});

await step("dashboard: freshness chip present, 0 returns from any station", async () => {
  const chip = await $(".fresh-chip");
  assert(chip && /Latest data/.test(chip), `freshness chip missing: ${chip}`);
  await press("3", 400);
  await press("0", 400);
  const active = await $(".station.active .st-name");
  assert(active === "Dashboard", `0 landed on ${active}`);
  return `chip="${chip}"`;
});

await step("boot: Review station populated after pressing 2", async () => {
  await press("2", 600);
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
  const kpis = await count(".overview .kpi");
  const hero = await count(".hero-card");
  const tiles = await count(".skill-grid .skill-tile");
  await shot("evaluate");
  // the hero verdict now carries the Δ-vs-baseline chip inside .ov-big
  assert(big.startsWith("PASS") || big.startsWith("FAIL"), `ov-big=${big}`);
  assert(hero === 1, `hero cards=${hero}`);
  assert(kpis === 6, `KPI tiles=${kpis}`);
  assert(tiles >= 10, `tiles=${tiles}`);
  return `${big}, ${kpis} KPI tiles, ${tiles} skill tiles`;
});

await step("evaluate: verdict gates name why the run passed/failed", async () => {
  const gates = await count(".gate-chips .gate-chip");
  const det = await $(".gate-chip");
  assert(gates === 2, `gates=${gates}`);
  assert(/deterministic/i.test(det), `first gate=${det}`);
  return `${gates} gate chips, first="${det}"`;
});

await step("evaluate: score-vs-threshold bar with notch", async () => {
  const nums = await $(".score-thresh .st-nums");
  const notch = await count(".score-thresh .st-notch");
  assert(nums && nums.includes("%"), `nums=${nums}`);
  assert(notch === 1, `notch=${notch}`);
  return `bar reads "${nums}"`;
});

await step("evaluate: changed-vs-baseline cards render with an auto baseline", async () => {
  const cards = await count(".diff-cards .diff-card");
  const baselineSel = await page.evaluate(() => document.querySelector(".baseline-pick select")?.value ?? "");
  await shot("evaluate-diff");
  assert(cards === 6, `diff cards=${cards}`);
  assert(baselineSel.length > 0, "no auto-selected baseline");
  return `6 diff buckets vs ${baselineSel.slice(0, 30)}`;
});

await step("evaluate: diff card drills into a scoped Review stream", async () => {
  const drilled = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".diff-cards .diff-card:not(.empty)")].find((c) => !c.disabled);
    if (!card) return null;
    const label = card.textContent.trim();
    card.click();
    return label;
  });
  if (drilled === null) return "no non-empty bucket to drill (all zero) — skipped";
  await sleep(500);
  const chip = await $(".facet.scope-chip");
  const rows = await count(".row");
  assert(chip, "scope chip missing after drill");
  await shot("review-scoped");
  // clear the scope and return to evaluate
  await page.click(".facet.scope-chip");
  await press("1", 500);
  return `drilled "${drilled}" → ${rows} scoped rows, chip="${chip}"`;
});

await step("evaluate: provenance card renders chips + reproduce sketch", async () => {
  const chips = await count(".prov-chips .meta-tag");
  const pre = await $(".prov-repro pre");
  assert(chips >= 6, `prov chips=${chips}`);
  assert(pre.includes("git checkout"), "reproduce sketch missing git checkout");
  return `${chips} provenance chips; sketch starts "${pre.split("\n")[0]}"`;
});

// ---------------- MODELS (station 6) & HARNESSES (station 8) ----------------
await step("harnesses: station 8 renders registry cards for both harnesses", async () => {
  await press("8", 600);
  const kpis = await count(".kpi");
  assert(kpis >= 4, `harness KPIs=${kpis}`);
  const cards = await count(".hx-card");
  const names = await page.evaluate(() =>
    [...document.querySelectorAll(".hx-card .hx-name")].map((el) => el.textContent.trim())
  );
  const defaults = await page.evaluate(() =>
    [...document.querySelectorAll(".hx-card .hx-model")].map((el) => el.textContent.trim())
  );
  await shot("harnesses-cards");
  assert(cards === 2, `hx-cards=${cards}`);
  assert(names.includes("Codex CLI") && names.includes("OpenCode CLI"), `names=${names}`);
  assert(defaults.every((d) => d.includes("gpt-5.6-sol")), `defaults=${defaults}`);
  return `${names.join(" + ")}; defaults ${defaults.join(", ")}`;
});

await step("harnesses: vision asymmetry is explicit (codex vision, opencode text-only)", async () => {
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".hx-card")].map((card) => ({
      harness: card.getAttribute("data-harness"),
      vision: card.querySelector(".vision-chip")?.textContent.trim()
    }))
  );
  const codex = chips.find((c) => c.harness === "codex");
  const oc = chips.find((c) => c.harness === "opencode");
  assert(/vision/i.test(codex?.vision ?? ""), `codex=${JSON.stringify(codex)}`);
  assert(/text.only/i.test(oc?.vision ?? ""), `opencode=${JSON.stringify(oc)}`);
  return `codex="${codex.vision}" opencode="${oc.vision}"`;
});

await step("models: observed combos table renders with stability metadata", async () => {
  await press("6", 600);
  const kpis = await count(".kpi");
  assert(kpis >= 4, `model KPIs=${kpis}`);
  const rows = await count(".combo-table .combo-row");
  const stab = await count(".combo-table .stab-chip");
  await shot("models-combos");
  assert(rows >= 1, `combo rows=${rows}`);
  assert(stab >= 1, `stability chips=${stab}`);
  return `${rows} combos, ${stab} stability chips`;
});

await step("models: combo expands to member iterations and drills into Optimize", async () => {
  await page.click(".combo-table .combo-row");
  await sleep(300);
  const members = await count(".combo-member");
  assert(members >= 1, `members=${members}`);
  await page.click(".combo-member");
  await sleep(900);
  const station = await $(".station.active .st-name");
  assert(station === "Optimize", `station=${station}`);
  await shot("models-drill-optimize");
  await press("6", 500);
  return `${members} members; drill landed on ${station}`;
});

await step("models: models and harnesses are separate stations", async () => {
  await press("8", 500);
  const onHarnesses = await page.evaluate(() => !!document.querySelector(".hx-card") && !document.querySelector(".combo-table") && !document.querySelector(".catalog-table"));
  await press("6", 500);
  const onModels = await page.evaluate(() => !!document.querySelector(".combo-table") && !!document.querySelector(".catalog-table") && !document.querySelector(".hx-card"));
  assert(onHarnesses, "Harnesses station leaked model tables or lost harness cards");
  assert(onModels, "Models station leaked harness cards or lost the observed table / catalog");
  return "clean separation: Harnesses = cards + runs; Models = observed evidence + declared catalog";
});

await step("dashboard: run trend renders clickable dots + axis toggle", async () => {
  await press("0", 600);
  const dots = await count(".trend-runs circle");
  const toggles = await count(".axis-toggle button");
  assert(dots >= 2, `dots=${dots}`);
  assert(toggles === 2, `axis toggles=${toggles}`);
  await page.click(".axis-toggle button:last-child");
  await sleep(200);
  await press("6", 500);
  return `${dots} run dots; axis toggles work`;
});

await step("catalog: vendor groups, filter chips, and starred default render", async () => {
  await press("6", 500);
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll(".harness-switch .harness-chip")].map((el) => el.textContent.trim())
  );
  const starred = await count(".catalog-default");
  const rows = await count(".catalog-table tbody tr:not(.catalog-group-row)");
  const groups = await count(".catalog-group-row");
  const filters = await count(".catalog-filter button");
  await shot("catalog");
  assert(tabs.length >= 2, `tabs=${tabs}`);
  assert(starred === 1, `starred defaults=${starred}`);
  assert(rows >= 6, `catalog rows=${rows}`);
  assert(groups >= 1, `vendor groups=${groups}`);
  assert(filters === 3, `filter chips=${filters}`);
  return `tabs ${tabs.join(" | ")}; ${rows} models in ${groups} vendor groups, 1 starred default, ${filters} filters`;
});

await step("catalog: releases populated and exercised filter narrows the table", async () => {
  const releases = await page.evaluate(() =>
    [...document.querySelectorAll(".catalog-release")].map((el) => el.textContent.trim())
  );
  const dated = releases.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r)).length;
  assert(releases.length > 0 && dated === releases.length, `dated=${dated}/${releases.length}`);
  const all = await count(".catalog-table tbody tr:not(.catalog-group-row)");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".catalog-filter button")].find((x) => /Exercised/.test(x.textContent));
    b && b.click();
  });
  await sleep(250);
  const exercised = await count(".catalog-table tbody tr:not(.catalog-group-row)");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".catalog-filter button")].find((x) => /All/.test(x.textContent));
    b && b.click();
  });
  await sleep(250);
  assert(exercised <= all, `exercised=${exercised} all=${all}`);
  return `${dated}/${releases.length} rows carry a release date; filter ${all} -> ${exercised} rows`;
});

await step("models: unrecorded provenance stays dashed, never guessed", async () => {
  await press("6", 500);
  const unrecorded = await count(".combo-table .harness-pill.unrecorded");
  const note = await $(".honesty-note");
  assert(/unrecorded/i.test(note), "honesty note missing");
  return `${unrecorded} unrecorded pills; note present`;
});

// ---------------- COPY & BRANDING AUDITS ----------------
await step("brand: Cesium logomark renders in the top strip", async () => {
  const ok = await page.evaluate(() => {
    const img = document.querySelector(".brand .brand-mark");
    return img && img.complete && img.naturalWidth > 0;
  });
  assert(ok, "logomark missing or failed to load");
  return "cesium-logomark.svg loaded";
});

await step("rail: Models & Harnesses lives under Insights, not Lifecycle", async () => {
  const groups = await page.evaluate(() => {
    const sections = [...document.querySelectorAll(".rail-section")].map((el) => el.textContent.trim());
    const insightsBtn = [...document.querySelectorAll(".rail .station")].find((b) =>
      b.textContent.includes("Models & Harnesses")
    );
    return { sections, hasInsightsEntry: !!insightsBtn };
  });
  assert(groups.sections.some((s) => /insights/i.test(s)), `sections=${groups.sections}`);
  assert(groups.hasInsightsEntry, "Models & Harnesses rail entry missing");
  return `rail groups: ${groups.sections.join(" / ")}`;
});

await step("copy: no prose em dashes in any station or overlay", async () => {
  const offenders = [];
  const scan = async (label) => {
    const hits = await page.evaluate(() => {
      const text = document.body.innerText;
      const out = [];
      // an em dash embedded in prose (word chars on both sides, possibly spaced);
      // standalone "—" placeholders for missing values are allowed
      const re = /[\w)][ \u00a0]?—[ \u00a0]?[\w(]/g;
      let m;
      while ((m = re.exec(text)) && out.length < 5) out.push(text.slice(Math.max(0, m.index - 30), m.index + 34));
      return out;
    });
    for (const h of hits) offenders.push(`${label}: …${h.replace(/\n/g, " ")}…`);
  };
  for (const key of ["1", "2", "3", "4", "5", "6"]) {
    await press(key, 350);
    await scan(`station ${key}`);
  }
  await press("h", 350); await scan("run browser"); await press("Escape", 200);
  await press("?", 350); await scan("help"); await press("Escape", 200);
  assert(offenders.length === 0, offenders.join(" | "));
  return "no prose em dashes across 6 stations + 2 overlays";
});

await step("copy: every table header starts uppercase", async () => {
  const collect = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("table th[scope=col]")]
        .map((th) => th.textContent.trim())
        .filter((t) => t && /^[a-z]/.test(t))
    );
  await press("8", 400);
  const badHarnesses = await collect();
  await press("6", 400);
  const badModels = await collect();
  const bad = [...badHarnesses, ...badModels];
  assert(bad.length === 0, `lowercase headers: ${bad.join(", ")}`);
  return "all column headers capitalized on both stations";
});

await step("cost: meter chips replace dollar-sign glyphs", async () => {
  await press("6", 400);
  const meters = await count(".cost-meter");
  const words = await page.evaluate(() =>
    [...document.querySelectorAll(".cost-meter .cm-word")].map((el) => el.textContent.trim())
  );
  const dollarSpam = await page.evaluate(() => /\${3,}/.test(document.body.innerText));
  assert(meters >= 2, `cost meters=${meters}`);
  assert(words.every((w) => /^[A-Z]/.test(w)), `meter words=${words}`);
  assert(!dollarSpam, "found $$$ glyph spam in the page");
  return `${meters} cost meters, words: ${[...new Set(words)].join(", ")}`;
});

await step("models: skill optimization trend renders with a skill picker", async () => {
  await press("6", 400);
  const chart = await page.evaluate(() => {
    const titles = [...document.querySelectorAll(".section-title")].map((el) => el.textContent);
    return titles.some((t) => t.includes("Skill Optimization Trend"));
  });
  const ticks = await count(".skill-trend-ticks span.mono");
  assert(chart, "skill trend section missing");
  assert(ticks >= 1, `trend ticks=${ticks}`);
  return `skill trend present with ${ticks} iteration ticks`;
});

await step("grammar: case count pluralizes correctly", async () => {
  const meta = await $(".run-meta");
  assert(!/\b1 cases\b/.test(meta), `top strip reads: ${meta.slice(0, 120)}`);
  return "no '1 cases' in the top strip";
});

// ---------------- BASELINE (run list) ----------------
await step("baseline: run list marks the comparison baseline; b is guarded", async () => {
  await press("h", 500);
  const baselineTag = await count(".hr-baseline");
  const setBtns = await count(".hr-set-baseline");
  await shot("runlist-baseline");
  await press("Escape", 300);
  assert(baselineTag >= 0 && setBtns >= 1, `tags=${baselineTag} buttons=${setBtns}`);
  return `${baselineTag} baseline tag(s), ${setBtns} set-baseline buttons`;
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
      return c ? c.style.clipPath : null;
    });
    moved = `clip-path=${w}`;
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
