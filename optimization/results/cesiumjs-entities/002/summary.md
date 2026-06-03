# Evaluation Report: cesiumjs-entities - Iteration 002

**Generated:** 2026-05-27 20:52:04 UTC

## Decision

- **Result:** REJECT
- **Rule:** rule_2_critical_judge_loss
- **Rationale:** REJECT: Judge loss on regression-critical scenario eval-001

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 60.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 0
- Losses: 1
- Ties: 0

## Per-Scenario Results

### eval-001: multiple-points-with-labels

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses entities.add
- ✓ pattern_present: Point graphics defined
- ✓ pattern_present: Label graphics defined
- ✓ pattern_present: Statue of Liberty longitude (negative)
- ✓ pattern_present: Sydney latitude (negative for south)
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `optimization/runs/cesiumjs-entities/002/eval-001-multiple-points-with-labels/screenshot*.png`
- Console log: `optimization/runs/cesiumjs-entities/002/eval-001-multiple-points-with-labels/console.json`
- Metadata: `optimization/runs/cesiumjs-entities/002/eval-001-multiple-points-with-labels/metadata.json`

---

### eval-002: polygon-with-extrusion

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Polygon graphics defined
- ✓ pattern_present: Polygon is extruded
- ✓ pattern_present: Semi-transparency applied
- ✓ pattern_present: Colorado longitudes are negative
- ✓ pattern_present: Uses fromDegreesArray for coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `optimization/runs/cesiumjs-entities/002/eval-002-polygon-with-extrusion/screenshot*.png`
- Console log: `optimization/runs/cesiumjs-entities/002/eval-002-polygon-with-extrusion/console.json`
- Metadata: `optimization/runs/cesiumjs-entities/002/eval-002-polygon-with-extrusion/metadata.json`

---

### eval-003: geojson-data-source

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses GeoJsonDataSource
- ✓ pattern_present: Adds to dataSources
- ✓ pattern_present: Loads the correct URL
- ✓ pattern_present: Styles the polygons
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `optimization/runs/cesiumjs-entities/002/eval-003-geojson-data-source/screenshot*.png`
- Console log: `optimization/runs/cesiumjs-entities/002/eval-003-geojson-data-source/console.json`
- Metadata: `optimization/runs/cesiumjs-entities/002/eval-003-geojson-data-source/metadata.json`

---

### eval-004: ground-clamped-polyline-route

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Polyline graphics defined
- ✓ pattern_present: Clamped to ground
- ✓ pattern_present: LA longitude
- ✓ pattern_present: NYC longitude
- ✓ pattern_present: City labels present
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `optimization/runs/cesiumjs-entities/002/eval-004-ground-clamped-polyline-route/screenshot*.png`
- Console log: `optimization/runs/cesiumjs-entities/002/eval-004-ground-clamped-polyline-route/console.json`
- Metadata: `optimization/runs/cesiumjs-entities/002/eval-004-ground-clamped-polyline-route/metadata.json`

---

### eval-005: entity-collection-query-and-modify

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Queries entities by ID
- ✓ pattern_present: Hides an entity
- ✓ pattern_present: Removes an entity
- ✓ pattern_present: JFK color changed to magenta
- ✓ pattern_present: JFK ID used
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `optimization/runs/cesiumjs-entities/002/eval-005-entity-collection-query-and-modify/screenshot*.png`
- Console log: `optimization/runs/cesiumjs-entities/002/eval-005-entity-collection-query-and-modify/console.json`
- Metadata: `optimization/runs/cesiumjs-entities/002/eval-005-entity-collection-query-and-modify/metadata.json`

---
