# Proposer Reasoning: cesiumjs-3d-tiles iteration 001

## Applied Hypotheses

### H1: Widget cleanup in viewer constructor (HIGH confidence)
**What changed:** The "Loading a Tileset" section's first code example now creates a `Viewer` with `animation: false, timeline: false, navigationHelpButton: false, navigationInstructionsInitiallyVisible: false`. The baseline assumed `viewer` already existed without showing its construction.

**Why:** This was a 4-0 unanimous win on imagery. The 3D Tiles skill is particularly vulnerable because tilesets occupy the 3D viewport -- widget overlays (animation/timeline bars) obscure tileset content and produce cluttered screenshots. By showing the clean viewer setup in the first code block, the LLM consumer will include these options in generated code.

**Risk:** Very low. This is purely additive -- the viewer construction was implicit before.

### H2: Camera positioning after tileset load (HIGH confidence)
**What changed:** Added a blockquote after `zoomTo` explaining that city-scale tilesets need explicit `camera.setView` for a specific perspective. Added a "Camera Positioning for Tilesets" altitude/pitch table (same structure as the camera skill's table). Added an OSM Buildings callout for city/urban views.

**Why:** Three validated wins from camera/imagery:
- The altitude/orientation table was a win in camera optimization.
- `setView` over `flyTo` was a win in imagery (immediate positioning for eval screenshots).
- OSM Buildings callout was the highest-impact hypothesis from camera optimization (3 wins, 0 losses).

For 3D Tiles specifically, `zoomTo(tileset)` produces a view computed from the bounding sphere which is often too far or at a poor angle for city-scale tilesets. Guiding the LLM to follow up with `setView` produces more recognizable, useful views.

**Risk:** Low. The table and callouts are additive guidance, not code changes.

### H3: maximumScreenSpaceError gotcha (HIGH confidence)
**What changed:** Added a prominent `> **Warning:**` blockquote at the top of the Performance Tips section explaining that SSE below 4 causes exponential tile request growth. The baseline had a one-line numbered tip ("Avoid maximumScreenSpaceError below 4 -- diminishing returns") but did not explain the consequence with concrete numbers.

**Why:** Gotcha blockquotes were a validated win in camera optimization. The SSE pitfall is the single most impactful performance mistake in 3D Tiles work -- setting SSE to 2 or 1 "for quality" can freeze an application. Making this a prominent callout with concrete numbers (200 tiles vs 3,000+) is more likely to be respected by the LLM than a numbered list item buried among 12 other tips.

**Risk:** Very low. The numbered tip (#7) is preserved unchanged; this adds emphasis, not new information.

### H4: enableCollision interaction gotcha (MEDIUM confidence)
**What changed:** Added a `> **Warning:**` blockquote in Performance Tips explaining the interaction between tileset `enableCollision` and globe `enableCollisionDetection`. When tileset collision is on but globe collision is off, the camera clips through terrain between buildings.

**Why:** Gotcha blockquotes were a validated pattern. This specific interaction is underdocumented and produces confusing behavior -- the camera correctly stays above buildings but sinks into terrain in open areas. Making this explicit helps the LLM generate correct collision setups.

**Risk:** Low. This is additive guidance and the interaction is real (verified from CesiumJS source: `ScreenSpaceCameraController` checks globe collision independently from tileset collision).

### H5: Styling expression syntax pitfall (MEDIUM-HIGH confidence)
**What changed:** Added a `> **Warning:**` blockquote before the first styling example warning that `${PropertyName}` style expressions conflict with JavaScript template literal syntax. Includes a concrete WRONG/CORRECT comparison showing backtick vs regular string quotes.

**Why:** This is a genuinely common mistake. CesiumJS style expressions use `${PropertyName}` which is identical to JavaScript template literal `${variable}` syntax. Developers (and LLMs) using backtick strings for style conditions will get silent JavaScript variable substitution instead of passing the expression to the CesiumJS styling engine. The WRONG/CORRECT pattern gives the LLM a clear negative example to avoid.

**Risk:** Low. The warning is additive and placed directly before the section where the syntax is used.

## Unchanged Sections

The following sections were preserved without modification:
- Key Constructor Options table
- Tileset Events
- Runtime Properties
- All styling code examples (only added the warning before them)
- Feature Picking and Properties
- Clipping Planes
- Clipping Polygons
- Point Cloud Shading
- Voxel Primitives
- I3S Data Provider
- Gaussian Splats
- Classification
- Adjusting Tileset Height
- Performance Tips numbered list (all 12 items preserved)
- See Also

## Line Count

Baseline: 382 lines
Iteration 001: ~460 lines (under 500 limit)
Delta: ~78 lines added (all callouts, tables, and viewer setup code)

## Section Order

Preserved exactly from baseline. No sections were reordered, merged, or split.
