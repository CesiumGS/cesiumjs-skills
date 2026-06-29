# Skill Evaluation Console

**One console for the whole CesiumJS skill-quality lifecycle** — evaluate → review →
optimize → decide → promote — in a single, keyboard-first, dark-by-default surface.

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
| **1 Evaluate** | Land on the run's health: distribution, KPIs, per-skill iteration history. |
| **2 Review** | Worst-first triage. The machine pre-graded everything; agreeing is a keystroke (`j`). The render is the hero when present; the deterministic **check ledger** is the hero when it is not. `f` flags a case straight into the focus set that seeds optimization. |
| **3 Optimize** | Watch the self-optimization loop per skill: a git-style iteration commit log, the pipeline train driven 1:1 by the real journal (red on `step_failed`), and the per-scenario WIN/LOSS/TIE board. |
| **4 Decide** | Candidate-vs-baseline **visual diff** (swipe `x` / blink `X`), the lit 5-rule decision cascade, and the three de-aliased judges. |
| **5 Promote** | The guarded hand-off of a KEEP candidate to the live `SKILL.md`. |

The central legibility law: the deterministic **machine** speaks steel + mono + `%`
(▣); the **visual judge** speaks amber + prose + `/10` (◈); a **human** override
carries a magenta `⚑`. The two score scales physically cannot share an axis, and
*unknown* renders as a dashed slate chip — never a red zero.

## Quick start

```bash
cd apps/evaluation-console
npm install
npm run build

# from repo root — opens the newest scorecard on port 8933
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
off — the server writes `focus.json` via the real `build_focus`, restricted to the
human-confirmed flags, so review genuinely steers the loop:

```bash
python3 optimization/scripts/run-all-evals.py --from-focus <focus.json> --skills <auto>
```

## Keyboard

`1`–`5` stations · `j`/`k` move · `gg`/`G` ends · `a`/`f`/`d` accept/flag/defer ·
`e` confirm+advance · `u` undo · `space` details · `z` lightbox · `[`/`]` shots/scenarios ·
`x` swipe · `X` blink · `m` matrix · `t` trends · `⌘K` palette · `T` theme · `?` help · `Esc` close.

## Output files (beside the scorecard, or `--state-dir`)

| File | Purpose |
|---|---|
| `review-decisions.json` | Audit trail of grades + human overrides. |
| `focus.json` | Confirmed-flag focus set for `run-all-evals.py --from-focus`. |
| `optimization-handoff.json` | Human-readable hand-off summary. |
