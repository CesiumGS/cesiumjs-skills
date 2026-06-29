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

`python3 evaluation/scripts/validate-evaluation.py` enforces the code boundary:
Python under `evaluation/` may not import `optimization/` or directly invoke
optimizer scripts. Evaluation fixtures may still preserve historical
optimization artifact paths as provenance.

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
- `framework/` - pure evaluation code with no optimizer side effects.
- `tests/` - unit tests for deterministic checks and case fixtures.
- `scripts/run-scorecard.py` - CI-safe scorecard command for JSON/Markdown output.
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

The comprehensive review suite includes all 83 archived optimization prompts
across the 14 CesiumJS skills as baseline-observed `eval-101+` cases. Those
cases preserve the original prompt and expected behaviors while checking the
observed baseline generated code and browser artifacts.

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

## Two-Lane Baseline Audit (deterministic + qualitative)

**Invariant: every eval has two lanes.** A *deterministic* programmatic lane (the
binding gate) **and** a *qualitative* static rendered-evidence lane (advisory).
The qualitative lane is a single-render, non-pairwise judge that scores each
baseline **0-10** against a fixed 6-dimension rubric with hard liveness/subject
gates and named CesiumJS failure modes (see [docs/qualitative-audit-design.md](docs/qualitative-audit-design.md)).
With OpenCode or Codex CLI, the qualitative judge attaches the screenshot PNG
files to each judge call and scores from direct image inspection.
Screenshot-quality checks, programmatic checks, console output, scene state,
and scenario requirements remain supporting evidence for auditability and
failure diagnosis.
The qualitative score can only *downgrade* a deterministically-passing baseline
(a blocking failure flag → fail/needs_review); it can never upgrade a deterministic
failure. The deterministic lane stays Python-owned and binding.

**Single source of truth:** the judge lives in `evaluation/framework/judge/`
(`static_judge.judge_render` + the `static-visual-v1` prompts). CI and the local
fan-out both call the same module via one runner:

```bash
# Deterministic lane only (fast, no LLM) — the CI PR gate:
python3 evaluation/scripts/run-baseline-audit.py --skills all --no-judge

# Both lanes (qualitative screenshot judge, 3-judge median panel):
python3 evaluation/scripts/run-baseline-audit.py --skills all --adapter opencode --judge-model auto --n-judges 3

# Same qualitative lane through Codex CLI:
python3 evaluation/scripts/run-baseline-audit.py --skills all --adapter codex --judge-model auto --n-judges 3

# Build the audit dashboard from a combined scorecard, then serve from repo root:
python3 evaluation/scripts/build-audit-ui.py evaluation/artifacts/audits/<run_id>/scorecard.json \
  --output evaluation/artifacts/review-ui/audit.html
```

The qualitative lane needs rendered baselines under `optimization/runs/<skill>/baseline`
(gitignored). Local fan-out helpers can run the same judge module across all
baselines concurrently; CI
(`.github/workflows/baseline-audit.yml`) runs the deterministic lane as a blocking
PR gate and the qualitative lane nightly (rendering baselines first).

## Local Validation

```bash
python3 evaluation/scripts/validate-evaluation.py
python3 evaluation/scripts/run-scorecard.py
python3 evaluation/scripts/run-baseline-audit.py --skills all --no-judge
pytest -q evaluation/tests
```

The current runner core accepts a case and a captured before/after evidence
bundle:

```bash
python3 -m evaluation.runner evaluation/cases/cesiumjs-entities/eval-001-translate-marker-east-6m.json --evidence evaluation/fixtures/cesiumjs-entities/eval-001-pass.evidence.json
```

The browser capture layer is deliberately separate from the pure runner. It
produces a scene-state evidence bundle and then calls `evaluation.runner.run_case`
when `--run-checks` is supplied.

The first browser-capture CLI is:

```bash
python3 evaluation/scripts/capture-scene-state.py evaluation/cases/cesiumjs-entities/eval-001-translate-marker-east-6m.json --candidate-js path/to/candidate.js --run-checks
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
python3 evaluation/scripts/run-scorecard.py \
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

For local review, generate the static scorecard UI from any scorecard JSON:

```bash
python3 evaluation/scripts/run-scorecard.py --fixture-expectation fail --visual-review evaluation/artifacts/review-ui/sample-scorecard/visual-review.json --output-dir evaluation/artifacts/review-ui/sample-scorecard
python3 optimization/scripts/scorecard-focus.py evaluation/artifacts/review-ui/sample-scorecard/scorecard.json --output evaluation/artifacts/review-ui/sample-scorecard/focus.json
python3 evaluation/scripts/build-review-ui.py evaluation/artifacts/review-ui/sample-scorecard/scorecard.json --focus evaluation/artifacts/review-ui/sample-scorecard/focus.json --output evaluation/artifacts/review-ui/index.html
```

The generated UI is local-only and ignored with the rest of
`evaluation/artifacts/`.

From the same scorecard, the local optimization launcher can be dry-run with:

```bash
python3 optimization/scripts/run-all-evals.py --from-scorecard evaluation/artifacts/review-ui/sample-scorecard/scorecard.json --max-iterations 1 --stop-on regression --dry-run
```
