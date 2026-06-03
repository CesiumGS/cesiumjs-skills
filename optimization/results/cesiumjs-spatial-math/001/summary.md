# Evaluation Report: cesiumjs-spatial-math - Iteration 001

**Generated:** 2026-05-26 21:11:31 UTC

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

### eval-001: geodesic-nyc-paris

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses EllipsoidGeodesic
- ✓ pattern_present: Reads surfaceDistance
- ✓ pattern_present: Samples intermediate points
- ✓ pattern_present: Uses Cartographic
- ✓ pattern_present: Adds a polyline entity
- ✓ pattern_present: Adds a label entity
- ✓ pattern_present: References NYC coordinates
- ✓ pattern_present: References Paris coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-spatial-math/001/eval-001-geodesic-nyc-paris/screenshot*.png`
- Console log: `evals/runs/cesiumjs-spatial-math/001/eval-001-geodesic-nyc-paris/console.json`
- Metadata: `evals/runs/cesiumjs-spatial-math/001/eval-001-geodesic-nyc-paris/metadata.json`

---

### eval-002: fromdegrees-capitals-grid

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses fromDegreesArray batch helper
- ✓ pattern_present: Uses PointPrimitiveCollection
- ✓ pattern_present: Adds collection to scene
- ✓ pattern_present: Uses LIME color
- ✓ pattern_present: Sets outlineColor on point primitives
- ✓ pattern_present: Configures point appearance
- ✓ pattern_present: References Washington DC longitude
- ✓ pattern_present: References Tokyo longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-spatial-math/001/eval-002-fromdegrees-capitals-grid/screenshot*.png`
- Console log: `evals/runs/cesiumjs-spatial-math/001/eval-002-fromdegrees-capitals-grid/console.json`
- Metadata: `evals/runs/cesiumjs-spatial-math/001/eval-002-fromdegrees-capitals-grid/metadata.json`

---

### eval-003: quaternion-heading-marker

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Model.fromGltfAsync
- ✓ pattern_present: Builds quaternion from axis-angle
- ✓ pattern_present: Converts quaternion to Matrix3
- ✓ pattern_present: Composes matrices with Matrix4.multiply
- ✓ pattern_present: Uses ENU local frame
- ✓ pattern_present: Converts degrees to radians
- ✓ pattern_present: Uses UNIT_Z axis
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-spatial-math/001/eval-003-quaternion-heading-marker/screenshot*.png`
- Console log: `evals/runs/cesiumjs-spatial-math/001/eval-003-quaternion-heading-marker/console.json`
- Metadata: `evals/runs/cesiumjs-spatial-math/001/eval-003-quaternion-heading-marker/metadata.json`

---

### eval-004: boundingsphere-viz

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses BoundingSphere.fromPoints
- ✓ pattern_present: Uses ellipsoid graphics
- ✓ pattern_present: Uses YELLOW for sphere material
- ✓ pattern_present: Builds Cartesian3 positions from degrees
- ✓ pattern_present: References LA longitude
- ✓ pattern_present: References Denver longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-spatial-math/001/eval-004-boundingsphere-viz/screenshot*.png`
- Console log: `evals/runs/cesiumjs-spatial-math/001/eval-004-boundingsphere-viz/console.json`
- Metadata: `evals/runs/cesiumjs-spatial-math/001/eval-004-boundingsphere-viz/metadata.json`

---
