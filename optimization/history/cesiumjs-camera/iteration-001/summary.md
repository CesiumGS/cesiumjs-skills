# Evaluation Report: cesiumjs-camera - Iteration 001

**Generated:** 2026-05-26 21:59:03 UTC

## Decision

- **Result:** REJECT
- **Rule:** rule_1_check_failure
- **Rationale:** REJECT: Programmatic check failed on scenario eval-003

## Score Summary

- **Programmatic Correctness:** 85.7%
- **API Accuracy:** 100.0%
- **Visual Win Rate:** 42.9%
- **Coverage Delta:** 0.0% (reserved for US-013)

## Win/Loss/Tie Counts

- Wins: 2
- Losses: 0
- Ties: 0

## Per-Scenario Results

### eval-001: eiffel-tower-ground-level

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses a camera positioning method
- ✓ pattern_present: Paris latitude
- ✓ pattern_present: Paris longitude
- ✓ pattern_present: Adds a visible public-eval subject marker
- ✓ pattern_absent: Avoids entitlement-backed 3D assets
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-001-eiffel-tower-ground-level/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-001-eiffel-tower-ground-level/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-001-eiffel-tower-ground-level/metadata.json`

---

### eval-002: eiffel-tower-aerial

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses setView or flyTo
- ✓ pattern_present: Paris latitude
- ✓ pattern_present: Steep downward pitch (70-90 degrees or equivalent radians)
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-002-eiffel-tower-aerial/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-002-eiffel-tower-aerial/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-002-eiffel-tower-aerial/metadata.json`

---

### eval-003: eiffel-tower-from-south

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses lookAt for orbital lock
- ✓ pattern_present: Uses HeadingPitchRange for offset
- ✗ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-003-eiffel-tower-from-south/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-003-eiffel-tower-from-south/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-003-eiffel-tower-from-south/metadata.json`

---

### eval-004: empire-state-building-from-east

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses lookAt
- ✓ pattern_present: Uses HeadingPitchRange
- ✓ pattern_present: NYC longitude negative
- ✓ pattern_present: Heading ~270 degrees (east perspective)
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-004-empire-state-building-from-east/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-004-empire-state-building-from-east/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-004-empire-state-building-from-east/metadata.json`

---

### eval-005: nyc-skyline-from-hudson

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses flyTo or setView (positioned view)
- ✓ pattern_present: NYC latitude
- ✓ pattern_present: West of Manhattan longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-005-nyc-skyline-from-hudson/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-005-nyc-skyline-from-hudson/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-005-nyc-skyline-from-hudson/metadata.json`

---

### eval-006: grand-canyon-south-rim

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Grand Canyon latitude
- ✓ pattern_present: Grand Canyon longitude negative
- ✓ pattern_present: Uses a camera method
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-006-grand-canyon-south-rim/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-006-grand-canyon-south-rim/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-006-grand-canyon-south-rim/metadata.json`

---

### eval-007: grand-canyon-aerial-overview

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses setView or flyTo
- ✓ pattern_present: Straight-down pitch or equivalent radians
- ✓ pattern_present: Grand Canyon longitude
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-007-grand-canyon-aerial-overview/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-007-grand-canyon-aerial-overview/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-007-grand-canyon-aerial-overview/metadata.json`

---

### eval-008: empire-state-building-from-north

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses lookAt
- ✓ pattern_present: Uses HeadingPitchRange
- ✓ pattern_present: Heading ~180 degrees (south-facing)
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-008-empire-state-building-from-north/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-008-empire-state-building-from-north/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-008-empire-state-building-from-north/metadata.json`

---

### eval-009: constrain-zoom-tilt-london

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Accesses camera controller
- ✓ pattern_present: Sets min zoom
- ✓ pattern_present: Sets max zoom
- ✓ pattern_present: Sets tilt limit
- ✓ pattern_present: Disables rotation
- ✓ pattern_absent: Does NOT disable all inputs
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-009-constrain-zoom-tilt-london/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-009-constrain-zoom-tilt-london/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-009-constrain-zoom-tilt-london/metadata.json`

---

### eval-010: remap-input-right-drag-rotate

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Remaps rotation
- ✓ pattern_present: Remaps tilt
- ✓ pattern_present: Uses CameraEventType
- ✓ pattern_present: Right-drag for rotation
- ✓ pattern_present: Uses modifier keys
- ✓ pattern_present: Ctrl modifier for tilt
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-010-remap-input-right-drag-rotate/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-010-remap-input-right-drag-rotate/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-010-remap-input-right-drag-rotate/metadata.json`

---

### eval-011: chained-flyto-tour-nyc

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses flyTo
- ✓ pattern_present: Uses complete callback for chaining
- ✓ pattern_present: Statue of Liberty longitude
- ✓ pattern_present: Empire State longitude
- ✓ pattern_present: Uses easing function
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-011-chained-flyto-tour-nyc/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-011-chained-flyto-tour-nyc/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-011-chained-flyto-tour-nyc/metadata.json`

---

### eval-012: flyhome-custom-default-europe

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Sets custom home rectangle
- ✓ pattern_present: Creates rectangle from degrees
- ✓ pattern_present: Calls flyHome
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** TIE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-012-flyhome-custom-default-europe/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-012-flyhome-custom-default-europe/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-012-flyhome-custom-default-europe/metadata.json`

---

### eval-013: eiffel-tower-from-east

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses lookAt
- ✓ pattern_present: Uses HeadingPitchRange
- ✓ pattern_present: Heading ~270 degrees
- ✗ pattern_present: Releases lookAt lock
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** BASELINE (2/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-013-eiffel-tower-from-east/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-013-eiffel-tower-from-east/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-013-eiffel-tower-from-east/metadata.json`

---

### eval-014: eiffel-tower-from-north

**Programmatic Checks:**

- ✓ no_console_errors: No JS errors
- ✓ code_runs: No runtime exceptions
- ✓ pattern_present: Uses lookAt
- ✓ pattern_present: Uses HeadingPitchRange
- ✓ pattern_present: Heading ~180 degrees
- ✓ screenshot_quality: Captured screenshot is nonblank and has the expected viewport dimensions

**Judge Verdict:** CANDIDATE (3/3 judges)

**Evidence:**

- Screenshot(s): `evals/runs/cesiumjs-camera/001/eval-014-eiffel-tower-from-north/screenshot*.png`
- Console log: `evals/runs/cesiumjs-camera/001/eval-014-eiffel-tower-from-north/console.json`
- Metadata: `evals/runs/cesiumjs-camera/001/eval-014-eiffel-tower-from-north/metadata.json`

---
