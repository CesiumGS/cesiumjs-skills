# CesiumJS Evaluation

This directory is the home for pure evaluation. It is intentionally separate
from `optimization/`, which contains the self-optimization loop that proposes,
runs, judges, decides, and promotes candidate skill changes.

## Boundary

Evaluation answers: did an implementation satisfy the requested behavior?

Optimization answers: should a candidate skill replace or update the current
best skill?

The evaluation layer must not propose candidate skills, mutate `skills/`, write
current-best metadata, or make promotion decisions. Those actions belong under
`optimization/`.

`node packages/eval/bin/cesium-eval.js validate --suite evaluation` enforces the
evaluation data contracts.

## Feedback Incorporated

The current product requirements are captured in:

```text
evaluation/docs/prd-deterministic-scorecard-evaluation.md
```

The current baseline coverage audit is captured in:

```text
evaluation/docs/baseline-review-audit.md
```

Review feedback pointed toward a scorecard-first deterministic
evaluation harness:

- decouple evaluation from self-optimization;
- use synthetic cases where the expected state is known;
- prefer unit-test-like checks when a behavior can be asserted directly;
- make qualitative visual review a first-class scorecard lane for render
  quality, framing, occlusion, and visual intent;
- keep qualitative visual review separate from deterministic correctness and
  from optimization promotion judges;
- produce a CI/CD-safe scorecard as the primary deliverable.

The canonical example is a prompt such as "translate this object six units" and
a deterministic assertion that the final scene state changed by exactly six
units along the intended axis.

## Current Shape

- `cases/` - public, deterministic evaluation cases.
- `fixtures/` - tracked synthetic evidence bundles for case/check tests.
- `schemas/` - JSON schemas for cases and evidence contracts.
- `packages/eval/src/evaluation/` - pure evaluation code with no optimizer side effects.
- `packages/eval/tests/` - unit tests for deterministic checks and case fixtures.
- `cesium-eval score` - CI-safe scorecard command for JSON/Markdown output.
- `artifacts/` - ignored local scorecards and captured evidence.

## Deterministic Contracts

The first check contract is `entity_translation_delta`: compare a named
entity's before/after position and assert the delta along a local
east/north/up or raw Cartesian axis within a meter tolerance.

That contract is intentionally narrower and more unit-test-like than the
current optimization checks. It validates semantic scene state instead of only
checking whether code ran, an API name appeared, or a screenshot looked right.

Current deterministic matcher types include:

- `no_runtime_errors` for execution health.
- `code_runs` for observed generated-code execution success.
- `pattern_present` and `pattern_absent` for deterministic source-contract
  checks imported from the archived optimization scenarios.
- `entity_exists` for scene entity state.
- `entity_translation_delta` for ENU or Cartesian spatial transforms.
- `camera_target_view` for target-view camera behavior and overhead rejection.
- `json_value_equals` for generated-output semantic contracts.
- `json_value_compare` for numeric or exact JSON Pointer assertions with
  optional tolerance.
- `collection_count` for entity, imagery layer, primitive, data source, and
  event-list counts captured in normalized evidence.
- `artifact_text_absent` for public artifact hygiene checks that block local
  paths, localhost URLs, and obvious token-shaped strings.

The scorecard category taxonomy is intentionally stable so failures can be
grouped into optimization focus areas:

```text
execution_health
semantic_scene_state
camera_framing
visual_fidelity
asset_and_provider_safety
interaction_behavior
time_behavior
source_contract
artifact_hygiene
public_reproducibility
```

Cases should prefer normalized scene-state probes over generated-source regexes
whenever the behavior can be asserted directly. Generic JSON Pointer matchers
are the bridge for most newly captured state: imagery layers, primitive counts,
clock settings, terrain/globe flags, interaction event logs, and data sources
can all be scored without adding a custom matcher for every field.

`probe.capture` is now a validated contract between a case and the capture
layer. Supported normalized paths include:

