# Evaluation Report: cesiumjs-terrain-environment - Iteration 001

**Generated:** 2026-05-26 21:23:32 UTC

## Decision

- **Result:** REJECT
- **Rule:** rule_2_critical_judge_loss
- **Rationale:** REJECT: Judge loss on regression-critical scenario eval-001

## Score Summary

- **Programmatic Correctness:** 75.0%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 0.0%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 0
- Losses: 1
- Ties: 0

## Per-Scenario Results

### eval-001: procedural-terrain-grand-canyon-rim

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses no-token procedural terrain provider
- ✓ pattern_present: Sets terrainProvider on viewer
- ✓ pattern_present: Enables depth test against terrain
- ✓ pattern_present: Positions camera via setView or flyTo
- ✓ pattern_present: Targets Grand Canyon longitude
- ✓ pattern_present: Targets Grand Canyon latitude
- ✓ pattern_absent: Avoids ion terrain helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-terrain-environment/001/eval-001-procedural-terrain-grand-canyon-rim/screenshot*.png`
- Console log: `evals/runs/cesiumjs-terrain-environment/001/eval-001-procedural-terrain-grand-canyon-rim/console.json`
- Metadata: `evals/runs/cesiumjs-terrain-environment/001/eval-001-procedural-terrain-grand-canyon-rim/metadata.json`

---

### eval-002: sunset-atmosphere-san-francisco-bay

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Enables globe lighting
- ✓ pattern_present: Sets a specific clock time
- ✓ pattern_present: Configures skyAtmosphere
- ✓ pattern_present: Enables ground atmosphere
- ✓ pattern_present: Freezes the clock
- ✓ pattern_present: Targets SF latitude
- ✓ pattern_present: Targets SF longitude
- ✓ pattern_absent: Avoids ion terrain helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-terrain-environment/001/eval-002-sunset-atmosphere-san-francisco-bay/screenshot*.png`
- Console log: `evals/runs/cesiumjs-terrain-environment/001/eval-002-sunset-atmosphere-san-francisco-bay/console.json`
- Metadata: `evals/runs/cesiumjs-terrain-environment/001/eval-002-sunset-atmosphere-san-francisco-bay/metadata.json`

---

### eval-003: fog-denali-ridge

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses no-token procedural terrain provider
- ✗ pattern_present: Enables fog
- ✓ pattern_present: Sets fog density
- ✓ pattern_present: Enables lighting
- ✓ pattern_present: Enables depth test against terrain
- ✓ pattern_present: Targets Denali longitude
- ✓ pattern_present: Targets Denali latitude
- ✓ pattern_absent: Avoids ion terrain helpers
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-terrain-environment/001/eval-003-fog-denali-ridge/screenshot*.png`
- Console log: `evals/runs/cesiumjs-terrain-environment/001/eval-003-fog-denali-ridge/console.json`
- Metadata: `evals/runs/cesiumjs-terrain-environment/001/eval-003-fog-denali-ridge/metadata.json`

---

### eval-004: globe-translucency-bahamas

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Enables globe translucency
- ✓ pattern_present: Configures alpha-by-distance or alpha
- ✓ pattern_present: Uses NearFarScalar or simple alpha
- ✓ pattern_present: Targets Bahamas longitude
- ✓ pattern_present: Targets Bahamas latitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-terrain-environment/001/eval-004-globe-translucency-bahamas/screenshot*.png`
- Console log: `evals/runs/cesiumjs-terrain-environment/001/eval-004-globe-translucency-bahamas/console.json`
- Metadata: `evals/runs/cesiumjs-terrain-environment/001/eval-004-globe-translucency-bahamas/metadata.json`

---
