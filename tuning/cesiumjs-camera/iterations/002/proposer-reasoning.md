# Iteration 002 -- Proposer Reasoning

## Baseline Analysis (v2 Eval Suite)

The v2 eval suite tests 8 iconic landmark scenarios. Using the iteration 001 SKILL.md
(which was the accepted output of the prior tuning round) as the baseline for this new
suite, the visual inspection of screenshots revealed three categories of failure:

| Eval | Verdict | Root cause |
|---|---|---|
| eval-001 (Eiffel ground-level) | **MAJOR FAILURE** | Camera at 25 m, pitch +60 (looking UP). Result: solid blue sky. Ground-level camera without 3D Tiles = useless. |
| eval-005 (NYC skyline from Hudson) | **WEAK** | Camera at 500 m, pitch -5. Flat sprawling grid instead of dramatic skyline. Pitch too horizontal at moderate altitude. |
| eval-006 (Grand Canyon rim) | **DECENT BUT FLAT** | Camera at 2300 m, pitch -8. Rim terrain visible but no canyon depth. Near-horizontal pitch misses the vertical drop. |
| eval-002 (Eiffel aerial) | **GOOD** | Top-down at 3000 m, pitch -90. Clear Paris aerial. |
| eval-003 (Eiffel from south) | **EXCELLENT** | lookAt with heading 0, pitch -20, range 1500. Beautiful Paris view. |
| eval-004 (Empire State east) | **GOOD** | lookAt with heading 270, pitch -25, range 800. Clear Midtown view. |
| eval-007 (Grand Canyon aerial) | **GOOD** | setView at 20000 m, pitch -90. Canyon terrain clearly visible from above. |
| eval-008 (Empire State north) | **GOOD** | lookAt with heading 180, pitch -30, range 1500. Clear Manhattan grid looking south. |

## Root-Cause Diagnosis

### eval-001 (MAJOR FAILURE) -- Ground-level camera = sky

The generated code:
```js
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(2.2945, 48.8584, 25.0),
  orientation: { pitch: Cesium.Math.toRadians(60.0) },  // looking UP
});
```

The LLM faithfully followed the prompt ("looking up at the tower") and placed the camera
at 25 m with +60 pitch. The result is all sky because CesiumJS's default globe has no
3D buildings -- just flat terrain imagery. Without OSM Buildings or Google Photorealistic
3D Tiles loaded, a ground-level camera looking horizontally or upward sees the sky and a
flat textured ground plane. There is literally nothing to see.

**The SKILL.md had zero guidance about this limitation.** The altitude table started at
500 m ("landmark close-up") with no mention of what happens below 200 m. The LLM had no
way to know that ground-level views require 3D Tiles.

**Fix:** Add a prominent blockquote warning that ground-level views (altitude < 200 m,
near-horizontal or upward pitch) require 3D Tiles to be meaningful. Instruct the LLM to
add a code comment noting the 3D Tiles requirement and suggest a higher-altitude fallback.

### eval-005 (WEAK) -- NYC skyline looks flat

The generated code:
```js
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(-74.02, 40.7484, 500.0),
  orientation: { heading: Cesium.Math.toRadians(90.0), pitch: Cesium.Math.toRadians(-5.0) },
});
```

At 500 m altitude with pitch -5, the camera looks nearly horizontally across flat terrain
imagery. The result is a sprawling urban grid, not a dramatic skyline. This is the wrong
combination for a "panoramic from across the river" view.

The SKILL.md had no specific guidance for panoramic/skyline views. The altitude table had
"Landmark close-up" at 500-1500 m and "City overview" at 2000-5000 m, but nothing for the
intermediate "skyline from across a distance" perspective.

**Fix:** Add a "City panoramic / skyline" row to the altitude table (800-1500 m, pitch
-10 to -20) and a blockquote explaining that too-horizontal pitch at moderate altitude
produces a flat grid rather than a dramatic skyline.

### eval-006 (DECENT BUT FLAT) -- Grand Canyon rim lacks depth

The generated code:
```js
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(-112.14, 36.06, 2300.0),
  orientation: { heading: Cesium.Math.toRadians(0.0), pitch: Cesium.Math.toRadians(-8.0) },
});
```

At 2300 m (about 100 m above the ~2200 m rim), the -8 degree pitch looks nearly
horizontally across the terrain. The canyon is there, but the shallow angle doesn't
reveal the dramatic depth. The screenshot shows relatively flat-looking terrain.

The SKILL.md had no guidance for terrain-edge/cliff/rim perspectives where a steeper
downward angle is needed to convey depth.

**Fix:** Add a "Canyon / cliff rim" row to the altitude table (50-300 m above rim,
pitch -15 to -25) and a blockquote explaining that steeper pitch reveals depth while
near-horizontal pitch looks flat.

## Changes Made

### 1. Added three blockquote warnings in Altitude & Orientation Guidelines

