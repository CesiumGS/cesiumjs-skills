# Skill Evaluation Console

**One console for the whole CesiumJS skill-quality lifecycle** (evaluate → review →
optimize → decide → promote) in a single, keyboard-first, dark-by-default surface.

Skill Evaluation Console is a ground-up redesign that unifies what used to live in three separate,
weaker tools (legacy `audit-viewer`, `evaluation-review`, and the static
`optimization/dashboard`). Those older UIs now live in the sibling checkout
`../cesiumjs-skills-legacy-uis/`. The full design rationale is in
[`DESIGN-SPEC.md`](./DESIGN-SPEC.md).

## What it is

A three-pane spine (Rail / Stream / Stage + Inspector) reused at every **station**,
so the lifecycle is one continuous journey instead of a tab switch:

| Station | What you do |
|---|---|
| **1 Evaluate** | Land on the run's health: verdict **with its gates named** (deterministic ▣ vs visual ◈), score-vs-threshold bar, Δ vs the **comparison baseline**, changed-vs-baseline drill cards (regressed / fixed / still failing / new / removed / incomplete → the exact cases), and a **provenance & reproduce** card. |
| **2 Review** | Worst-first triage. The machine pre-graded everything; agreeing is a keystroke (`j`). The render is the hero when present; the deterministic **check ledger** is the hero when it is not. `f` flags a case straight into the focus set that seeds optimization. |
| **3 Optimize** | Watch the self-optimization loop per skill: a git-style iteration commit log, the pipeline train driven 1:1 by the real journal (red on `step_failed`), the per-scenario WIN/LOSS/TIE board, plus each iteration's **recorded codegen provenance** (harness / model / effort, or an honest "unrecorded"). |
| **4 Decide** | Candidate-vs-baseline **visual diff** (swipe `x` / blink `X`), the lit 5-rule decision cascade, and the three de-aliased judges. |
| **5 Promote** | The guarded hand-off of a KEEP candidate to the live `SKILL.md`. |
| **6 Models & Harnesses** | Its own **Insights** rail group beside the lifecycle, split into two analysis dashboards behind a segmented control. **Harnesses**: KPI tiles (harness count, runs, pass rate, average score, multimodal coverage), registry capability cards, the runs-by-harness leaderboard, and the run-score trend. **Models**: KPI tiles (models available and exercised, pipeline default, best qualified win rate, iterations), the observed model-performance leaderboard (keep rate, win rate ± σ stability, average wall clock, recency, drill into Optimize), the per-skill optimization trend, and the full model catalogs with effort-aware cost meters. |

## The harness/model registry

`harness-registry.json` is the bona fide, data-only description of the agent-CLI
harnesses: Codex CLI (OpenAI · ChatGPT subscription, fully multimodal) and
OpenCode CLI (GitHub Copilot subscription, **text only**: the provider disables
vision account-wide, so image-bearing calls re-route to Codex). Each entry
carries its model catalog with tier, a relative cost meter (Very low → Premium,
effort-aware since reasoning bills as output tokens), native vision, effort
levels, and context. **Adding a harness or model is adding an entry here**, with
no code changes. `/api/registry` overlays the live pipeline
defaults from `harness/models.py` at read time, so the cards always show what a
run started today would actually use.

Declared capability and observed performance are kept visually separate, and
"unrecorded" provenance (legacy artifacts that predate stamping) renders as a
dashed chip: grouped, visible, never guessed.

The central legibility law: the deterministic **machine** speaks steel + mono + `%`
(▣); the **visual judge** speaks amber + prose + `/10` (◈); a **human** override
carries a magenta `⚑`. The two score scales physically cannot share an axis, and
*unknown* renders as a dashed slate chip, never a red zero.

## Quick start

```bash
cd apps/evaluation-console
npm install
npm run build

# From the repo root: opens the newest scorecard on port 8933
python3 evaluation/scripts/open-evaluation-viewer.py --open

# or a specific scorecard
python3 apps/evaluation-console/server.py \
  evaluation/artifacts/audits/full-merged-20260605T2000Z/scorecard.json \
  --state-dir /tmp/eval-console-state --port 8933 --open
```

The server binds `127.0.0.1:8933` by default. It reads the scorecard and the
`optimization/` artifacts and serves screenshots only from inside the repository root.

Dev with hot reload: `npm run dev` (Vite at 127.0.0.1:5174, proxying `/api` to 8933).

## The optimization bridge

`f` (flag) in Review appends a case to the focus set. **Focus** in the rail hands it
off, and the server writes `focus.json` via the real `build_focus`, restricted to the
human-confirmed flags, so review genuinely steers the loop:

```bash
python3 optimization/scripts/run-all-evals.py --from-focus <focus.json> --skills <auto>
```

## Keyboard

`1`–`6` stations · `j`/`k` move · `gg`/`G` ends · `a`/`f`/`d` accept/flag/defer ·
`e` confirm+advance · `u` undo · `space` details · `z` lightbox · `[`/`]` shots/scenarios ·
`x` swipe · `X` blink · `m` Skill × Category Matrix · `t` trends · `h` Run Browser · `b` set baseline (in the Run Browser) ·
`⌘K` palette · `T` theme · `?` help · `Esc` close.

## Output files (beside the scorecard, or `--state-dir`)

| File | Purpose |
|---|---|
| `review-decisions.json` | Audit trail of grades + human overrides. |
| `focus.json` | Confirmed-flag focus set for `run-all-evals.py --from-focus`. |
| `optimization-handoff.json` | Human-readable hand-off summary. |
