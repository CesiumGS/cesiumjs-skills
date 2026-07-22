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
| **6 Models** | Its own **Insights** rail station beside the lifecycle. KPI tiles (models available and exercised, pipeline default, best qualified win rate, iterations), the observed model-performance table (keep rate, win rate ± σ stability, average wall clock, recency, drill into Optimize), the per-skill optimization trend, and the full model catalogs with effort-aware cost meters. |
| **8 Harnesses** | The second **Insights** station. KPI tiles (harness count, runs, pass rate, average score, multimodal coverage), registry capability cards, and the runs-by-harness leaderboard. |
| **7 Live** | Real-time progress of eval runs **while they are still running** — and the place to **launch** one. The server tails each run's progress journal (`journal.jsonl` for optimization loops, `progress.jsonl` for baseline audits) and counts artifacts on disk, so the animated progress bar, phase pipeline, and per-case board reflect only what has verifiably happened — agent phases earn credit at completion, never by guess. The **Launch an Eval Run** panel mirrors the real `cesium-eval audit` flag surface, grouped by role: skills (`--skills`), a Code Generation group (`--harness` provenance stamp; the codegen model is recovered from each baseline's meta sidecar, since audit has no model flag), and a Visual Judging group (`--no-judge` toggle, `--adapter`, `--judge-model`, `--n-judges`), with visual judging **on by default** (deterministic-only is an explicit downgrade with a warning) and a live command preview of the exact CLI invocation. It then POSTs to the server which spawns `cesium-eval audit --journal` detached. The UI polls every 2.5 s while a run is active; the Dashboard grows a "happening now" banner, the top strip shows a live pill, and the rail badge pulses. When a run finishes, a toast fires and the console refreshes so it lands in Recent Runs automatically. Runs quiet for 30 min are demoted to "stalled". |

## The harness/model registry

[`config/harness-registry.json`](../../config/harness-registry.json) is the bona
fide, data-only description of the agent-CLI
harnesses: Codex CLI (OpenAI · ChatGPT subscription, fully multimodal) and
OpenCode CLI (GitHub Copilot subscription, **text only**: the provider disables
vision account-wide, so image-bearing calls re-route to Codex). Each entry
carries its model catalog with tier, a relative cost meter (Very low → Premium,
effort-aware since reasoning bills as output tokens), native vision, effort
levels, and context. **Adding a harness or model is adding an entry here**, with
no code changes. `/api/registry` overlays the role defaults from
[`eval.config.json`](../../eval.config.json) at read time, so the cards always
show what a run started today would actually use.

Declared capability and observed performance are kept visually separate, and
"unrecorded" provenance (legacy artifacts that predate stamping) renders as a
dashed chip: grouped, visible, never guessed.

### Codegen provenance recovery

Every scorecard should name the codegen **harness** and **model** it evaluated,
but older runs only stamped the harness (or nothing). Rather than guess, the
console *recovers* provenance: each scored case points at the generated source it
graded (`evidence_summary.actual_source_path`), and that source sits beside a
`*.meta.json` recording the exact `harness` / `model_id` / `model_variant` it was
produced with. `resolveCodegenProvenance` (in `packages/eval/src/evaluation/scorecard.ts`)
walks a scorecard back to those metas and takes the majority — so the harness and
model **always** resolve to a real value when the generated code is on disk, and
stay an honest "not recorded" only when it genuinely cannot be recovered.

This runs in three places, so nothing slips through:

- **Forward** — `cesium-eval audit` stamps the recovered model at write time.
- **At read time** — the server fills any missing harness/model from the metas
  when it lists runs (a zero-cost lookup once a file is stamped).
- **Backfill** — `node packages/eval/bin/cesium-eval.js backfill`
  stamps `harness`, `artifacts.model`, `artifacts.model_variant`, and
  `artifacts.evidence_source` onto historical scorecards in place. It is
  idempotent (`--dry-run` previews, `--check` is a CI gate) and never overwrites
  a real value.

Model Performance recency reflects the **last time a combo was active** — the
newer of when its code was generated and when a run last evaluated it — so a
fresh audit over months-old baselines reads as "just now", not "21d ago".

The central legibility law: the deterministic **machine** speaks steel + mono + `%`
(▣); the **visual judge** speaks amber + prose + `/10` (◈); a **human** override
carries a magenta `⚑`. The two score scales physically cannot share an axis, and
*unknown* renders as a dashed slate chip, never a red zero.

## Quick start

```bash
cd apps/evaluation-console
npm install
npm run build

# From the repo root: serve a scorecard in the console
node packages/eval/bin/cesium-eval.js serve \
  evaluation/artifacts/audits/full-merged-20260605T2000Z/scorecard.json \
  --state-dir /tmp/eval-console-state --port 8933 --open
```

The server binds `127.0.0.1:8933` by default. It reads the scorecard and the
`optimization/` artifacts and serves screenshots only from inside the repository root.

Dev with hot reload: `npm run dev` (Vite at 127.0.0.1:5174, proxying `/api` to 8933).

## Launching runs & progress journals

The Live station can start a baseline audit from the browser. `POST /api/live/launch`
(`{"kind": "audit", "skills": [...], "judge": true, "n_judges": 3, "adapter": "opencode"}`)
validates against the skills on disk (`GET /api/live/skills`), then spawns

```bash
node packages/eval/bin/cesium-eval.js audit --skills all \
  --output-dir evaluation/artifacts/audits/live-<UTC> \
  --journal evaluation/artifacts/audits/live-<UTC>/progress.jsonl
```

detached (`launch.json` + `launch.log` beside the artifacts record provenance and
capture output). Only whitelisted skills/adapters and a fixed argv are accepted — no
shell, no free-form arguments.

`--journal` makes the audit stream an append-only JSONL journal to
`<output-dir>/progress.jsonl`: `audit_started` (with the full case roster),
`judge_started` / `judge_case_completed` / `judge_completed`,
`scoring_started` / `scoring_case_completed` / `scoring_completed`,
`scorecard_written`, and finally `audit_completed` or `audit_failed`. Each line is
flushed as it happens, so anything can follow along — the console's Live tab, a
`tail -f`, or a CI step:

```bash
node packages/eval/bin/cesium-eval.js audit ... --journal &
tail -f <output-dir>/progress.jsonl | jq -r '[.timestamp_utc, .event] | @tsv'
```

The same flag works headless in CI: the journal is plain JSONL on disk, no server
required, and the terminal event tells you whether to collect the scorecard.

## The optimization bridge

`f` (flag) in Review appends a case to the focus set. **Focus** in the rail hands it
off, and the server writes `focus.json` via `buildFocus`, restricted to the
human-confirmed flags, so review genuinely steers the loop:

```bash
node packages/eval/bin/cesium-eval.js optimize all --from-focus <focus.json> --skills <auto>
```

## Keyboard

`1`–`7` stations (`7` = Live) · `j`/`k` move · `gg`/`G` ends · `a`/`f`/`d` accept/flag/defer ·
`e` confirm+advance · `u` undo · `space` details · `z` lightbox · `[`/`]` shots/scenarios ·
`x` swipe · `X` blink · `m` Skill × Category Matrix · `t` trends · `h` Run Browser · `b` set baseline (in the Run Browser) ·
`⌘K` palette · `T` theme · `?` help · `Esc` close.

## Output files (beside the scorecard, or `--state-dir`)

| File | Purpose |
|---|---|
| `review-decisions.json` | Audit trail of grades + human overrides. |
| `focus.json` | Confirmed-flag focus set for `cesium-eval optimize all --from-focus`. |
| `optimization-handoff.json` | Human-readable hand-off summary. |
