# Evaluation Report: cesiumjs-models-particles - Iteration 001

**Generated:** 2026-05-26 21:23:41 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_5_tie_keep_current
- **Rationale:** KEEP: Tie (2 wins, 2 losses, 0 ties) - keeping current best

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 50.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 2
- Losses: 2
- Ties: 0

## Per-Scenario Results

### eval-001: aircraft-over-grand-canyon

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Model.fromGltfAsync
- ✓ pattern_present: Targets the CesiumAir sample model
- ✓ pattern_present: Sets minimumPixelSize
- ✓ pattern_present: Constructs modelMatrix from local frame
- ✓ pattern_present: Adds model to primitives
- ✓ pattern_present: Targets Grand Canyon south rim longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-models-particles/001/eval-001-aircraft-over-grand-canyon/screenshot*.png`
- Console log: `evals/runs/cesiumjs-models-particles/001/eval-001-aircraft-over-grand-canyon/console.json`
- Metadata: `evals/runs/cesiumjs-models-particles/001/eval-001-aircraft-over-grand-canyon/metadata.json`

---

### eval-002: particle-smoke-mount-st-helens

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Constructs ParticleSystem
- ✓ pattern_present: Sets emissionRate
- ✓ pattern_present: Uses an emitter type
- ✓ pattern_present: Uses local frame for modelMatrix
- ✓ pattern_present: Targets Mount St. Helens longitude
- ✓ pattern_present: Targets Mount St. Helens latitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-models-particles/001/eval-002-particle-smoke-mount-st-helens/screenshot*.png`
- Console log: `evals/runs/cesiumjs-models-particles/001/eval-002-particle-smoke-mount-st-helens/console.json`
- Metadata: `evals/runs/cesiumjs-models-particles/001/eval-002-particle-smoke-mount-st-helens/metadata.json`

---

### eval-003: animated-character-paris

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Model.fromGltfAsync
- ✓ pattern_present: Targets the CesiumMan sample model
- ✓ pattern_present: Activates all animations
- ✓ pattern_present: Uses ModelAnimationLoop enum
- ✓ pattern_present: Uses ENU frame
- ✓ pattern_present: Targets Paris latitude
- ✓ pattern_present: Waits for model readiness before animating
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-models-particles/001/eval-003-animated-character-paris/screenshot*.png`
- Console log: `evals/runs/cesiumjs-models-particles/001/eval-003-animated-character-paris/console.json`
- Metadata: `evals/runs/cesiumjs-models-particles/001/eval-003-animated-character-paris/metadata.json`

---

### eval-004: fountain-particles-bellagio

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Constructs ParticleSystem
- ✓ pattern_present: Uses ConeEmitter
- ✓ pattern_present: Sets startColor
- ✓ pattern_present: Sets endColor
- ✓ pattern_present: Sets emissionRate
- ✓ pattern_present: Targets Bellagio longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-models-particles/001/eval-004-fountain-particles-bellagio/screenshot*.png`
- Console log: `evals/runs/cesiumjs-models-particles/001/eval-004-fountain-particles-bellagio/console.json`
- Metadata: `evals/runs/cesiumjs-models-particles/001/eval-004-fountain-particles-bellagio/metadata.json`

---
