# Evaluation Report: cesiumjs-core-utilities - Iteration 001

**Generated:** 2026-05-26 21:08:06 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_5_tie_keep_current
- **Rationale:** KEEP: Tie (0 wins, 0 losses, 4 ties) - keeping current best

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 0.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 0
- Losses: 0
- Ties: 4

## Per-Scenario Results

### eval-001: color-grid-landmarks

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Color.RED constant
- ✓ pattern_present: Uses Color.fromCssColorString
- ✓ pattern_present: Uses Color.fromBytes
- ✓ pattern_present: Uses Color.fromHsl
- ✓ pattern_present: Uses Color.YELLOW constant
- ✓ pattern_present: Sets pixelSize on point graphics
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-core-utilities/001/eval-001-color-grid-landmarks/screenshot*.png`
- Console log: `evals/runs/cesiumjs-core-utilities/001/eval-001-color-grid-landmarks/console.json`
- Metadata: `evals/runs/cesiumjs-core-utilities/001/eval-001-color-grid-landmarks/metadata.json`

---

### eval-002: resource-fetch-geojson-airports

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Resource.fetchJson static method
- ✓ pattern_present: Inline GeoJSON has FeatureCollection type
- ✓ pattern_present: Uses Color.ORANGE for markers
- ✓ pattern_present: Adds entities
- ✓ pattern_present: References at least one of the three airport coordinates or codes
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-core-utilities/001/eval-002-resource-fetch-geojson-airports/screenshot*.png`
- Console log: `evals/runs/cesiumjs-core-utilities/001/eval-002-resource-fetch-geojson-airports/console.json`
- Metadata: `evals/runs/cesiumjs-core-utilities/001/eval-002-resource-fetch-geojson-airports/metadata.json`

---

### eval-003: pinbuilder-numbered-stops

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Instantiates PinBuilder
- ✓ pattern_present: Uses PinBuilder.fromText
- ✓ pattern_present: Uses Color.ROYALBLUE constant
- ✓ pattern_present: Uses Color.FORESTGREEN constant
- ✓ pattern_present: Uses Color.CRIMSON constant
- ✓ pattern_present: Uses VerticalOrigin.BOTTOM
- ✓ pattern_present: Uses billboard graphics
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-core-utilities/001/eval-003-pinbuilder-numbered-stops/screenshot*.png`
- Console log: `evals/runs/cesiumjs-core-utilities/001/eval-003-pinbuilder-numbered-stops/console.json`
- Metadata: `evals/runs/cesiumjs-core-utilities/001/eval-003-pinbuilder-numbered-stops/metadata.json`

---

### eval-004: event-helper-tick-counter

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses EventHelper
- ✓ pattern_present: Uses helper.add to subscribe
- ✓ pattern_present: Subscribes to clock.onTick
- ✓ pattern_present: Enables clock animation
- ✓ pattern_present: Uses label graphics
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-core-utilities/001/eval-004-event-helper-tick-counter/screenshot*.png`
- Console log: `evals/runs/cesiumjs-core-utilities/001/eval-004-event-helper-tick-counter/console.json`
- Metadata: `evals/runs/cesiumjs-core-utilities/001/eval-004-event-helper-tick-counter/metadata.json`

---