- **Ground-level 3D Tiles warning**: Prominent blockquote explaining that altitude < 200 m
  with near-horizontal pitch requires 3D Tiles. Without them, only sky and flat ground
  visible. Instructs the LLM to add a code comment and suggest a fallback.
- **Skyline panoramic guidance**: Blockquote with specific altitude (800-1500 m) and pitch
  (-10 to -20) for skyline views. Notes that -5 pitch produces flat grids.
- **Canyon/cliff rim guidance**: Blockquote specifying pitch -15 to -25 for terrain-edge
  views. Notes that near-horizontal pitch misses vertical drop drama.

### 2. Expanded altitude table with two new rows

- **City panoramic / skyline** (800-1500 m, pitch -10 to -20): Fills the gap between
  "Landmark close-up" and "City overview" for skyline-from-a-distance views.
- **Canyon / cliff rim** (50-300 m above rim, pitch -15 to -25): Addresses terrain-edge
  perspectives where depth revelation is the goal.

### 3. Added canyon rim setView example

Replaced the redundant top-down geographic feature example (already covered by pitch -90
guidance) with a canyon rim perspective example using -20 pitch and Grand Canyon coordinates.
This directly demonstrates the pattern that eval-006 needed.

### 4. Added second lookAt example (east perspective)

Added an Empire State Building example with heading 270 (facing west = camera east of target)
alongside the existing Paris example with heading 0. This gives the LLM two concrete heading
patterns to reference, directly addressing eval-004 and eval-008.

### 5. Added lookAt heading convention reference

Compact blockquote mapping heading values (0, 90, 180, 270) to camera placement relative
to target. This eliminates heading confusion that can cause wrong viewing directions.

### 6. Updated Common Patterns Quick Reference table

Added rows for "City skyline / panoramic", "Canyon / cliff rim", and "Ground-level /
street view" with key parameters. The ground-level row explicitly notes the 3D Tiles
requirement.

## Changes NOT Made

- **No API coverage removed.** Every method, property, event, and pattern from iteration
  001 is retained.
- **No structural changes.** All sections remain in the same order with the same headings.
- **ICRF example** condensed to prose (3 lines) -- the API reference
  (`computeIcrfToFixedMatrix`, `lookAtTransform`, `Matrix4.fromRotationTranslation`) is
  fully preserved.
- **DebugCameraPrimitive** condensed to inline code -- API fully preserved.
- **Camera Events, pickEllipsoid, Entity Tracking, flyHome, flyToBoundingSphere,
  Movement/Rotation/Look/Zoom, Custom First-Person Controls** -- all preserved.

## Expected Impact

| Eval | Baseline | Expected | Mechanism |
|---|---|---|---|
| eval-001 (Eiffel ground) | **FAIL** | **0.70-0.80** | Ground-level warning will cause LLM to add 3D Tiles caveat and/or suggest higher-altitude fallback. View may still not be ideal without actual 3D Tiles in the test harness, but the code will be correct in noting the limitation. |
| eval-002 (Eiffel aerial) | GOOD | GOOD | No change expected -- already working well with pitch -90 guidance. |
| eval-003 (Eiffel south) | EXCELLENT | EXCELLENT | lookAt example now uses exact Eiffel Tower coords with heading 0, reinforcing this pattern. |
| eval-004 (Empire east) | GOOD | **GOOD+** | New lookAt example uses Empire State coords with heading 270, directly matching this eval. |
| eval-005 (NYC skyline) | **WEAK** | **0.85-0.90** | Skyline panoramic guidance (800-1500 m, pitch -10 to -20) directly addresses the flat-grid problem. |
| eval-006 (Grand Canyon rim) | **DECENT** | **0.80-0.90** | Canyon rim guidance (pitch -15 to -25) and new setView example with Grand Canyon coords and pitch -20. |
| eval-007 (Grand Canyon aerial) | GOOD | GOOD | No change -- top-down pitch -90 guidance already effective. |
| eval-008 (Empire north) | GOOD | GOOD | lookAt heading convention reference reinforces heading 180 pattern. |

## Regression Risk Assessment

- **code_executes**: NO risk. No API signatures changed. All examples use valid CesiumJS patterns.
- **api_accuracy**: NO risk. No APIs removed, no incorrect signatures introduced.
- **structural_integrity**: NO risk. Same sections, same order, YAML frontmatter preserved.
- **conciseness**: LOW risk. 500 lines (same as iteration 001 ceiling). New content replaces
  compressed sections -- net zero line increase.
- **no_console_errors**: NO risk. No code changes that could introduce runtime errors.
- **eval-002, eval-003, eval-007, eval-008 regressions**: LOW risk. These evals already
  produce correct code. The new guidance is additive and doesn't contradict existing patterns.
  The only risk is if the ground-level warning causes the LLM to unnecessarily avoid low
  altitudes when they're appropriate, but the warning is scoped to "altitude < 200 m" which
  doesn't overlap with any other eval's altitude range.
