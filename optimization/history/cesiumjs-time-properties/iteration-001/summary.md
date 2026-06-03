# Evaluation Report: cesiumjs-time-properties - Iteration 001

**Generated:** 2026-05-26 21:14:56 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_3_more_wins
- **Rationale:** KEEP: Candidate won 1 scenarios vs 0 baseline wins

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 25.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 1
- Losses: 0
- Ties: 3

## Per-Scenario Results

### eval-001: sampled-flight-jfk-lax

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses SampledPositionProperty
- ✓ pattern_present: Adds samples to the property
- ✓ pattern_present: Uses ISO time
- ✓ pattern_present: Advances JulianDate
- ✓ pattern_present: Configures viewer clock
- ✓ pattern_present: Entity has path graphic
- ✓ pattern_present: Path has leadTime or trailTime
- ✓ pattern_present: References LAX coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-time-properties/001/eval-001-sampled-flight-jfk-lax/screenshot*.png`
- Console log: `evals/runs/cesiumjs-time-properties/001/eval-001-sampled-flight-jfk-lax/console.json`
- Metadata: `evals/runs/cesiumjs-time-properties/001/eval-001-sampled-flight-jfk-lax/metadata.json`

---

### eval-002: callback-color-cycle-london

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses CallbackProperty
- ✓ pattern_present: Uses ColorMaterialProperty
- ✓ pattern_present: Cycles hue via Color.fromHsl
- ✓ pattern_present: Reads elapsed seconds
- ✓ pattern_present: Animates the clock
- ✓ pattern_present: Polygon entity
- ✓ pattern_present: Targets London latitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-time-properties/001/eval-002-callback-color-cycle-london/screenshot*.png`
- Console log: `evals/runs/cesiumjs-time-properties/001/eval-002-callback-color-cycle-london/console.json`
- Metadata: `evals/runs/cesiumjs-time-properties/001/eval-002-callback-color-cycle-london/metadata.json`

---

### eval-003: clock-flythrough-sydney

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses ISO clock time
- ✓ pattern_present: Advances JulianDate
- ✓ pattern_present: Computes interval fraction
- ✓ pattern_present: Registers a clock tick listener
- ✓ pattern_present: Interpolates camera destination
- ✓ pattern_present: Calls camera.setView
- ✓ pattern_present: Targets Sydney longitude
- ✓ pattern_present: Targets Sydney latitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-time-properties/001/eval-003-clock-flythrough-sydney/screenshot*.png`
- Console log: `evals/runs/cesiumjs-time-properties/001/eval-003-clock-flythrough-sydney/console.json`
- Metadata: `evals/runs/cesiumjs-time-properties/001/eval-003-clock-flythrough-sydney/metadata.json`

---

### eval-004: czml-satellite-orbit

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses CzmlDataSource
- ✓ pattern_present: Uses cartographicDegrees position samples
- ✓ pattern_present: CZML defines clock or interval
- ✓ pattern_present: Path has leadTime/trailTime
- ✓ pattern_present: Adds to dataSources
- ✓ pattern_present: Animates the clock
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-time-properties/001/eval-004-czml-satellite-orbit/screenshot*.png`
- Console log: `evals/runs/cesiumjs-time-properties/001/eval-004-czml-satellite-orbit/console.json`
- Metadata: `evals/runs/cesiumjs-time-properties/001/eval-004-czml-satellite-orbit/metadata.json`

---
