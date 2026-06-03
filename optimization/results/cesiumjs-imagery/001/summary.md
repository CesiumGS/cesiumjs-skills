# Evaluation Report: cesiumjs-imagery - Iteration 001

**Generated:** 2026-05-26 21:45:18 UTC

## Decision

- **Result:** REJECT
- **Rule:** rule_4_more_losses
- **Rationale:** REJECT: Baseline won 4 scenarios vs 3 candidate wins

## Score Summary

- **Programmatic Correctness:** 86.7%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 20.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 3
- Losses: 4
- Ties: 8

## Per-Scenario Results

### eval-001: gibs-night-overlay-nyc

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses public NASA GIBS city-lights imagery
- ✓ pattern_present: Uses a public URL-backed imagery provider
- ✓ pattern_present: Sets overlay alpha below 1
- ✓ pattern_present: Adjusts brightness
- ✓ pattern_present: Targets NYC / Northeast corridor coordinates
- ✓ pattern_absent: Avoids ion imagery helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-001-gibs-night-overlay-nyc/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-001-gibs-night-overlay-nyc/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-001-gibs-night-overlay-nyc/metadata.json`

---

### eval-002: osm-base-layer-paris

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses OSM provider
- ✓ pattern_present: Avoids or replaces the default base layer
- ✓ pattern_present: Adds or configures OSM as the base layer
- ✓ pattern_present: Targets Paris coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-002-osm-base-layer-paris/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-002-osm-base-layer-paris/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-002-osm-base-layer-paris/metadata.json`

---

### eval-003: layer-management-grid-london

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses layer collection API
- ✓ pattern_present: Uses grid provider
- ✓ pattern_present: Uses tile coordinates provider
- ✓ pattern_present: Removes a layer
- ✓ pattern_present: Targets London coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-003-layer-management-grid-london/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-003-layer-management-grid-london/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-003-layer-management-grid-london/metadata.json`

---

### eval-004: usgs-hydro-wms-grand-canyon

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses WMS provider
- ✓ pattern_present: Uses public WMS endpoint
- ✓ pattern_present: Sets WMS layer id
- ✓ pattern_present: Targets Grand Canyon region
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-004-usgs-hydro-wms-grand-canyon/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-004-usgs-hydro-wms-grand-canyon/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-004-usgs-hydro-wms-grand-canyon/metadata.json`

---

### eval-005: usgs-shaded-relief-wmts-grand-canyon

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses WMTS provider
- ✓ pattern_present: Sets tileMatrixSetID
- ✓ pattern_present: Uses the working USGS WMTS tile matrix set
- ✓ pattern_present: Targets USGS WMTS service
- ✓ pattern_present: Targets Grand Canyon region
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-005-usgs-shaded-relief-wmts-grand-canyon/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-005-usgs-shaded-relief-wmts-grand-canyon/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-005-usgs-shaded-relief-wmts-grand-canyon/metadata.json`

---

### eval-006: split-screen-day-night-europe

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses split direction enum
- ✓ pattern_present: Sets splitDirection on layer
- ✓ pattern_present: Sets scene split position
- ✓ pattern_present: Uses public GIBS night imagery
- ✗ pattern_present: Targets Italy region
- ✓ pattern_absent: Avoids ion imagery helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-006-split-screen-day-night-europe/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-006-split-screen-day-night-europe/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-006-split-screen-day-night-europe/metadata.json`

---

### eval-007: cutout-rectangle-florida

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses cutout rectangle property
- ✓ pattern_present: Creates rectangle from degrees
- ✓ pattern_present: Uses public GIBS night imagery
- ✓ pattern_present: Targets Florida region
- ✓ pattern_absent: Avoids ion imagery helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-007-cutout-rectangle-florida/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-007-cutout-rectangle-florida/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-007-cutout-rectangle-florida/metadata.json`

---

### eval-008: color-to-alpha-japan

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses color-to-alpha
- ✓ pattern_present: Sets threshold
- ✓ pattern_present: Uses public GIBS night imagery
- ✓ pattern_present: Targets Japan region
- ✓ pattern_absent: Avoids ion imagery helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-008-color-to-alpha-japan/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-008-color-to-alpha-japan/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-008-color-to-alpha-japan/metadata.json`

---

### eval-009: arcgis-streets-dc

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses ArcGIS provider
- ✓ pattern_present: Uses ArcGIS World Street Map URL
- ✓ pattern_present: Targets DC coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-009-arcgis-streets-dc/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-009-arcgis-streets-dc/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-009-arcgis-streets-dc/metadata.json`

---

### eval-010: single-tile-alert-florida

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses single-tile provider
- ✓ pattern_present: Sets overlay rectangle
- ✓ pattern_present: Generates or uses in-memory image data
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-010-single-tile-alert-florida/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-010-single-tile-alert-florida/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-010-single-tile-alert-florida/metadata.json`

---

### eval-011: public-tileset-draped-imagery

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Loads a public URL-backed 3D tileset
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Drapes imagery on the tileset
- ✓ pattern_absent: Avoids entitlement-backed assets
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-011-public-tileset-draped-imagery/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-011-public-tileset-draped-imagery/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-011-public-tileset-draped-imagery/metadata.json`

---

### eval-012: time-dynamic-wmts-north-atlantic

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses time interval collection
- ✓ pattern_present: Connects provider to viewer clock
- ✓ pattern_present: Sets provider times
- ✓ pattern_present: Uses WMTS provider
- ✓ pattern_present: Uses a public GIBS WMTS layer
- ✓ pattern_absent: Avoids unavailable legacy layer name
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-012-time-dynamic-wmts-north-atlantic/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-012-time-dynamic-wmts-north-atlantic/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-012-time-dynamic-wmts-north-atlantic/metadata.json`

---

### eval-013: never-discard-policy-iceland

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses explicit tile discard policy
- ✓ pattern_present: Uses URL template provider
- ✗ pattern_present: Targets Iceland
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-013-never-discard-policy-iceland/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-013-never-discard-policy-iceland/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-013-never-discard-policy-iceland/metadata.json`

---

### eval-014: layer-error-events-london

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Wires errorEvent listeners
- ✓ pattern_present: Wires readyEvent listener
- ✓ pattern_present: Targets London coordinates
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-014-layer-error-events-london/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-014-layer-error-events-london/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-014-layer-error-events-london/metadata.json`

---

### eval-015: regional-provider-performance-hawaii

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL template imagery provider
- ✓ pattern_present: Sets tight rectangle bounds
- ✓ pattern_present: Uses imagery performance level limits
- ✓ pattern_present: Targets Hawaii region
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-imagery/001/eval-015-regional-provider-performance-hawaii/screenshot*.png`
- Console log: `evals/runs/cesiumjs-imagery/001/eval-015-regional-provider-performance-hawaii/console.json`
- Metadata: `evals/runs/cesiumjs-imagery/001/eval-015-regional-provider-performance-hawaii/metadata.json`

---
