# Deterministic Evaluation Plan

> Note: this implementation plan was initially drafted from early review
> feedback. The authoritative requirements source is now
> `evaluation/docs/prd-deterministic-scorecard-evaluation.md`. Treat this file
> as implementation guidance under that PRD, not as the product requirements
> source.

## Background

Review feedback on the eval/optimization prototype highlighted two needs:
deterministic, unit-test-like checks to complement visual judging, and a
refactored eval harness that is CI/CD-suitable, with synthetic data for more
test cases.

A representative deterministic case is the "translate six units" example: issue
a precise spatial instruction, capture scene state, and assert the numeric delta
directly. It is treated here as the canonical deterministic case shape.

## Requirements

1. Evaluation must be separate from self-optimization.
2. Evaluation must be deterministic by default, with synthetic cases whose
   expected scene state is known before a model or candidate runs.
3. Unit-test-like checks must verify observable Cesium scene state, not source
   text, generated rationale, or subjective judge output.
4. Optimization may consume evaluation results later, but evaluation must not
   propose candidates, update skills, judge baseline-vs-candidate promotion, or
   mutate optimization history.
5. The framework must be demoable: a reviewer should be able to open a case,
   see the prompt, inspect the expected evidence contract, run the deterministic
   checks, and understand why a pass or fail happened.
6. Qualitative visual review must be part of the scorecard model for cases
   where rendered appearance matters, while remaining separate from
   deterministic numeric correctness and optimization promotion judges.
7. The top-level repository must keep the product visible: `skills/` is the
   product; `evaluation/` and `optimization/` contain their own scripts, tests,
   docs, schemas, and artifacts.

## Final Architecture

- `evaluation/`
  - `cases/`: deterministic case manifests.
  - `fixtures/`: tracked synthetic evidence bundles for contract tests.
  - `schemas/`: case, check, evidence, and result JSON schemas.
  - `framework/`: pure check registry and matchers.
  - `runner.py`: pure case+evidence executor.
  - `scripts/`: validation and future capture CLIs.
  - `tests/`: unit tests for matchers, fixtures, schemas, and CLI behavior.
  - `artifacts/`: ignored local captured evidence and result bundles.
  - `scorecard.py`: aggregate deterministic checks and optional qualitative
    visual review into one read-only scorecard artifact.
- `optimization/`
  - Owns candidate generation, baseline/candidate comparisons, visual judges,
    decisions, dashboards, result history, and self-improvement loops.
  - May later call `evaluation.runner.run_case`, but evaluation must not import
    optimization modules.

## Core Contract

The evaluation runner receives two inputs:

1. A case manifest:
   - prompt
   - fixture/preflight setup
   - probe fields to capture
   - deterministic checks
   - timeout and metadata
2. An evidence bundle:
   - before scene-state snapshot
   - after scene-state snapshot
   - entity IDs, ECEF positions, cartographic positions, and other structured
     values required by the checks

The runner emits a result bundle:

- case id, name, skill
- pass/fail
- per-check pass/fail, actual value, expected value, detail, metadata
- error field only for malformed cases/evidence or framework exceptions

Probe declarations are part of the contract, not loose documentation. A case
must list the normalized scene fields it expects the capture layer to produce,
and validation fails when a generic JSON Pointer check reads a path that is not
covered by `probe.capture`. This keeps future browser capture work aligned with
the deterministic checks instead of silently relying on ad hoc evidence shape.

## Implementation Phases

1. Contract hardening:
   - Add evidence and result schemas.
   - Add tracked synthetic evidence fixtures for the six-meter translation case.
  - Validate cases and fixtures with `cesium-eval validate --suite evaluation`.
   - Test runner output against the result schema.
