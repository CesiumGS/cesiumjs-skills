# Evaluation Report: cesiumjs-custom-shader - Iteration 001

**Generated:** 2026-05-26 21:14:13 UTC

## Decision

- **Result:** KEEP
- **Rule:** rule_5_tie_keep_current
- **Rationale:** KEEP: Tie (1 wins, 1 losses, 2 ties) - keeping current best

## Score Summary

- **Programmatic Correctness:** 100.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 25.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 1
- Losses: 1
- Ties: 2

## Per-Scenario Results

### eval-001: tint-uniform-aircraft

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Model.fromGltfAsync
- ✓ pattern_present: Constructs CustomShader
- ✓ pattern_present: Declares VEC3 uniform type
- ✓ pattern_present: Defines the u_tint uniform name
- ✓ pattern_present: Defines fragmentMain function
- ✓ pattern_present: Writes to material.diffuse
- ✓ pattern_present: Uses ENU local frame for positioning
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-custom-shader/001/eval-001-tint-uniform-aircraft/screenshot*.png`
- Console log: `evals/runs/cesiumjs-custom-shader/001/eval-001-tint-uniform-aircraft/console.json`
- Metadata: `evals/runs/cesiumjs-custom-shader/001/eval-001-tint-uniform-aircraft/metadata.json`

---

### eval-002: vertex-displacement-balloon

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Model.fromGltfAsync
- ✓ pattern_present: Targets the CesiumBalloon sample model
- ✓ pattern_present: Defines vertexShaderText
- ✓ pattern_present: Defines vertexMain function
- ✓ pattern_present: Writes to vsOutput.positionMC
- ✓ pattern_present: Reads normalMC vertex attribute
- ✓ pattern_absent: Does NOT misuse positionEC in vertex shader
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-custom-shader/001/eval-002-vertex-displacement-balloon/screenshot*.png`
- Console log: `evals/runs/cesiumjs-custom-shader/001/eval-002-vertex-displacement-balloon/console.json`
- Metadata: `evals/runs/cesiumjs-custom-shader/001/eval-002-vertex-displacement-balloon/metadata.json`

---

### eval-003: height-ramp-varying-milktruck

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses Model.fromGltfAsync
- ✓ pattern_present: Targets the CesiumMilkTruck sample model
- ✓ pattern_present: Declares FLOAT varying
- ✓ pattern_present: Defines the v_height varying
- ✓ pattern_present: Defines vertexMain
- ✓ pattern_present: Defines fragmentMain
- ✓ pattern_present: Reads vertex height from positionMC.y
- ✓ pattern_present: Writes the ramp into material.diffuse
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-custom-shader/001/eval-003-height-ramp-varying-milktruck/screenshot*.png`
- Console log: `evals/runs/cesiumjs-custom-shader/001/eval-003-height-ramp-varying-milktruck/console.json`
- Metadata: `evals/runs/cesiumjs-custom-shader/001/eval-003-height-ramp-varying-milktruck/metadata.json`

---

### eval-004: public-tileset-custom-shader-color

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses URL-backed 3D Tiles factory
- ✓ pattern_present: Uses public CesiumGS sample tileset
- ✓ pattern_present: Constructs CustomShader
- ✓ pattern_present: Defines fragmentMain
- ✓ pattern_present: Writes material.diffuse
- ✓ pattern_present: Assigns customShader on the tileset
- ✓ pattern_absent: Does NOT combine with style or entitlement-backed OSM Buildings
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-custom-shader/001/eval-004-public-tileset-custom-shader-color/screenshot*.png`
- Console log: `evals/runs/cesiumjs-custom-shader/001/eval-004-public-tileset-custom-shader-color/console.json`
- Metadata: `evals/runs/cesiumjs-custom-shader/001/eval-004-public-tileset-custom-shader-color/metadata.json`

---
