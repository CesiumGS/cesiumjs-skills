# Iteration 001 -- Proposer Reasoning

## Baseline Analysis (aggregate: 0.964)

Programmatic checks: 34/34 perfect. All issues are visual.

### eval-001 (visual: 0.675) -- PRIORITY TARGET

**Root cause:** The generated code used `await viewer.zoomTo(entities)` where `entities` is an array of 3 entities spanning the entire globe (NYC, Paris, Sydney). CesiumJS `zoomTo` computes a bounding sphere that encompasses all positions, then positions the camera to view that sphere. For entities distributed across the entire globe, this produces a camera centered roughly on Asia at extreme zoom-out, resulting in:
- Camera centered on Asia (poor framing)
- Statue of Liberty marker on the far edge of the globe, partially occluded
- Point markers (12px) too small at this zoom level to distinguish colors
- Only 2 of 3 labels clearly readable

**What the skill lacked:** No guidance on camera positioning when entities span the globe. The skill only showed `viewer.zoomTo(entity)` for single entities. No mention that `zoomTo` produces poor results for globe-spanning entity sets. No recommendation for larger `pixelSize` or `disableDepthTestDistance` on points.

**Fix:** Add a "Camera Framing" section with explicit guidance:
1. For entities within a single region: `viewer.zoomTo(entities)` or `camera.flyTo({destination: Rectangle.fromDegrees(...)})`
2. For globe-spanning entities: use `camera.flyTo` with an explicit destination or `viewer.scene.camera.setView` looking at the full globe
3. Recommend `pixelSize: 14` or larger and `disableDepthTestDistance: Number.POSITIVE_INFINITY` for points that must be visible at all zoom levels

### eval-003 (visual: 0.88)

**Root cause:** The generated code used `clampToGround: true` in `GeoJsonDataSource.load()` options AND then set `entity.polygon.outline = true` and `entity.polygon.outlineColor = Cesium.Color.WHITE`. However, CesiumJS does not support outlines on ground-clamped geometry -- a console warning confirmed: "Entity geometry outlines are unsupported on terrain. Outlines will be disabled."

The skill's GeoJSON example in the baseline includes `clampToGround: true` alongside `stroke: Color.HOTPINK`, which would silently fail in exactly the same way.

**Fix:** Add a prominent warning/caveat in the GeoJSON section:
> `clampToGround: true` disables polygon outlines -- CesiumJS cannot render outlines on terrain-clamped geometry. To keep outlines, omit `clampToGround` or set polygon `height: 0` explicitly.

### eval-005 (visual: 0.84)

**Root causes (two):**
1. **No labels on airports:** The generated code created point-only entities with no label graphics. The eval prompt said "Give each an ID matching its airport code" but the generated code only used `name: "JFK"` etc., without a `label` graphic. The skill's Point example (the first/most-prominent code block) shows a point WITHOUT a label. The Billboard+Label example shows them together, but only for billboards. There is no combined point+label example -- the model learns "point entities don't need labels."

2. **Camera too far out:** `viewer.zoomTo(viewer.entities)` was called AFTER hiding LHR and removing NRT. However, hidden entities (show=false) still exist in the collection and affect the bounding sphere calculation. This caused the camera to zoom out to encompass the LHR position (London), even though it was invisible. The remaining 3 visible airports are all in the US but the camera framed a region including London.

**Fix:**
1. Change the Point example to include a label by default (point+label as the standard pattern)
2. Add a caveat that `viewer.zoomTo(collection)` includes hidden entities in its bounding sphere calculation
3. Show a pattern for zooming to only visible entities

## Changes Made

### Structural changes:
- **Point example now includes a label** -- the first code block readers encounter shows the combined point+label pattern
- **New "Camera Framing" section** -- explicit guidance on positioning camera for regional vs. global entity sets
- **GeoJSON clampToGround caveat** added inline in the GeoJSON section
- **EntityCollection caveats** -- note that zoomTo includes hidden entities

### Wording changes (targeted):
- Point example: added `label` with `disableDepthTestDistance` and larger `pixelSize: 14`
- GeoJSON example: removed `clampToGround: true` from the primary example, added caveat warning
- Added Camera Framing section between Entity Basics and EntityCollection Operations
- Added "Gotchas" subsection to EntityCollection Operations about zoomTo and hidden entities
- Point+Label combination shown as the idiomatic pattern, not Billboard+Label

### What was NOT changed:
- All 17 Graphics Types table: unchanged
- Key Enums table: unchanged
- Performance Tips: unchanged (only minor additions)
- DataSource sections (KML, CZML, GPX, Custom): unchanged
- All API coverage maintained
- No removals of any existing API surface

### Risk assessment:
- eval-001: HIGH confidence improvement. The camera framing guidance directly addresses the root cause.
- eval-002: No changes needed (0.92 already strong). No regression risk.
- eval-003: MEDIUM confidence. Removing clampToGround from the example should produce visible outlines. Small risk that other evals might regress if they relied on clampToGround being the default pattern.
- eval-004: No changes needed (0.97 already strong). The polyline example already shows camera.flyTo with Rectangle. No regression risk.
- eval-005: HIGH confidence. The point+label pattern should trigger label generation. The zoomTo caveat may or may not affect code generation depending on how literally the model follows it.

### Line count: ~420 lines (within 300-500 budget)
