# Iteration 001 -- Proposer Reasoning

## Hypotheses Applied

### H1: Widget cleanup in viewer constructor
**Location:** Primitive section example (line ~37-42 in optimized)
**Change:** Replaced bare `new Viewer("cesiumContainer")` with `new Viewer("cesiumContainer", { animation: false, timeline: false, navigationHelpButton: false, navigationInstructionsInitiallyVisible: false })`.
**Rationale:** Validated 4-0 win on imagery tuning. Generated code that creates a viewer for geometry demos should not show distracting animation/timeline widgets. Added brief guidance text above the code block explaining why.

### H2: Camera positioning for geometry demos
**Location:** Primitive section example (lines ~56-63 in optimized)
**Change:** Added `viewer.camera.setView` call after the first Primitive example with concrete coordinates (`-100.0, 40.0` matching the ellipse center), altitude `1500000`, and pitch `-45` degrees. Added guidance note: "Use `camera.setView` (not `flyTo`) to position the camera immediately after adding primitives."
**Rationale:** Validated pattern from camera tuning (3W/0L). Without explicit camera positioning, generated demos show default globe view and the user must manually navigate to find the geometry. `setView` is immediate (no animation delay); altitude 1.5M meters gives a good regional view of the 250km/400km ellipse.

### H3: vertexFormat mismatch gotcha (PROMINENT)
**Location:** Architecture section, immediately after the core formula description (line ~22 in optimized)
**Change:** Added `> **Warning: vertexFormat mismatch causes silent failure.**` blockquote explaining that mismatched vertexFormat renders geometry black or invisible with no error, and listing the correct pattern (use appearance's static `VERTEX_FORMAT`).
**Rationale:** This is the #1 confusion point in the Primitive API. The baseline mentioned it in the Appearances section and Performance Tips, but both were easy to miss. Placing it at the top of the Architecture section ensures the LLM sees it early when generating any Primitive code. The blockquote format matches the validated gotcha pattern from camera tuning.

### H4: Primitive immutability gotcha (EXPANDED)
**Location:** Architecture section, replacing the single-sentence mention (line ~20 in optimized)
**Change:** Expanded from a one-line mention to a `> **Warning:**` blockquote that explicitly states: (1) geometry cannot be modified after first render, (2) to change geometry, remove old Primitive and create new one, (3) per-instance attributes (color, show) CAN be updated. Includes the method call `scene.primitives.remove(primitive)`.
**Rationale:** Developers frequently try to update positions/shapes after creation and get confused when nothing happens. The baseline mentioned immutability in passing but did not explain the workaround (remove + recreate) or clarify what CAN be updated. The expanded blockquote makes the distinction explicit.

### H5: GroundPrimitive terrain requirement
**Location:** GroundPrimitive section (line ~239 in optimized)
**Change:** Added `> **Warning: GroundPrimitive requires real terrain.**` blockquote before the code example. Updated the code example to include `Terrain` import and `terrain: Terrain.fromWorldTerrain()` in the viewer constructor.
**Rationale:** `GroundPrimitive` drapes onto terrain surfaces. With the default `EllipsoidTerrainProvider` (flat globe, no terrain mesh), ground primitives can render at wrong heights or become invisible. This is a common trap -- the developer adds a GroundPrimitive, sees nothing, and doesn't know why. Adding the terrain provider to the code example ensures generated code includes it by default.

## Changes NOT Made
- No sections were removed, reordered, or restructured
- No APIs from other skill domains were added
- All existing code examples, tables, and catalog content preserved
- Performance Tips section unchanged (vertexFormat and immutability gotchas now have their own prominent blockquotes earlier)

## Line Count
- Baseline: 421 lines
- Optimized: 449 lines (+28 lines, well under 500 limit)
- Net additions: 3 blockquote gotchas (~10 lines), widget cleanup options (~5 lines), camera.setView block (~9 lines), terrain in GroundPrimitive example (~4 lines)

## Expected Eval Impact
- H1 (widget cleanup): Expect 1-2 eval wins on scenarios that create viewers, matching imagery results
- H2 (camera positioning): Expect wins on scenarios where geometry needs to be visible on load
- H3 (vertexFormat gotcha): Expect wins on mixed-appearance scenarios where the LLM might otherwise forget to match formats
- H4 (immutability gotcha): Expect wins on scenarios involving geometry updates, where the LLM should use remove+recreate pattern
- H5 (terrain requirement): Expect wins on GroundPrimitive scenarios, where terrain provider must be loaded
- No losses expected -- all changes are additive callouts and code enhancements