```text
camera.position_ecef
camera.direction_ecef
entities[marker].position_cartographic
imagery_layers[*].provider
imagery_layers[*].alpha
primitives[*].type
tilesets[*].source
tilesets[*].ready
tilesets[*].distanceToCameraMeters
data_sources[*].entity_count
clock.multiplier
scene.requestRenderMode
globe.depthTestAgainstTerrain
terrain.provider
terrain.requiresIonToken
events.click_log
after.values.translated_points
generated_code
execution.success
errors
screenshots
```

Validation checks that generic JSON Pointer assertions such as
`/after/imagery_layers/0/provider` are backed by a corresponding
`probe.capture` declaration such as `imagery_layers[*].provider`.

The comprehensive baseline audit is derived live from the tracked scenario
manifests (`optimization/scenarios/<skill>/`): `cesium-eval audit` builds one
execution-health case per scenario and scores it against the rendered bundle
the optimization loop wrote under the gitignored `optimization/runs/`. No
captured evidence is committed for it — the audit always judges the current
baselines, so it can actually fail when a skill regresses.

The hand-built unit-style cases include:

```text
evaluation/cases/cesiumjs-entities/eval-001-translate-marker-east-6m.json
evaluation/cases/cesiumjs-entities/eval-002-translate-all-objects-x-10.json
evaluation/cases/cesiumjs-camera/eval-001-target-view-volume.json
evaluation/cases/cesiumjs-spatial-math/eval-001-cartesian-translation-contract.json
evaluation/cases/cesiumjs-imagery/eval-001-public-layer-contract.json
evaluation/cases/cesiumjs-time-properties/eval-001-clock-contract.json
evaluation/cases/cesiumjs-interaction/eval-001-click-event-contract.json
evaluation/cases/cesiumjs-terrain-environment/eval-001-globe-terrain-contract.json
evaluation/cases/cesiumjs-3d-tiles/eval-001-public-tileset-contract.json
```

They cover the review-derived failure modes: semantic transforms that may
not show up visually, camera fly-to behavior that can hover above a target,
generated-output contracts that are better checked like unit tests, and public
imagery/artifact hygiene that should be CI-verifiable. The newer domain
contracts extend the same pattern to clock/time behavior, observable
interaction effects, public terrain/globe settings, and public URL-backed 3D
Tiles readiness/framing.

Tracked synthetic evidence fixtures live under:

```text
evaluation/fixtures/
```

These fixtures are hand-authored pass/fail pairs: each encodes a specific
failure mode and proves the corresponding checker catches it. They test the
evaluation harness itself and double as worked examples of the evidence
contract. Captured observations (rendered baselines, screenshots, run bundles)
are never committed here — they live under the gitignored
`optimization/runs/` and `evaluation/artifacts/`, and `cesium-eval audit`
reads them live.

## Two-Lane Baseline Audit (deterministic + qualitative)

**Invariant: every eval has two lanes.** A *deterministic* programmatic lane (the
binding gate) **and** a *qualitative* static rendered-evidence lane (advisory).
The qualitative lane is a single-render, non-pairwise judge that scores each
baseline **0-10** against a fixed 6-dimension rubric with hard liveness/subject
gates and named CesiumJS failure modes (see [docs/qualitative-audit-design.md](docs/qualitative-audit-design.md)).
With Codex CLI or GitHub Copilot CLI, the qualitative judge attaches
the screenshot PNG files to each judge call and scores from direct image
inspection. The OpenCode harness is text-only (the provider disables vision
account-wide), so it cannot serve this lane — an image-bearing call to it is an
error, never a silent reroute.
Screenshot-quality checks, programmatic checks, console output, scene state,
and scenario requirements remain supporting evidence for auditability and
failure diagnosis.
The qualitative score can only *downgrade* a deterministically-passing baseline
(a blocking failure flag → fail/needs_review); it can never upgrade a deterministic
failure. The deterministic lane stays TypeScript-owned and binding.

The judge lives in `packages/eval/src/evaluation/judge/staticJudge.ts`
(`judgeRender` + the `static-visual-v1` prompts). CI and the local
fan-out both call the same module via one runner:

