# Evaluation Report: cesiumjs-3d-tiles - Iteration 001

**Generated:** 2026-05-26 21:09:32 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_3_more_wins
- **Rationale:** KEEP: Candidate won 2 scenarios vs 0 baseline wins

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 40.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 2
- Losses: 0
- Ties: 3

## Per-Scenario Results

### eval-001: public-discrete-lod-dragon

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Adds tileset to scene primitives
- ✓ pattern_present: Frames the tileset
- ✓ pattern_absent: Avoids private entitlement-backed assets
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-3d-tiles/001/eval-001-public-discrete-lod-dragon/screenshot*.png`
- Console log: `evals/runs/cesiumjs-3d-tiles/001/eval-001-public-discrete-lod-dragon/console.json`
- Metadata: `evals/runs/cesiumjs-3d-tiles/001/eval-001-public-discrete-lod-dragon/metadata.json`

---

### eval-002: public-tileset-height-style

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Uses Cesium3DTileStyle
- ✓ pattern_present: Style uses conditions array
- ✓ pattern_present: Style has a safe true catch-all
- ✓ pattern_absent: Does NOT use defined() (unsupported in tileset style DSL)
- ✓ pattern_present: Style assigns named colors
- ✓ pattern_absent: Avoids entitlement-backed OSM Buildings
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-3d-tiles/001/eval-002-public-tileset-height-style/screenshot*.png`
- Console log: `evals/runs/cesiumjs-3d-tiles/001/eval-002-public-tileset-height-style/console.json`
- Metadata: `evals/runs/cesiumjs-3d-tiles/001/eval-002-public-tileset-height-style/metadata.json`

---

### eval-003: public-tileset-clipping-plane

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Uses ClippingPlane API
- ✓ pattern_present: Sets edgeWidth on clipping
- ✓ pattern_present: Sets edgeColor on clipping
- ✓ pattern_absent: Avoids entitlement-backed OSM Buildings
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-3d-tiles/001/eval-003-public-tileset-clipping-plane/screenshot*.png`
- Console log: `evals/runs/cesiumjs-3d-tiles/001/eval-003-public-tileset-clipping-plane/console.json`
- Metadata: `evals/runs/cesiumjs-3d-tiles/001/eval-003-public-tileset-clipping-plane/metadata.json`

---

### eval-004: public-tileset-vivid-style

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Uses Cesium3DTileStyle
- ✓ pattern_present: Style produces explicit colors
- ✓ pattern_absent: Avoids entitlement-backed OSM Buildings
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-3d-tiles/001/eval-004-public-tileset-vivid-style/screenshot*.png`
- Console log: `evals/runs/cesiumjs-3d-tiles/001/eval-004-public-tileset-vivid-style/console.json`
- Metadata: `evals/runs/cesiumjs-3d-tiles/001/eval-004-public-tileset-vivid-style/metadata.json`

---

### eval-005: public-tileset-oblique-closeup

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Adds tileset to scene primitives
- ✓ pattern_present: Frames the tileset
- ✓ pattern_absent: Avoids private entitlement-backed assets
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-3d-tiles/001/eval-005-public-tileset-oblique-closeup/screenshot*.png`
- Console log: `evals/runs/cesiumjs-3d-tiles/001/eval-005-public-tileset-oblique-closeup/console.json`
- Metadata: `evals/runs/cesiumjs-3d-tiles/001/eval-005-public-tileset-oblique-closeup/metadata.json`

---