2. Check catalog:
   - Keep `entity_translation_delta` as the first numeric scene-state matcher.
   - Add small generic matchers only when they unlock concrete cases:
     `entity_exists`, `json_value_equals`, `json_value_compare`,
     `collection_count`, `artifact_text_absent`, camera pose tolerance,
     primitive count, imagery layer count, and clock interval/state checks.
   - Use the stable scorecard categories `execution_health`,
     `semantic_scene_state`, `camera_framing`, `visual_fidelity`,
     `asset_and_provider_safety`, `interaction_behavior`, `time_behavior`,
     `source_contract`, `artifact_hygiene`, and `public_reproducibility`.
3. Browser capture:
   - Build a deterministic capture CLI that opens a minimal Cesium page, applies
     fixture setup, runs candidate JavaScript, captures before/after evidence,
     and then calls the pure runner.
   - Store raw evidence under `evaluation/artifacts/` by default.
   - Never write tokens, local URLs, raw HTML, or local tracebacks to tracked
     fixtures.
4. CI integration:
   - Run schema validation and unit tests on every PR.
   - Run browser capture for a small deterministic smoke set when tokens and
     browser dependencies are available.
   - Attach qualitative visual review artifacts when render output matters,
     without invoking the optimizer or promotion judges.
5. Migration and expansion:
   - Convert only optimization scenarios that have deterministic expected
     outcomes into evaluation cases.
   - Convert subjective render findings into scorecard visual-review entries
     when they describe user-visible quality that cannot be reduced to a stable
     deterministic probe yet.
   - Score qualitative render findings with explicit visual dimensions:
     `nonblank_render`, `target_visible`, `framing`, `occlusion`, `clutter`,
     and `prompt_match`. These remain visual-review data, not deterministic
     check results.

## Adversarial Review Pass 1

Critique: The first plan could become another broad eval framework without
forcing enough concrete contracts. "Synthetic data" is easy to say but hard to
review unless there are tracked pass/fail fixtures and schemas.

Revision:

- Require tracked synthetic evidence fixtures for every new matcher.
- Require schema validation for cases, evidence, and result bundles.
- Require a negative fixture or negative unit test for every numeric matcher.
- Treat a case as incomplete until a reviewer can run it without a browser
  using a tracked fixture.

## Adversarial Review Pass 2

Critique: The plan still risks coupling evaluation back into optimization if
the capture or runner imports optimization code for convenience.

Revision:

- `evaluation/` must not import from `optimization/`.
- The canonical guard must keep top-level eval scripts out of `scripts/` and
  inside `evaluation/scripts/` or `optimization/scripts/`.
- Any optimization integration must call the public evaluation API from
  outside-in; evaluation remains pure and unaware of candidates, judges, or
  current-best state.

## Adversarial Review Pass 3

Critique: Deterministic checks can be gamed or made brittle. A source-text regex
could pass without changing the scene, while strict geospatial checks can fail
from harmless numeric noise.

Revision:

- Checks must operate on captured scene state, not generated source code.
- Numeric checks must declare units, axis frame, and tolerance.
- The first spatial contract uses local east/north/up meters, not ambiguous
  raw XYZ coordinates.
- The result detail must expose actual and expected values so a reviewer can
  diagnose failures without reading the runner code.

## Hardened Acceptance Criteria

- `node packages/eval/bin/cesium-eval.js validate --suite evaluation` validates all cases and
  tracked fixtures.
- `npm test --workspace @cesiumjs-skills/eval` passes and includes both positive and negative
  synthetic evidence tests.
- `node packages/eval/bin/cesium-eval.js case <case> --evidence <fixture>` produces a result
  matching `evaluation/schemas/result.schema.json`.
- `node packages/eval/bin/cesium-eval.js score --visual-review <review.json>`
  emits first-class `visual_summary` and per-case `visual_review` data.
- `node packages/eval/bin/cesium-eval.js check canonical-surface` fails if
  active eval scripts reappear under top-level `scripts/`.
- No tracked evaluation file contains local paths, localhost URLs, tokens, or
  private tracebacks.