```bash
# Blank run first: from a clean checkout, generate the baseline source and
# render it into complete evidence bundles under optimization/runs/<skill>/baseline.
# Resumable — anything already complete is kept, only the gaps are filled.
node packages/eval/bin/cesium-eval.js render-baselines --skills all

# Deterministic lane only (fast, no LLM) — the CI PR gate:
node packages/eval/bin/cesium-eval.js audit --skills all --no-judge

# Both lanes (qualitative screenshot judge, 3-judge median panel).
# The judge must be vision-capable; codex is the configured default:
node packages/eval/bin/cesium-eval.js audit --skills all --judge-harness codex --judge-model auto --n-judges 3

# Same qualitative lane through GitHub Copilot CLI:
node packages/eval/bin/cesium-eval.js audit --skills all --judge-harness copilot --judge-model auto --n-judges 3

# Review results in the evaluation console:
node packages/eval/bin/cesium-eval.js serve evaluation/artifacts/audits/<run_id>/scorecard.json --open
```

Both lanes need rendered baselines under `optimization/runs/<skill>/baseline`
(gitignored), which `render-baselines` produces: the visual lane reads the
screenshots and the deterministic lane reads `console.json` and
`programmatic-checks.json` from the same bundle, so a bundle missing either is
not a usable baseline. `--out <dir>` writes the same layout elsewhere (it must
stay inside the repository — the eval page is served from the repo root) and is
what `audit --bundle-root <dir>` then reads. Local fan-out helpers can run the
same judge module across all baselines concurrently; in CI the blocking
deterministic gate is `.github/workflows/pr-gate.yml`, the per-skill live lane is
`.github/workflows/skill-eval.yml`, and `.github/workflows/baseline-audit.yml`
runs the qualitative lane nightly (rendering baselines first).

## What Happens When a Skill Changes

A skill file is a prompt, so editing its wording changes program behaviour. Two
lanes answer two different questions about that edit, and both run automatically
on the pull request.

**Tier 1 — the skill contract (hermetic, blocking, free).** `cesium-eval check
skills` reads `skills/<id>/SKILL.md` directly and decides what can be decided by
reading it: frontmatter shape, `name` matching the directory, a description that
still carries its `Use when ...` activation clause and stays inside the length
limit, an H1, every ```js fence parsing as JavaScript, and every referenced
CesiumJS symbol existing in `wiki/Domain-Mapping.md`. It also fails when a domain
skill no longer documents a single symbol it owns, or when live scenarios outlive
the skill they belong to.

It runs inside `.github/scripts/gate.sh`, so it is part of the required `gate`
check on every pull request including forks, needs no credentials, and takes
milliseconds. It is unscoped on purpose: checking all fifteen skills is cheaper
than working out which ones to check.

```bash
node packages/eval/bin/cesium-eval.js check skills
node packages/eval/bin/cesium-eval.js check skills --skills cesiumjs-camera
```

**Tier 2 — the live lane (`skill-eval.yml`, blocking, costs money).** For each
skill the pull request touched, it re-runs the real path: the edited `SKILL.md`
goes into the codegen system prompt, the returned code renders in headless
Chromium, and the fresh bundles are scored by the same deterministic checks the
nightly audit uses.

```bash
node packages/eval/bin/cesium-eval.js render-baselines \
  --skills cesiumjs-primitives --force --regenerate \
  --codegen-harness codex --out evaluation/artifacts/skill-eval
node packages/eval/bin/cesium-eval.js audit \
  --skills cesiumjs-primitives --no-judge \
  --bundle-root evaluation/artifacts/skill-eval
