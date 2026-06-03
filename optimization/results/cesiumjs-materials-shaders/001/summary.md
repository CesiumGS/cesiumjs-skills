# Evaluation Report: cesiumjs-materials-shaders - Iteration 001

**Generated:** 2026-05-26 21:12:29 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_3_more_wins
- **Rationale:** KEEP: Candidate won 3 scenarios vs 0 baseline wins

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 75.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 3
- Losses: 0
- Ties: 1

## Per-Scenario Results

### eval-001: bloom-night-overlay-tokyo

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses bloom stage factory
- ✓ pattern_present: Adds stage to scene postProcessStages
- ✓ pattern_present: Uses public GIBS night imagery
- ✓ pattern_present: Uses URL-backed imagery layer
- ✓ pattern_present: Targets Tokyo latitude
- ✓ pattern_present: Targets Tokyo longitude
- ✓ pattern_absent: Avoids ion imagery helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-materials-shaders/001/eval-001-bloom-night-overlay-tokyo/screenshot*.png`
- Console log: `evals/runs/cesiumjs-materials-shaders/001/eval-001-bloom-night-overlay-tokyo/console.json`
- Metadata: `evals/runs/cesiumjs-materials-shaders/001/eval-001-bloom-night-overlay-tokyo/metadata.json`

---

### eval-002: checkerboard-material-polygon-utah

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Checkerboard material/property
- ✓ pattern_present: Sets even/odd colors
- ✓ pattern_present: Uses NAVY for one color
- ✓ pattern_present: Uses WHITE for other color
- ✓ pattern_present: Uses polygon graphics
- ✓ pattern_present: Sets repeat for cell count
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-materials-shaders/001/eval-002-checkerboard-material-polygon-utah/screenshot*.png`
- Console log: `evals/runs/cesiumjs-materials-shaders/001/eval-002-checkerboard-material-polygon-utah/console.json`
- Metadata: `evals/runs/cesiumjs-materials-shaders/001/eval-002-checkerboard-material-polygon-utah/metadata.json`

---

### eval-003: fxaa-silhouette-public-tileset

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Uses edge-detection stage factory
- ✓ pattern_present: Uses silhouette composite factory
- ✓ pattern_present: Sets edge uniform color
- ✓ pattern_present: Uses YELLOW for silhouette
- ✓ pattern_present: Adds composite to postProcessStages
- ✓ pattern_absent: Avoids entitlement-backed OSM Buildings
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-materials-shaders/001/eval-003-fxaa-silhouette-public-tileset/screenshot*.png`
- Console log: `evals/runs/cesiumjs-materials-shaders/001/eval-003-fxaa-silhouette-public-tileset/console.json`
- Metadata: `evals/runs/cesiumjs-materials-shaders/001/eval-003-fxaa-silhouette-public-tileset/metadata.json`

---

### eval-004: water-material-polygon-mediterranean

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Fabric Water material
- ✓ pattern_present: Configures water colour parameters
- ✓ pattern_present: Sets animation speed
- ✓ pattern_present: Sets wave amplitude
- ✓ pattern_present: Uses polygon primitive geometry
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-materials-shaders/001/eval-004-water-material-polygon-mediterranean/screenshot*.png`
- Console log: `evals/runs/cesiumjs-materials-shaders/001/eval-004-water-material-polygon-mediterranean/console.json`
- Metadata: `evals/runs/cesiumjs-materials-shaders/001/eval-004-water-material-polygon-mediterranean/metadata.json`

---
