# Evaluation Report: cesiumjs-interaction - Iteration 003

**Generated:** 2026-05-26 21:11:17 UTC

## Decision

- **Result:** REJECT
- **Rule:** rule_4_more_losses
- **Rationale:** REJECT: Baseline won 2 scenarios vs 0 candidate wins

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 0.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 0
- Losses: 2
- Ties: 3

## Per-Scenario Results

### eval-001: click-logger-three-pins

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Constructs handler
- ✓ pattern_present: Uses LEFT_CLICK event type
- ✓ pattern_present: Registers an input action
- ✓ pattern_present: Picks the scene in the callback
- ✓ pattern_present: References Seattle
- ✓ pattern_present: References Los Angeles
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-interaction/003/eval-001-click-logger-three-pins/screenshot*.png`
- Console log: `evals/runs/cesiumjs-interaction/003/eval-001-click-logger-three-pins/console.json`
- Metadata: `evals/runs/cesiumjs-interaction/003/eval-001-click-logger-three-pins/metadata.json`

---

### eval-002: mouse-coord-readout-label

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Constructs handler
- ✓ pattern_present: Uses MOUSE_MOVE event type
- ✓ pattern_present: Uses camera.pickEllipsoid
- ✓ pattern_present: Converts to cartographic
- ✓ pattern_present: Converts radians to degrees
- ✓ pattern_present: Label has showBackground
- ✓ pattern_present: Uses label graphics
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-interaction/003/eval-002-mouse-coord-readout-label/screenshot*.png`
- Console log: `evals/runs/cesiumjs-interaction/003/eval-002-mouse-coord-readout-label/console.json`
- Metadata: `evals/runs/cesiumjs-interaction/003/eval-002-mouse-coord-readout-label/metadata.json`

---

### eval-003: hover-highlight-three-polygons

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Constructs handler
- ✓ pattern_present: Uses MOUSE_MOVE
- ✓ pattern_present: Uses scene.pick in handler
- ✓ pattern_present: Highlights with Color.YELLOW
- ✓ pattern_present: Uses DODGERBLUE for first polygon
- ✓ pattern_present: Uses LIMEGREEN for second polygon
- ✓ pattern_present: Uses CRIMSON for third polygon
- ✓ pattern_present: Uses polygon graphics
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-interaction/003/eval-003-hover-highlight-three-polygons/screenshot*.png`
- Console log: `evals/runs/cesiumjs-interaction/003/eval-003-hover-highlight-three-polygons/console.json`
- Metadata: `evals/runs/cesiumjs-interaction/003/eval-003-hover-highlight-three-polygons/metadata.json`

---

### eval-004: drillpick-stacked-polygons

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses scene.drillPick
- ✓ pattern_present: Constructs handler
- ✓ pattern_present: Uses LEFT_CLICK
- ✓ pattern_present: Uses CRIMSON
- ✓ pattern_present: Uses DODGERBLUE
- ✓ pattern_present: Uses LIMEGREEN
- ✓ pattern_present: Polygons are semi-transparent
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-interaction/003/eval-004-drillpick-stacked-polygons/screenshot*.png`
- Console log: `evals/runs/cesiumjs-interaction/003/eval-004-drillpick-stacked-polygons/console.json`
- Metadata: `evals/runs/cesiumjs-interaction/003/eval-004-drillpick-stacked-polygons/metadata.json`

---

### eval-005: silhouette-postprocess-three-boxes

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses edge-detection stage factory
- ✓ pattern_present: Uses silhouette composite factory
- ✓ pattern_present: Assigns to a .selected array
- ✓ pattern_present: Uses YELLOW
- ✓ pattern_present: Uses CYAN
- ✓ pattern_present: Uses MAGENTA
- ✓ pattern_present: Uses box graphics
- ✓ pattern_present: Targets Hawaii longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-interaction/003/eval-005-silhouette-postprocess-three-boxes/screenshot*.png`
- Console log: `evals/runs/cesiumjs-interaction/003/eval-005-silhouette-postprocess-three-boxes/console.json`
- Metadata: `evals/runs/cesiumjs-interaction/003/eval-005-silhouette-postprocess-three-boxes/metadata.json`

---