```

`--no-judge` is deliberate: this lane must never fail on a matter of taste, so
the visual panel stays in the nightly advisory lane and a red here is always
mechanical — a required API missing from the generated code, a forbidden one
present, or the page throwing.

Scope and limits worth knowing before relying on it:

- Only skills with `optimization/scenarios/<id>/` are evaluated live; that
  directory is the work list. A skill without scenarios (the orientation skill,
  or a new domain whose scenarios have not landed) is covered by Tier 1 only.
- It needs `CODEX_AUTH_CONTENT`, so it cannot run on a fork pull request. Forks
  get a loud "did not run" notice in the job summary; a maintainer should
  dispatch the lane before merging such a change.
- `CESIUM_ION_TOKEN` is optional. The public scenario suite is built to render
  without ion entitlements.
- There is a model in the loop, which makes this lane specific rather than
  sensitive. A wording change that genuinely misdirects an agent — a wrong
  deprecation notice, a removed constraint, guidance contradicting a scenario —
  shows up as failed `pattern_present` / `pattern_absent` / runtime-health
  checks. A subtly wrong aside often does not: a strong codegen model follows
  the scenario prompt and ignores it. Tier 1 exists because it does not have
  this property.

## Local Validation

```bash
node packages/eval/bin/cesium-eval.js validate --suite evaluation
node packages/eval/bin/cesium-eval.js check skills
node packages/eval/bin/cesium-eval.js score
node packages/eval/bin/cesium-eval.js audit --skills all --no-judge
npm test --workspace @cesiumjs-skills/eval
```

Or run the whole blocking gate exactly as CI does, which includes all of the
above except the audit:

```bash
npm run gate
```

The current runner core accepts a case and a captured before/after evidence
bundle:

```bash
node packages/eval/bin/cesium-eval.js case evaluation/cases/cesiumjs-entities/eval-001-translate-marker-east-6m.json --evidence evaluation/fixtures/cesiumjs-entities/eval-001-pass.evidence.json
```

The browser capture layer is deliberately separate from the pure runner. It
produces a scene-state evidence bundle and then calls `evaluation.runner.run_case`
when `--run-checks` is supplied.

The first browser-capture CLI is:

```bash
node packages/eval/bin/cesium-eval.js capture evaluation/cases/cesiumjs-entities/eval-001-translate-marker-east-6m.json --candidate-js path/to/candidate.js --run-checks
```

It writes local evidence under `evaluation/artifacts/` by default. That
directory is ignored because captured browser evidence can contain local runtime
details; only curated synthetic fixtures under `evaluation/fixtures/` are
tracked.

The scorecard CLI writes JSON and Markdown under `evaluation/artifacts/` by
default and exits non-zero if a critical check fails or the overall score is
below the default 95% threshold.

Qualitative visual review can be attached to the same scorecard without giving
the evaluator any optimizer side effects:

```bash
node packages/eval/bin/cesium-eval.js score \
  --visual-review evaluation/artifacts/review-ui/sample-scorecard/visual-review.json \
  --require-visual-review
```

The visual review file records per-case status, summary, structured visual
dimensions, observations, risks, screenshots, reviewer metadata, and whether
the visual assessment is gate blocking. Deterministic checks still answer exact
state correctness; visual review answers whether the rendered result is usable
and visually faithful.

The structured visual dimensions are:

```text
nonblank_render
target_visible
framing
occlusion
clutter
prompt_match
```

Each dimension has its own `pass`, `fail`, `needs_review`, or `not_applicable`
status plus a short note. These dimensions are intentionally separate from
deterministic correctness so a case can pass exact state checks while still
requiring human visual review for framing, readability, or prompt fit.

For local review, serve any scorecard in the evaluation console:

```bash
node packages/eval/bin/cesium-eval.js score --fixture-expectation fail --visual-review evaluation/artifacts/review-ui/sample-scorecard/visual-review.json --output-dir evaluation/artifacts/review-ui/sample-scorecard
node packages/eval/bin/cesium-eval.js optimize focus evaluation/artifacts/review-ui/sample-scorecard/scorecard.json --output evaluation/artifacts/review-ui/sample-scorecard/focus.json
node packages/eval/bin/cesium-eval.js serve evaluation/artifacts/review-ui/sample-scorecard/scorecard.json --open
```

The generated UI is local-only and ignored with the rest of
`evaluation/artifacts/`.

From the same scorecard, the local optimization launcher can be dry-run with:

```bash
node packages/eval/bin/cesium-eval.js optimize all --from-scorecard evaluation/artifacts/review-ui/sample-scorecard/scorecard.json --max-iterations 1 --stop-on regression --dry-run
```
