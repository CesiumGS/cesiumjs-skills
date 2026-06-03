# Evaluation Report: cesiumjs-viewer-setup - Iteration 001

**Generated:** 2026-05-26 21:18:19 UTC

## Decision

- **Result:** REJECT
- **Rule:** rule_2_critical_judge_loss
- **Rationale:** REJECT: Judge loss on regression-critical scenario eval-003

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 14.3%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 0
- Losses: 1
- Ties: 2

## Per-Scenario Results

### eval-001: basic-public-globe

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors in the browser console
- ✓ code_runs: Code executes without throwing exceptions
- ✓ pattern_absent: Generated code does not hardcode or reset the Ion token
- ✓ pattern_present: Viewer constructor is called
- ✓ pattern_present: Public OSM base layer is configured
- ✓ pattern_absent: Ion-backed default terrain/imagery helpers are not used
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-001-basic-public-globe/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-001-basic-public-globe/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-001-basic-public-globe/metadata.json`

---

### eval-002: minimal-viewer-no-widgets

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors
- ✓ code_runs: Code executes without throwing
- ✓ pattern_absent: Generated code does not hardcode or reset the Ion token
- ✓ pattern_present: Animation widget disabled
- ✓ pattern_present: Timeline widget disabled
- ✓ pattern_present: Geocoder widget disabled
- ✓ pattern_present: Home button disabled
- ✓ pattern_present: Info box disabled
- ✓ pattern_present: Navigation help disabled
- ✓ pattern_absent: Does not explicitly enable baseLayerPicker (it would conflict with custom baseLayer if one is set)
- ✓ pattern_absent: Ion-backed default terrain/imagery helpers are not used
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-002-minimal-viewer-no-widgets/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-002-minimal-viewer-no-widgets/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-002-minimal-viewer-no-widgets/metadata.json`

---

### eval-003: production-viewer-public-tileset

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors
- ✓ code_runs: Code executes without throwing
- ✓ pattern_absent: Generated code does not hardcode or reset the Ion token
- ✓ pattern_present: Public URL-backed 3D Tiles factory is used
- ✓ pattern_present: Buildings tileset is added to scene
- ✓ pattern_present: Public CesiumGS sample tileset is used
- ✓ pattern_present: Public OSM base layer is configured
- ✓ pattern_present: Animation widget disabled as requested
- ✓ pattern_present: Timeline widget disabled as requested
- ✓ pattern_absent: Entitlement-backed assets are not used
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-003-production-viewer-public-tileset/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-003-production-viewer-public-tileset/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-003-production-viewer-public-tileset/metadata.json`

---

### eval-004: public-3d-tiles-viewer

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors
- ✓ code_runs: Code executes without throwing
- ✓ pattern_absent: Generated code does not hardcode or reset the Ion token
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public dragon tileset
- ✓ pattern_absent: Google/Ion entitlement-backed helpers are not used
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-004-public-3d-tiles-viewer/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-004-public-3d-tiles-viewer/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-004-public-3d-tiles-viewer/metadata.json`

---

### eval-005: 2d-map-with-osm-basemap

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors
- ✓ code_runs: Code executes without throwing
- ✓ pattern_present: 2D scene mode is configured
- ✓ pattern_present: OSM imagery provider is used
- ✓ pattern_present: Base layer picker disabled (required for custom base layer)
- ✓ pattern_present: Custom base layer is provided in constructor
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-005-2d-map-with-osm-basemap/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-005-2d-map-with-osm-basemap/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-005-2d-map-with-osm-basemap/metadata.json`

---

### eval-006: space-scene-no-globe

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors
- ✓ code_runs: Code executes without throwing
- ✓ pattern_present: Globe is disabled
- ✓ pattern_present: Atmosphere is disabled
- ✓ pattern_absent: No terrain configured (impossible without globe)
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-006-space-scene-no-globe/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-006-space-scene-no-globe/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-006-space-scene-no-globe/metadata.json`

---

### eval-007: low-power-dashboard-render-mode

**Programmatic Checks:**

- ✓ no_console_errors: No JavaScript errors
- ✓ code_runs: Code executes without throwing
- ✓ pattern_absent: Generated code does not hardcode or reset the Ion token
- ✓ pattern_present: Request render mode enabled
- ✓ pattern_present: Locked to 3D mode for GPU savings
- ✓ pattern_present: Entity is added
- ✓ pattern_present: Latitude for SF headquarters is correct
- ✓ pattern_present: Longitude for SF is negative (west)
- ✓ pattern_absent: Ion-backed default terrain/imagery helpers are not used
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-viewer-setup/001/eval-007-low-power-dashboard-render-mode/screenshot*.png`
- Console log: `evals/runs/cesiumjs-viewer-setup/001/eval-007-low-power-dashboard-render-mode/console.json`
- Metadata: `evals/runs/cesiumjs-viewer-setup/001/eval-007-low-power-dashboard-render-mode/metadata.json`

---
