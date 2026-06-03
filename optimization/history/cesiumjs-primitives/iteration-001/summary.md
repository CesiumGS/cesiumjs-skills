# Evaluation Report: cesiumjs-primitives - Iteration 001

**Generated:** 2026-05-26 21:13:04 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_3_more_wins
- **Rationale:** KEEP: Candidate won 2 scenarios vs 1 baseline wins

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 50.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 2
- Losses: 1
- Ties: 1

## Per-Scenario Results

### eval-001: batched-cylinders-times-square

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Constructs a Primitive
- ✓ pattern_present: Creates GeometryInstance objects
- ✓ pattern_present: Uses CylinderGeometry
- ✓ pattern_present: Uses PerInstanceColorAppearance
- ✓ pattern_present: Uses per-instance color attribute
- ✓ pattern_present: Adds primitive to scene
- ✓ pattern_present: Uses ENU frame
- ✓ pattern_present: Targets Times Square longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-primitives/001/eval-001-batched-cylinders-times-square/screenshot*.png`
- Console log: `evals/runs/cesiumjs-primitives/001/eval-001-batched-cylinders-times-square/console.json`
- Metadata: `evals/runs/cesiumjs-primitives/001/eval-001-batched-cylinders-times-square/metadata.json`

---

### eval-002: billboard-collection-east-coast-cities

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses BillboardCollection (not entity API)
- ✓ pattern_present: Adds collection to scene
- ✓ pattern_present: Uses PinBuilder factory
- ✓ pattern_present: Uses PinBuilder for marker images
- ✓ pattern_present: Pins anchored at bottom
- ✓ pattern_present: Uses Cartesian3.fromDegrees
- ✓ pattern_absent: Does NOT use entity API (must use BillboardCollection)
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-primitives/001/eval-002-billboard-collection-east-coast-cities/screenshot*.png`
- Console log: `evals/runs/cesiumjs-primitives/001/eval-002-billboard-collection-east-coast-cities/console.json`
- Metadata: `evals/runs/cesiumjs-primitives/001/eval-002-billboard-collection-east-coast-cities/metadata.json`

---

### eval-003: ground-primitive-state-polygon

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses GroundPrimitive
- ✓ pattern_present: Uses PolygonGeometry
- ✓ pattern_present: Specifies polygonHierarchy
- ✓ pattern_present: Uses per-instance color
- ✓ pattern_present: Uses PerInstanceColorAppearance
- ✓ pattern_present: Uses ROYALBLUE
- ✓ pattern_absent: Avoids ion terrain
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-primitives/001/eval-003-ground-primitive-state-polygon/screenshot*.png`
- Console log: `evals/runs/cesiumjs-primitives/001/eval-003-ground-primitive-state-polygon/console.json`
- Metadata: `evals/runs/cesiumjs-primitives/001/eval-003-ground-primitive-state-polygon/metadata.json`

---

### eval-004: ground-polyline-route-66

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses GroundPolylineGeometry
- ✓ pattern_present: Uses GroundPolylinePrimitive
- ✓ pattern_present: Uses PolylineColorAppearance
- ✓ pattern_present: Uses per-instance color
- ✓ pattern_present: Uses RED
- ✓ pattern_present: Uses fromDegreesArray for waypoints
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-primitives/001/eval-004-ground-polyline-route-66/screenshot*.png`
- Console log: `evals/runs/cesiumjs-primitives/001/eval-004-ground-polyline-route-66/console.json`
- Metadata: `evals/runs/cesiumjs-primitives/001/eval-004-ground-polyline-route-66/metadata.json`

---
