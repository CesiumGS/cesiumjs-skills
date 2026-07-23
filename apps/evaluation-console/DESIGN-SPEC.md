# CESIUM SKILL-QUALITY CONSOLE — Definitive Design Specification

**Skill Evaluation Console** · v1.0 build spec · single-user desktop web app (1440×900+)

---

## 1. Product, North Star, Principles

**Skill Evaluation Console** — *one console that carries a skill from a failing scorecard to a promoted fix, where the evidence is always the hero, the machine's word and the eye's word never blur, and a single human flag is the only thing that lights the optimizer.*

> **North star:** A skill-quality issue should travel EVALUATE → REVIEW → OPTIMIZE → DECIDE → PROMOTE without the expert ever switching apps, rebuilding context, or wondering which judge spoke.

### Five named design principles

| # | Principle | Theory | What it forces in the build |
|---|-----------|--------|------------------------------|
| **P1** | **One spine, no tabs.** The lifecycle is a persistent left RAIL of five stations + a three-pane skeleton (Rail / Stream / Stage) reused at every station. Phase is a *verb on the current selection*, not a place you navigate to. | Shneiderman overview→zoom→filter→details; Jakob (consistency = no relearning) | Context + reducer, **no router**. The same case object the human flags in Review is the same object the loop chases in Optimize. |
| **P2** | **The present data is the hero; the render is promoted, not assumed.** Deterministic checks are *always* present and are the default Stage hero. The render takes over the Stage only when `screenshots.length > 0`. | Tufte data-ink; the real data is 88/88 Mode B | Kills the prior concepts' fatal flaw of designing the hero around the rare Mode A case. The app is gorgeous on a deterministic-only run, not hollow. |
| **P3** | **Provenance is ink; scales never share an axis.** Deterministic (0–1, %) speaks in **cool steel-cyan, monospace, ✓/✗ glyphs**. Visual judge (0–1 stored, shown ×10 as `N.N/10`) speaks in **warm amber, prose, pip capsules**. Human override carries a **magenta hairline**. Every score carries a unit token + glyph, never color alone. | Tufte honest encoding; Norman "which judge spoke"; WCAG 1.4.1 | *(stolen verbatim from LIGHTTABLE/Atlas/Cadence — the panel's #1 best-idea-to-steal, agreed by ≥6 judges)* Enforced in the **type layer**: `Score01` / `Score10` / `Pct` components physically cannot co-plot. |
| **P4** | **Unknown is never low.** `not_reviewed`/`needs_review` render as a **hollow dashed slate chip labeled "unknown,"** never a red zero. Mode is detected **per case** off `visual_review.status`, not globally. | Honest encoding; the #1 dashboard lie over sparse data | A `0` score on an unreviewed dimension is suppressed; the dimension shows a dashed ring. |
| **P5** | **The common path is near-zero interaction, and the flag is load-bearing.** Worst-first, silence-as-accept (`j` to advance), one-key override (`f`/`d`). `f` is the **only** writer of the focus set, and the focus set is the **only** seed of optimization. | Fitts/Hick (single-key high-frequency verbs); the brief's core product win | *(steals the enforced focus-bridge from Atlas/Cadence/FLIGHTDECK — the cross-cutting best-idea-to-steal)* The bridge is the architecture, not an export. |

**Base architecture:** LIGHTTABLE (Darkroom, rank #1, 24.5). **Grafts:** the *enforced, traceable focus-bridge with a CHASING bar* (FLIGHTDECK/Cadence/Atlas-editorial); the *dual provenance register* hardened into typed primitives (Atlas-editorial); the *visible focus→loop causal thread* (Spatial Atlas's flight-path, demetaphorized into a Stream connector); the *three-shape score language + hollow-unknown* (FLIGHTDECK); the *commit-log iteration history* and *blink-compare* A/B (Cadence/Spatial Atlas). **Rejected:** the spatial globe (judges: it's a delight-tax whose own escape-hatch reveals the list is the real workhorse); hardcoding the idealized 6 dimensions (not in data); leading the hero with the rare cardinal panorama.

---

## 2. The lifecycle journey across ONE app

```
   EVALUATE ──────▶ REVIEW ──────▶ OPTIMIZE ──────▶ DECIDE ──────▶ PROMOTE
   (read-only)     (human flag)   (autonomous)     (human trust)  (mutate live)
      │               │ writes        │ reads          │              │
      │               ▼ focus.json    ▼                ▼              ▼
   scorecard ───▶  FOCUS SET ────▶ loop scoped ───▶ decision.json ─▶ SKILL.md
   (0-1, checks)   (confirmed       to the           + summary.md     overwritten
                    failures only)  focus skills      + run bundles   (+ archive)
```

**There are no tabs.** There is one canvas and **three altitudes** you fly between with the same keys (`Enter` down, `Esc` up), and **five stations** on the rail that are *contexts*, not destinations:

- **Altitude 0 — LEDGER (overview):** the rail + a virtualized worst-first list. Home base for every station.
- **Altitude 1 — STAGE (zoom/details):** one case (Review) or one iteration (Optimize/Decide) filling the right two-thirds.
- **Altitude 2 — OVERLAYS (on-demand):** Matrix (`m`), Trends (`t`), Diff (`x`), Journal (`l`), Command Palette (`⌘K`), Help (`?`). Summoned by one key, dismissed with `Esc`. Never a route.

The **rail station you're in** only swaps the Stage's *mode* and the action bar's *verbs*; the Rail, the Stream's `j/k` spine, and the keyboard grammar are invariant (P1). EVALUATE is the read-only face of the Review Ledger. PROMOTE is a guarded action inside Decide, not a separate screen.

---

## 3. Information Architecture

```
┌─ TOP STRIP (heartbeat, always visible) ───────────────────────────────────────────────┐
│ Skill Evaluation Console  run scorecard-20260603T1832Z · 74a3a5e · MODE A(per-case)  overall 0.78 ▁▂▄ │
│ thr 0.95 · 6 critical · ● OPTIMIZE: 1 running (camera iter4)              ⌘K  ?         │
├──────────────┬───────────────────────────────────────┬────────────────────────────────┤
│ RAIL (240px) │  STREAM (virtualized, worst-first)     │  STAGE  (render/checks hero)   │
│              │                                         │   +  INSPECTOR (provenance)    │
│ ① EVALUATE   │  ┌─ FACET BAR (compose, AND) ────────┐ │                                │
│ ② REVIEW  16 │  │ skill▾ cat▾ dim▾ verdict▾ flag▾    │ │   ── content depends on        │
│   FOCUS    4 │  └────────────────────────────────────┘ │      station + altitude ──     │
│ ③ OPTIMIZE ● │  > worst case ............ score chips  │                                │
│ ④ DECIDE   1 │    next case  ............ score chips  │                                │
│ ⑤ PROMOTE    │    ... (j/k spine)                      │                                │
│              │                                         │                                │
│ ── FACETS ── │                                         │                                │
│ Needs You 16 │                                         │                                │
│ (smart, pin) │                                         │                                │
├──────────────┴───────────────────────────────────────┴────────────────────────────────┤
│ ACTION BAR (phase-aware, self-documenting): "machine says FAIL · a accept f flag d defer"│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Rail** = lifecycle spine with **live count badges** (Review "16 to triage", Focus "4 confirmed", Optimize "● running", Decide "1 awaiting trust"). It is wayfinding (Gestalt connectedness), not a menu.
- **Facet bar** = auto-categorization (§6), composes with AND, recolors rail badges.
- **"Needs You"** = pinned smart collection: `result == fail` OR `visual_review.status ∈ {fail, needs_review}` OR `case in critical_failures`, sorted by critical-count desc then score asc.
- **Inspector** = the one stable surface where quant and qual sit adjacent, each in its own ink (P3).

---

## 4. Hero Surfaces (ASCII wireframes)

### (a) REVIEW / Triage — the screen the expert lives in

```
┌─ ② REVIEW · worst-first · 16 of 88 need you · ⚑3 flagged → focus ──────────────────────┐
│ RAIL   │ skill▾ category▾ dimension▾ verdict▾ flag▾   sort: WORST-FIRST▾                 │
│ ①EVAL  │ ───────────────────────────────────────────│ STAGE  3d-tiles / eval-001        │
│>②REVIEW│ >eval-001 public-tileset   det .75 ✗crit ◌ │ "public-tileset-contract"          │
│  FOCUS3│  eval-001 globe-terrain    det .71 ✗crit ◌ │ ┌──── HERO (det-only, Mode B) ───┐ │
│ ③OPT   │  eval-113 from-east        det 1.0 vis 2.0 │ │ ▣ CHECK LEDGER (no render)      │ │
│ ④DEC   │  eval-104 from-east        det 1.0 vis 3.0 │ │  ✗ tileset_public_url  CRIT     │ │
│ ⑤PROM  │  ... (virtualized)                         │ │    exp public-url               │ │
│ ────── │                                            │ │    act ion-asset  /after/.../0  │ │
│ Needs  │  LEGEND  ◌ = unknown (not reviewed)        │ │  ✗ tileset_no_ion_token CRIT    │ │
│ You 16 │          ✗crit = critical det failure      │ │    exp false  act true          │ │
│        │          steel=machine  amber=eye          │ └─────────────────────────────────┘ │
│        │                                            │ TASK "Load exactly one public      │
│        │                                            │  Cesium3DTileset from a URL ...    │
│        │                                            │  Do not use ion asset ids."        │
│        │                                            │ expected_behaviors(4)▾ difficulty: │
│        │                                            │  medium · landmark: dragon         │
│        │                                            │────────────────────────────────────│
│        │                                            │ ▣ DETERMINISTIC (machine, 0-1)     │
│        │                                            │   score .75  6/8 checks  2 CRIT ✗  │
│        │                                            │ ◈ VISUAL (eye, 0-10)  ◌ not reviewed│
│        │                                            │   framing ◌ subject ◌ ... (dashed) │
│        │                                            │   "No render captured · det-only"  │
├────────┴────────────────────────────────────────────┴────────────────────────────────────┤
│ machine says FAIL (det .75, 2 critical)   a accept · f flag→focus · d defer   j/k next     │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```
**Why it works:** When the case has no render (the **common** reality, P2), the deterministic check ledger IS the hero — the failing critical check is spelled `expected` vs `actual` with its JSON-pointer `detail`, so the human judges against ground truth, not vibes. `not_reviewed` dimensions render as dashed slate chips ◌ (P4), never red. The machine's verdict is pre-stated in the action bar so **agreeing is pressing `j`** (Fitts/Hick, P5). `f` writes the case into focus.json and increments the rail's FOCUS badge live — the bridge made visible (Norman feedback).

### (b) EVIDENCE / Render detail — multi-angle + dimensions + checks (Mode A)

```
┌─ ② REVIEW · eval-113 cesiumjs-camera · empire-from-east · difficulty: hard ───────────────┐
│ < back                          screenshots: 4 (cardinal_panorama) — ONE judgment          │
│ SOURCE CONTEXT          │  ┌── CONTACT STRIP (small multiples, weakest auto-hero) ──────┐  │
│ task: "Frame Empire     │  │  N      E      S      W*   ← W lit (subject-bearing)        │  │
│  State from the east"   │  │ [img]  [img]  [img]  [HERO fills, gold surrogate centered]  │  │
│ expected_behaviors:     │  └─────────────────────────────────────────────────────────────┘ │
│  · heading ~90°         │   space cycle · 1/2/3/4 jump angle · g grid · z zoom              │
│  · building centered    │  ─────────────────────────────────────────────────────────────── │
│  · daylight             │  ◈ VISUAL JUDGE  (warm amber, 0-10, derived score×10)  overall 2.0│
│ perspective: oblique    │   framing      ▓▓▓░░░░░░░ 3  pass│ liveness     ▓▓▓▓▓▓▓░░░ 7 pass │
│ landmark: NYC           │   subject      ▓▓░░░░░░░░ 2  FAIL│ nonblank     ▓▓▓▓▓░░░░░ 5 pass │
│ summary (eye):          │   prompt_match ▓▓▓░░░░░░░ 3  FAIL│ target_vis   ◌ needs_review     │
│  "Tower framed but      │   note(subject): "3 of 4 frames omit the building; gray tiles"    │
│   camera faces away     │   observations(3)▾   risks(1)▾   flags: render_artifacts          │
│   from the east."       │  ─────────────────────────────────────────────────────────────── │
│                         │  ▣ DETERMINISTIC MACHINE  (cool steel, 0-1)   score 1.00  5/5 ✓   │
│                         │   ✓ camera_within_500m  ✗ heading_east CRIT  exp ~90° act 268°    │
├─────────────────────────┴────────────────────────────────────────────────────────────────┤
│ machine says FAIL (vis 2.0)   a accept · f flag→focus · d defer   1-4 angle · q quant · ◈ qual│
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Why it works:** Multi-angle resolves to **one holistic judgment** — a Tufte small-multiples contact strip with the *weakest-judged* angle auto-promoted to hero (you confront the flaw first, not a flattering frame). The set carries ONE 0-10 overall, never four sub-decisions. Quant and qual are **two physically separated, ink-coded bands** (P3): steel ✓/✗ checks above-data vs amber pip capsules with prose. `target_vis` shows ◌ `needs_review` as a dashed chip (P4). N=1 collapses to a single hero; N=0 falls back to the check ledger of wireframe (a).

### (c) OPTIMIZE — live loop monitor + journal

```
┌─ ③ OPTIMIZE · cesiumjs-camera · iteration 004 · ● RUNNING · 04:12 ─────────────────────────┐
│ CHASING (from human review focus): ⚑eval-113 heading_east CRIT · ⚑eval-104 render_artifacts │
│ ITERATION LOG (commit history) │ PIPELINE TRAIN (journal.jsonl, 1:1)   │ SCENARIO BOARD (14) │
│  004 ● running                 │  proposer ✓ ─ skills_adapter ✓ ─      │ eval-001 grid  TIE ⊜│
│  003 KEEP   rule_3   W2 L0 T2  │   ►browser_runner ▓▓▓▓░░ 9/14 ─       │ eval-002 geo   LOSS✗⚑│
│  002 REJECT rule_2   W0 L1 T1  │   judges ○ pending ─ decision ○       │ eval-003 event WIN ✓│
│ >001 KEEP   rule_2   W1 L0 T3  │  ──────────────────────────────────── │ eval-004 tick  ░run⚑│
│                                │ JOURNAL (live tail)                    │ ...                 │
│ ⚠ most real runs fail early —  │  20:57 step_started   judges          │ W3 L1 T2 · 8 left   │
│  if step_failed fires, the car │  20:57 step_completed browser_runner  │ ▣ det so far 14/14 ✓│
│  turns RED and the stub shows  │   └ runs_dir .../runs/camera/004/     │ ◈ vis 3/14 graded   │
│  the error inline (no fake     │  20:56 step_completed skills_adapter   │   win-rate 57% (eye) │
│  green train).                 │   └ generated 14 scenarios            │ → proj rule_4_winrate│
│                                │  [pause] [abort] [open candidate]      │                     │
├────────────────────────────────┴────────────────────────────────────────┴───────────────────┤
│ space pause · a abort(confirm) · l journal · enter→Decide when decision lands · g scenario     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Why it works:** The 7-car train maps **1:1 to real journal events** (`iteration_started`, `step_started/completed`, `decision`) so a long autonomous run is legible (Norman visible state) — and because most real journals are **failure stubs**, a `step_failed` event turns the car **red and prints the error inline** rather than faking a green pipeline (resolves FLIGHTDECK's flagged over-promise). The **CHASING bar** renders the exact human-flagged cases the loop targets — the bridge made structural (P5, stolen from FLIGHTDECK/Cadence). Scenario board fills from a **filesystem watch on `runs_dir`** (journal alone lacks scenario granularity — the train is coarse, the board is fine). Iteration log reads as a **git commit history** (Cadence): each iteration = a commit badged decision + rule_fired + W/L/T.

### (d) DECIDE — candidate vs baseline diff + cascade ladder

```
┌─ ④ DECIDE · cesiumjs-terrain-environment · iter 001 · DECISION: REJECT (rule_2_critical_judge_loss)│
│ Programmatic 100% · API 100% · Visual Win 0%        W0 L1 T0  crit0  chk—                          │
│ SCENARIO RAIL (per-summary) │ VISUAL DIFF — eval-003 fog-denali-ridge  [LOSS]   x swipe · X blink │
│ >eval-003 fog   LOSS [-] ◀  │  ┌── BASELINE (best) ──┐ ║ ┌── CANDIDATE 001 ──┐   DECISION         │
│  eval-004 trans TIE  [=]    │  │  clean ridgeline     │ ║ │ black-triangle      │   ▮ REJECT         │
│  eval-001 atmos TIE  [=]    │  │  smooth haze         │ ║ │ artifact, green band│   rule_2_critical  │
│  eval-002 sky   TIE  [=]    │  └──────────────────────┘ ║ └─────────────────────┘   _judge_loss      │
│                             │   amber 7.8          drag ║ handle      amber 5.1     "Judge loss on  │
│ 3 JUDGES (pairwise,         │  ──────────────────────────────────────────────────   regression-     │
│  de-aliased CANDIDATE-rel)  │  ▣ PROGRAMMATIC (machine 0-1)  cand 10/11  base 11/11  critical       │
│  J0 BASELINE  seed 42       │   ✗ scene.fog.enabled  ← the regression that cost it    scenario      │
│  J1 BASELINE  seed 123      │  ──────────────────────────────────────────────────   eval-001"      │
│  J2 BASELINE  seed 789      │  DECISION CASCADE (lit rung = fired)                                  │
│  consensus → BASELINE       │   rule_1 check_failure ........ pass    rebaseline_required: none     │
│  J notes(amber)▾            │  ►rule_2 critical_judge_loss .. FIRED ▮ │ authorized by: ⚑flag eval-003│
│                             │   rule_3 net_wins ............. —        (you, 6/02)  g→origin        │
├─────────────────────────────┴───────────────────────────────────────────────────────────────────┤
│ machine says REJECT   k keep-override · r reject(agree) · enter trust · x swipe · X blink · [/] scn │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Why it works:** Baseline vs candidate is a **true visual diff** — `x` drags a swipe handle, `X` blink-compares (the photographer's flicker test surfaces sub-pixel regressions side-by-side hides). The **5-rule cascade is a literal ladder with the fired rung lit** and wired to the exact regression check (`scene.fog.enabled`) — KEEP/REJECT stops being a black box (Norman). Rule names come from real `decision.json` (`rule_2_critical_judge_loss`). The 3 pairwise judges are **de-aliased to CANDIDATE-relative** via each verdict's `label_mapping` (FLIGHTDECK's correctness detail). **"authorized by: ⚑flag eval-003 (you)"** with `g→origin` closes the human-judgment loop and makes it traceable both directions (stolen from Spatial Atlas's flight-path, demetaphorized).

### (e) OVERVIEW / Categorization — Matrix (honest categorical encoding)

```
┌─ OVERLAY · MATRIX (m to toggle) · skills × categories — 0-1 deterministic only ───────────┐
│              exec  asset  cam    sem    pub    vis    ent    time   art  │ worst cat  score │
│ 3d-tiles     ████  ██░░!  ████   ███░   ░░░░!  ███░   ████   ████   ████ │ pub_repro  .55  │
│ camera       ████  ████   ██░░!  ████   ████   ███░   ████   ████   ████ │ cam_frame  .62  │
│ core-utils   ████  ████   ████   ████   ████   ████   ████   ████   ████ │ —          .98  │
│ custom-shdr  ▒▒▒▒  ▒▒▒▒   ▒▒▒▒   ▒▒▒▒   ▒▒▒▒   ▒▒▒▒   ▒▒▒▒   ▒▒▒▒   ▒▒▒▒ │ ◌ no checks run │
│ terrain      ████  ████   ████   ███░   ░░░░!  ███░   ████   ████   ████ │ pub_repro  .58  │
│ ...                                                                      │                 │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ steel ramp = passed/total per cell (0-1 ONLY) · ! = contains critical · ▒ = no checks (◌)  │
│ NOTE: visual 0-10 is NEVER on this matrix (scale purity). Press d for the dimension matrix. │
│ → arrow to a cell + Enter = filter the Stream to that skill×category cluster (worst-first)  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
**Why it works:** 14 skills × 9 *real* `category_scores` keys as honest 0-1 magnitude cells (`passed/total`), **never an averaged mean over unknowns** (resolves FLIGHTDECK's flagged fatal flaw): cells with no checks run render hollow ▒ `◌`, never a low fill (P4). The matrix carries **only the steel 0-1 ramp** — the 0-10 visual world is a *separate* `d` matrix so the two scales literally cannot collide (P3). Arrow-to-cell + `Enter` is Shneiderman overview→filter→detail in two keystrokes.

### (f) TRENDS — improvement over iterations (first-class, but honest)

```
┌─ OVERLAY · TRENDS (t) · cesiumjs-camera · iterations 000 → 004 ────────────────────────────┐
│ VISUAL WIN RATE (per iteration, from summary.md / decision counts)                          │
│  64% ┤                                              ╭──●  iter4 64%                          │
│  52% ┤                          ╭───────●───────────╯     ↑ KEEP                            │
│  41% ┤        ●─────────────────╯  iter2 52% KEEP                                            │
│      └──┬─────┬─────┬─────┬─────┬──   (steel %, NOT 0-10 — derived from W/(W+L) per iter)    │
│       i0    i1    i2    i3    i4                                                             │
│ ── DECISION HISTORY ──   i1 KEEP rule_2 · i2 KEEP rule_3 · i3 REJECT rule_4 · i4 KEEP rule_3 │
│ ── PER-DIMENSION (amber 0-10, ONLY iterations where judges scored; gaps = ◌, never 0) ──     │
│  framing   3 → 4 → ◌ → 7 → 8 ▁▂   ◌  subject  2 → ◌ → 5 → 6 → 6 ▁▁   (dashed where ungraded) │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Win-rate is steel %; dimension lines are amber 0-10 — separate panels, never co-plotted.    │
│ Gaps render as dashed/◌ (the judge didn't score that iteration), NOT as a zero dip.         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
**Why it works:** Answers "is this skill getting better?" as a first-class story (the brief's stated goal). **Win-rate trend is steel % derived from `decision.json` counts** (`W/(W+L)`), which the artifacts *do* contain — resolving the judges' "fabricated 0-10 trend line" flaw: per-dimension 0-10 lines render **only where judges actually scored**, with **gaps as dashed/◌, never a zero dip** (P4). The two scales live in **separate stacked panels** (P3).

---

## 5. Interaction + Keyboard Model (one grammar, both lifecycles)

**Spine (invariant everywhere):**
```
j / k or ↓/↑   next / prev in Stream (worst-first)      Enter   commit cursor → Stage / trust
gg / G          top (worst) / bottom                     Esc     up one altitude / close overlay
[ / ]           prev/next skill (rail) · prev/next scn   ⌘K      command palette (fuzzy: skill/case/iter/action)
/               focus filter            ? help overlay    g       jump to origin (flag↔iteration, bidirectional)
1-5             jump to station EVAL/REVIEW/OPT/DEC/PROM
```
**REVIEW verbs:** `a` accept · `f` flag→focus.json · `d` defer · `u` undo (toast) · `q` focus quant band · `◈`(`w`) focus qual band · `1-4` cardinal angle · `space` cycle angles · `z` zoom render.
**OPTIMIZE verbs:** `o` start loop on focused focus-skill (gated) · `space` pause · `a` abort (confirm) · `l` journal.
**DECIDE verbs:** `x` swipe-diff (hold/drag) · `X` blink-compare · `k` keep-override · `r` reject(agree) · `Enter` trust machine · `[`/`]` scenario · `l` jump to LOSS scenarios.
**PROMOTE:** `P` (uppercase = mutates live `SKILL.md`; **guarded**: Enter-to-confirm + 5s undo toast `Z`, *not* a typed-name ceremony — tuned for the solo trusted user per the judges' confirm-fatigue note).
**Global a11y:** `M` flatten any overlay → plain semantic list.

**Affordance convention (Norman):** lowercase = safe/reversible, uppercase = consequential. The action bar always prints the live verbs (self-documenting). `d` means Defer in Review and is unused in Decide (Decide uses `x` for diff) — **no key is overloaded across a shared Stage** (resolves Cadence's flagged `d` collision).

**THE NEAR-ZERO-INTERACTION COMMON PATH:** `1` (jump to Review) → thumb on `j`. Renders/check-ledgers flow past worst-first; silence = accept. Stop only where a render makes you flinch → one `f` flags it straight into focus.json. **92 cases triaged in ~3 minutes; the human's flags are the only seed for optimization.** A dwell-guard (auto-accept only fires on `j`-advance past a case dwelt on >400ms) plus an end-of-session "N accepted without dwell" summary catches autopilot (P5 safety net).

---

## 6. Data handling — concretely, mapped to real fields

**Multi-angle (`case.screenshots[]`, `source_context.screenshot_mode`):**
- `screenshots.length === 4 && screenshot_mode === 'cardinal_panorama'` → contact strip N/E/S/W, **weakest-judged angle auto-hero**, ONE set-level `visual_review.score`. `1-4`/`space` cycle.
- `=== 1` → single hero. `=== 2` → 2-up strip (covers the real 2-shot cases). `=== 0` → **check-ledger hero** (the common case), tied to `case.error` if render failed. Mode keyed **per case** (P4).

**Quant vs qual (typed primitives — the enforcement layer):**
- `<Score01 value={case.score}/>` → steel bar + `%` + machine glyph ▣. Source: `case.score`, `category_scores[k].score`, `checks[]`.
- `<Score10 value={vr.score} />` → renders `vr.score * 10` as `N.N/10` amber pip capsule + eye glyph ◈ **only if `vr.status` is reviewed**; else dashed ◌. (Real `visual_review.score` is **0-1**, e.g. 0.9 → "9.0/10" — never assume a stored 0-10; resolves the inverted-scale fatal flaw flagged in Cadence/Atlas.)
- `<Pct value={summary.visualWinRate}/>` → steel ring for win-rates. Three shapes, three scales, **never one axis** (P3).

**Auto-categorization (facet bar + Matrix):** five composable facets from real fields — **skill** (14), **category** (the 9 real `category_scores` keys), **dimension** (read dynamically from `visual_review.dimensions` keys per `schema_version`, NOT hardcoded — the persisted set is `clutter/framing/nonblank_render/occlusion/prompt_match/target_visible`; a `DIMENSION_LABELS` map gives friendly names and a fallback for any `^[a-z][a-z0-9_]*$` key), **verdict** (`result` + `vr.status`), **failure type** (`checks[].type` like `json_value_equals`, `critical` first). Facets AND-compose, recolor rail badges (Shneiderman dynamic queries).

**Mode A / B (per-case, off `visual_review.status`):** `not_reviewed`/`needs_review` → dashed slate ◌ "unknown" (P4). A scorecard with `visual_summary.visual_review_supplied === false` shows a top-strip badge "MODE B · deterministic-only" and every Stage defaults to the check ledger — the deterministic experience is **first-class, not a fallback** (P2).

---

## 7. The Optimization Bridge (the core product win)

**Today's reality (verified):** `focus.json` is rich (`source_run_id`, `threshold`, `focus_required`, `categories[]`, `skills[]`, `cases[].failed_checks[]`) but is **auto-generated from the scorecard's critical failures** — human review does NOT write it. **Skill Evaluation Console makes the human the author.**

1. **Write:** Every `f` (flag) in Review appends the case to an in-memory focus set keyed `case_id + skill + source_run_id`. The set is a live rail collection ("FOCUS 4"). A `provenance: "human_override"` tag distinguishes human flags (magenta hairline) from any auto-seeded entries.
2. **Hand off:** An explicit rail affordance **"Optimize N confirmed/suggested →"** (or `⌘K`) `POST`s the focus set to the server, which writes `focus.json` in the **exact existing schema** (so the loop consumes it unchanged), stamping `source_run_id` to guard against a stale scorecard re-run. Human-confirmed flags take precedence; if none exist, the user can explicitly hand off the machine suggestions as a reviewable starting set.
3. **Gate:** Optimize's handoff is disabled only when neither confirmed nor suggested flags exist. Suggestion-based handoffs are labeled in the handoff artifact and Optimize panel so they cannot be mistaken for human-confirmed focus.
4. **Stream:** `o` `POST`s to launch `scripts/run-loop.py` scoped to the focus skill; the server tails `journal.jsonl` (coarse train) + watches `runs_dir` (fine scenario board). Failure stubs surface honestly (§4c).
5. **Review & promote:** When `decision.json` lands, `Enter` carries you to Decide. The **CHASING bar** and **"authorized by: ⚑flag"** trace every iteration back to the human flag that triggered it (`g→origin`). `P` writes the candidate `SKILL.md` over the live one (with diff preview + 5s undo), archives to `optimization-snapshot-*`, and records the promotion on the rail's PROMOTE station. `rebaseline_required[]` from `decision.json` surfaces as an explicit warning row.

> **Honesty note baked into the build:** the loop is **skill-scoped** (`run-loop.py` regenerates all ~14 scenarios per iteration) and eval-case IDs ≠ optimization-scenario IDs. So the CHASING bar reads *"optimizing **cesiumjs-camera**, seeded by your flags: eval-113, eval-104"* — skill-level honesty, not a fabricated per-case lock (resolves the Atlas-editorial fatal flaw).

---

## 8. Visual Design System

**Mode:** dark-first (`#0B0D10` canvas). Light tokens supplied for WCAG/print parity.

**Color — provenance & status (the central legibility law, P3):**
| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--canvas` | `#0B0D10` | `#FBFCFD` | base |
| `--surface` / `--surface-2` | `#13161B` / `#1B1F26` | `#F1F3F6` / `#E7EAEF` | panels |
| `--ink-machine` (steel) | `#5BC8E8` | `#0E7C99` | deterministic 0-1 / % / checks |
| `--ink-eye` (amber) | `#E8A13B` | `#B5710A` | visual judge 0-10 / dimensions |
| `--ink-human` (magenta) | `#E26FB0` | `#B23A7E` | human override hairline |
| `--pass` / `--fail` / `--crit` | `#3FB37F` / `#E5534B` / `#FF6B5E`+ring | `#1E8A5A` / `#C13B33` / +ring | check states |
| `--unknown` (slate, dashed) | `#5A6473` | `#8A93A1` | not_reviewed / needs_review |
| `--live` (accent pulse) | `#6DABE4` | `#2B689F` | "running now" — the ONE reserved accent, drawn from the Cesium logomark blue |

Color is **never the sole signal**: steel/amber/magenta each carry a unit (`%`, `/10`), a glyph (▣ machine, ◈ eye, ⚑ human), or a shape (bar/pip/ring). Status carries a glyph (✓/✗/◌/!) so grayscale and colorblind users stay legible (WCAG 1.4.1).

**Typography:** UI sans `Inter` (system-ui fallback). **Monospace `JetBrains Mono`** for ALL deterministic numerals/checks/JSON-pointers (provenance-by-type — steals Atlas-editorial's register split, but mono-for-machine *only*, keeping prose in sans for dark-mode legibility, resolving the serif-on-dark gamble). Scale (1.250): 12 / 13 / 15 / 18 / 23 / 29 / 37. Line-height 1.5 body, 1.2 headings.

**Spacing:** 4px base grid (4/8/12/16/24/32/48). Rail 240px, Inspector 320px, action bar 44px. **Radii:** 4 (chips) / 8 (cards) / 12 (panels). **Density:** "calm" default — render/check-ledger owns ≥50% of Stage; prose (`observations[]`, `risks[]`, notes) collapsed behind ▾ (Shneiderman details-on-demand) so the hero is never crowded (resolves the density-vs-restraint tension flagged across LIGHTTABLE).

**Motion:** 120ms ease-out for verdict confirms and chip state; 200ms for altitude flights; `--live` pulse 1.6s. All `prefers-reduced-motion`-gated. Motion only confirms action (Norman), never decorates.

**Screenshot framing:** renders sit in a 1px `--surface-2` frame, `object-fit: contain`, max 16MB lazy-loaded thumbnails first (memory + the 20MB ceiling from project memory); full-res on `z`. Cardinal strip clamps each shot to a min 180px so the 4-up stays legible (else 2×2 reflow at <1280px).

---

## 9. Component Inventory + Server Endpoints

**React 19 + TS, Context + reducer, no router, lucide-react.**

```
App
├─ TopStrip            (run provenance, overall Score01, mode badge, live OPTIMIZE pill)
├─ Rail               (5 stations + badges, Focus collection, Matrix/Trends launchers)
├─ FacetBar           (5 composable facets, AND chips, live counts)
├─ Stream             (VirtualList — react-virtuoso; CaseRow / IterationRow)
├─ Stage              (mode: CheckLedgerHero | RenderHero | DiffHero | LoopMonitor)
│   ├─ ContactStrip   (multi-angle, weakest-auto-hero, 1-4/space)
│   ├─ DiffViewer     (SwipeOverlay + BlinkCompare)
│   └─ PipelineTrain  (journal-driven, RED on step_failed)
├─ Inspector
│   ├─ QuantBand      (Score01, CheckList w/ critical glyphs, JSON-pointer detail)
│   ├─ QualBand       (Score10 pip capsules, DimensionRow×N dynamic, prose ▾)
│   └─ CascadeLadder  (5 rungs, fired-rung lit, wired to regression check)
├─ ActionBar          (phase-aware verbs, self-documenting)
├─ Overlays           (Matrix, DimensionMatrix, Trends, Journal, CommandPalette, Help)
└─ primitives         (Score01, Score10, Pct, UnknownChip, ProvenanceGlyph, StatusGlyph,
                       Sparkline, ScenarioChip[WIN/LOSS/TIE de-aliased], Toast, ConfirmGuard)
hooks: useKeybindings, useFocusTrap, useFacets, useReducerStore, useJournalStream(SSE),
       useRunsWatch(SSE), useFocusSet
```

**Python stdlib server (reads · run-control · streaming):**
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/scorecard?run=latest` | full scorecard JSON |
| GET | `/api/screenshot?path=…` | serve PNG (thumb `?w=320`), enforce ≤16MB |
| GET | `/api/categories`, `/api/dimensions?schema=…` | facet metadata (dynamic dims) |
| GET | `/api/focus` · POST `/api/focus` | read / **write human focus.json** (the bridge) |
| GET | `/api/optimization/:skill/iterations` | iteration list + decision.json + summary.md |
| GET | `/api/optimization/:skill/:iter/scenario/:id` | run bundle (screenshot, console.json, judge-verdicts.json, scene-state.json, screenshot-quality.json, programmatic-checks.json, metadata.json) |
| GET | `/api/trends/:skill` | win-rate % per iter (from decision counts) + scored dims |
| POST | `/api/evaluate` | kick harness; SSE progress |
| POST | `/api/optimize/:skill` | launch run-loop.py (gated on focus); returns run handle |
| POST | `/api/optimize/:skill/abort` | abort loop |
| POST | `/api/promote/:skill/:iter` | overwrite SKILL.md + archive snapshot (guarded) |
| GET (SSE) | `/api/stream/journal/:skill/:iter` | tail journal.jsonl |
| GET (SSE) | `/api/stream/runs/:skill/:iter` | watch runs_dir for per-scenario bundles |

SSE streams use atomic-rename/append-only tailing with a `decision.json`/`summary.md` poll **fallback** so the pipeline UI reconciles even if events drop (judges' live-stream-race mitigation).

---

## 10. Accessibility + Performance

**A11y (WCAG 2.1 AA):** full keyboard operability (`useKeybindings`, no mouse-required action — mouse is an accelerator); visible AA-contrast focus rings on the dark palette; color never the sole signal (glyph + unit + shape triple-encode every state); `M` flattens any rich surface to a semantic DOM list; ARIA live-regions announce verdict commits, focus-set writes, and loop step transitions; `prefers-reduced-motion` disables flights/pulses; all overlays focus-trapped (`useFocusTrap`), `Esc`-dismissible; dimension matrix and Matrix expose data-table semantics.

**Performance:** `react-virtuoso` for Stream + Journal (decode-on-demand); screenshots thumbnail-first, full-res only on `z`/diff; force no 3D engine; SSE throttled to rAF; the rest is small (14 skills, ~92 cases) so the real cost is PNG decoding — lazy + `loading="lazy"` + server-side thumbnails keep the Stage jank-free; idle journal stream pauses tailing.

---

## 11. How this beats the three existing UIs

| Capability | audit-viewer | evaluation-review | optimization/dashboard | **Skill Evaluation Console** |
|---|---|---|---|---|
| Lifecycle coverage | review only, 4 fragmenting tabs | review only | optimize only, static dump | **all 5 stations, one spine, zero tabs** |
| The focus bridge | buried in a handoff tab | exports focus.json (unconsumed) | n/a | **human flag is the only seed; gated, streamed, traceable (g→origin)** |
| Render as evidence | tiny thumbnails | render-as-hero (good) | none | **render OR check-ledger hero, per-case Mode (P2)** |
| Quant vs qual | mixed, ambiguous | partial | Chart.js blur | **typed Score01/Score10/Pct, ink-coded, never one axis (P3)** |
| Unknown handling | reads as low | decent | n/a | **dashed ◌ "unknown," never a red zero, per-case (P4)** |
| Keyboard / common path | none | j/k/a/f/d (good) | none | **one grammar both lifecycles; ~3-min triage, silence-accept (P5)** |
| Optimize visibility | n/a | n/a | hand-served HTML | **live train (RED on fail) + journal + commit-log + cascade ladder** |
| Decide / promote | n/a | n/a | n/a | **swipe+blink diff, lit cascade, guarded promote + undo** |
| Categorization | a matrix tab | none | none | **composable facets + honest categorical Matrix (no mean-over-unknown)** |
| Dark / a11y | light-only, no kbd | dark, kbd | static | **dark+light tokens, full kbd, AA, flatten-mode** |

---

## 12. Build / Sequencing Plan (gorgeous, runnable v1 fast)

**M0 — Skeleton + tokens (day 1-2):** App shell (Rail / Stream / Stage / Inspector / ActionBar / TopStrip), full token system §8, `useReducerStore`, `useKeybindings`, the typed primitives (`Score01/Score10/Pct/UnknownChip/ProvenanceGlyph/StatusGlyph`). *Visible payoff: empty but beautiful.*

**M1 — EVALUATE + REVIEW on real data (day 3-6):** `/api/scorecard`, `/api/screenshot`. Stream (virtualized, worst-first, "Needs You"), CheckLedgerHero (Mode B default), RenderHero + ContactStrip (Mode A), QuantBand + QualBand with dynamic dimensions, FacetBar. **`a/f/d/j/k` triage loop with dwell-guard.** *This alone beats both review UIs.*

**M2 — The bridge (day 7-8):** in-memory focus set, FOCUS rail collection, `POST /api/focus` writing the real schema, "Hand off to Optimize →," the gate + escape hatch. *Closes the brief's core product gap.*

**M3 — OPTIMIZE live (day 9-12):** `POST /api/optimize`, SSE journal + runs watch, PipelineTrain (RED on `step_failed`), ScenarioBoard (de-aliased verdicts), iteration commit-log, CHASING bar.

**M4 — DECIDE + PROMOTE (day 13-16):** DiffViewer (swipe + blink), CascadeLadder wired to regression check, decision/summary/run-bundle endpoints, `g→origin`, guarded `P` promote + archive + undo.

**M5 — Overlays + polish (day 17-19):** Matrix, DimensionMatrix, Trends (honest gaps), CommandPalette, Help, flatten-mode, a11y pass, reduced-motion, SSE fallback reconciliation.

Ship M1 as the first demo: a dark, keyboard-first, worst-first triage console that renders the *real* Mode B scorecard beautifully and writes a human focus set — already past all three references.

---

*This spec is grounded in the current evaluation scorecard, visual-review, optimization handoff, decision, and run-journal schemas. Generated run artifacts remain local/CI outputs and are intentionally not part of the public source surface.*
