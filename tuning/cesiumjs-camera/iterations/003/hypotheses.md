# Iteration 003 Hypotheses

Based on baseline evaluation screenshots + official CesiumJS documentation research.

---

## H1: Clarify HeadingPitchRange Convention with Cardinal Direction Table

**Observation:** Evals 003, 004, 008, 013, 014 all test lookAt from specific cardinal
directions. The baseline generates correct heading values, but the skill's explanation
of the heading convention is buried in prose. Developers frequently confuse "heading=0
means camera faces north" with "heading=0 means camera is north of target."

**Root cause:** The skill says heading is "from local north" but doesn't explicitly
spell out the mapping: heading=0 → camera faces north → camera is SOUTH of target.

**Research support:** Official Cesium docs have three conflicting descriptions of the
heading parameter. The Camera.js source code applies a `-PI/2` adjustment internally.
This is a known source of confusion in the Cesium community forums.

**Proposed change:** Add an explicit cardinal direction reference immediately after
the lookAt code example:

```
| To view from... | Camera faces... | Set heading to |
|-----------------|----------------|----------------|
| South           | North (0°)     | 0 or 2π       |
| West            | East (90°)     | π/2            |
| North           | South (180°)   | π              |
| East            | West (270°)    | 3π/2           |
```

**Expected impact:** Evals 003, 004, 008, 013, 014 should maintain their current
quality. This change is primarily defensive — preventing future confusion rather than
fixing current failures. It may improve eval-003 framing slightly.

**Regression risk:** None — additive reference table, no code changes.

---

## H2: Add Gimbal Lock Warning for Pitch = -90°

**Observation:** Evals 002 and 007 use pitch=-90 (straight down). The baseline code
generates `CesiumMath.toRadians(-90)` which hits gimbal lock — this can cause
unpredictable camera behavior or rendering artifacts.

**Root cause:** The skill's setView and flyTo examples use `-90` for top-down views
without warning about gimbal lock.

**Research support:** Official CesiumJS guidance recommends using `-Math.PI/2 + 0.0001`
instead of exactly `-Math.PI/2` to avoid gimbal lock singularity.

**Proposed change:** Add a blockquote warning near the top-down setView example:

> **Gimbal lock:** Avoid `pitch: -Math.PI/2` exactly. Use `-(Math.PI/2 - 0.0001)`
> for straight-down views to prevent singularity issues.

And update the top-down example to use the safe value.

**Expected impact:** Evals 002 and 007 may show slightly more stable rendering.
More importantly, this prevents a real production bug.

**Regression risk:** Negligible — 0.0001 radian difference (~0.006°) is invisible.

---

## H3: Add OSM Buildings Guidance for City Panoramic Views

**Observation:** eval-005 (NYC skyline from Hudson) was dramatically improved in
iteration 002 when the proposer added guidance to load OSM Buildings. This pattern
should be reinforced and made more explicit.

**Root cause:** The baseline skill has no mention of 3D Tiles or OSM Buildings in the
camera section — it assumes the viewer is pre-configured.

**Research support:** Meaningful street-level and skyline views effectively require
3D Tiles (OSM Buildings or Google Photorealistic). Without them, city views are just
flat satellite imagery. This is not explicitly documented by Cesium but is functionally
true.

**Proposed change:** Add a prominent callout in the Camera Fundamentals section:

> **City views need 3D buildings.** For skyline, street-level, or urban panorama
> views, load `createOsmBuildingsAsync()` first. Without 3D Tiles, cities appear
> as flat satellite imagery regardless of camera angle.

**Expected impact:** Evals 005, 008 (and potentially 004) should show 3D buildings
when the generated code follows this guidance, producing dramatically more recognizable
city scenes.

**Regression risk:** Low — cross-domain reference (buildings belong to viewer-setup
skill), but a brief mention is within the allowed crossover boundary.

---

## H4: Add maximumZoomDistance + enableCollisionDetection Gotcha

**Observation:** eval-009 (constrain zoom/tilt London) passes programmatically but
the skill doesn't warn about a critical interaction between `maximumZoomDistance` and
`enableCollisionDetection`.

**Root cause:** The skill documents both properties independently but doesn't mention
that `maximumZoomDistance` is silently ignored when `enableCollisionDetection` is false.

**Research support:** Confirmed in CesiumJS source code and community forums. This is
a known gotcha that trips up developers who disable collision detection for underground
views but expect zoom limits to still work.

**Proposed change:** Add a callout in the Constraining Navigation section:

> **Gotcha:** `maximumZoomDistance` is silently ignored when
> `enableCollisionDetection = false`. If you need both underground access and
> zoom limits, re-enable collision detection after the underground view.

**Expected impact:** eval-009 may not show visual improvement (the constraint works
in the baseline), but this prevents a real production bug for developers.

**Regression risk:** None — additive warning.

---

## H5: Improve flyHome Example with Workaround for Orientation Limitation

**Observation:** eval-012 (flyHome with custom Europe rectangle) works but flyHome
always produces a top-down north-up view with no orientation control.

**Root cause:** The skill's flyHome section mentions `Camera.DEFAULT_VIEW_RECTANGLE`
but doesn't note the orientation limitation or the workaround.

**Research support:** CesiumJS issue #6134 confirms flyHome has no orientation
parameter. The workaround is intercepting `HomeButton.viewModel.command.beforeExecute`
for custom home views with orientation.

**Proposed change:** Add a note to the flyHome section:

> **Limitation:** `flyHome()` always flies to a top-down, north-up view —
> orientation cannot be customized. For a home view with custom orientation,
> intercept the HomeButton's `beforeExecute` event.

**Expected impact:** eval-012 may not change visually, but this saves developers
from discovering the limitation through trial and error.

**Regression risk:** None — documentation note only.
