# Proposer Reasoning: Iteration 001

## Hypotheses Applied

### H1: Widget cleanup in terrain viewer examples
**Change:** Added `animation: false, timeline: false, navigationHelpButton: false, navigationInstructionsInitiallyVisible: false` to the main Viewer constructor in the Cesium Ion World Terrain example (section: Terrain Providers).

**Rationale:** This was a 4-0 win on cesiumjs-imagery. The terrain skill's primary Viewer example lacked these options, meaning generated code would include timeline/animation widgets that distract from the terrain visualization. Agents using this skill will now produce cleaner viewer setups by default.

**Location:** Lines 18-24 of the Cesium Ion World Terrain code block.

---

### H2: Camera positioning for terrain demos
**Change:** Added a `camera.setView` call after the Viewer constructor in the main terrain example, positioning the camera at the Grand Canyon (a universally recognizable terrain feature). Also added a "Camera Heights for Terrain Views" reference table mapping view scales to altitude/pitch ranges specific to terrain features (valleys, peaks, ranges, regional, continental).

**Rationale:** Camera altitude/orientation tables were a confirmed win on cesiumjs-camera. The baseline terrain skill had no camera guidance at all -- terrain defaults to a distant orbital view where terrain detail is invisible. Without explicit camera positioning, generated code shows a tiny sphere with no visible terrain features. The table provides terrain-specific guidance (not just generic altitude ranges) so the agent picks appropriate altitudes for canyons vs. mountain ranges vs. regional views.

**Location:** Lines 27-47 (camera.setView call and terrain view table), placed directly after the first terrain example.

---

### H3: depthTestAgainstTerrain gotcha
**Change:** Added a prominent blockquote gotcha after the Globe Configuration code block explaining the `depthTestAgainstTerrain` trade-off: `false` (default) causes entities to float above terrain; `true` hides entities behind hills. Includes a rule-of-thumb for when to use each setting.

**Rationale:** This is one of the most frequently encountered CesiumJS confusion points. The baseline had only a terse inline comment (`// true = z-test entities vs terrain`) and a performance tip at the bottom that said "keep false" without explaining why or when `true` is needed. The gotcha format matches the pattern from cesiumjs-camera (bold label in blockquote) which produced wins.

**Location:** Lines 141-147 (blockquote after globe config code block).

---

### H4: enableLighting prerequisite gotcha
**Change:** Added a blockquote gotcha at the top of the Globe Configuration section (before the code block) warning that `globe.enableLighting = true` is required for `SunLight`/`DirectionalLight` to have any visual effect on terrain. Also added a brief prerequisite reminder in the Lighting section itself.

**Rationale:** The baseline mentioned `enableLighting` in a comment at the bottom of the Lighting code block, but a developer reading Globe Configuration first would not know this. This is a classic "why doesn't my lighting work?" issue. Elevating it to a gotcha callout at both relevant locations ensures it is seen regardless of which section the agent reads first.

**Location:** Lines 108-111 (Globe Configuration gotcha) and lines 248-249 (Lighting section reminder).

---

### H5: verticalExaggeration on Scene not Globe gotcha
**Change:** Added a blockquote gotcha above the existing Terrain Exaggeration code block, explicitly warning that `globe.verticalExaggeration` does not exist and will silently do nothing.

**Rationale:** The baseline had a comment `// Set on Scene, not Globe` in the code, but comments are easy to miss. Promoting this to a gotcha callout makes it visually prominent. "Silently does nothing" is the worst kind of bug -- no error, no warning, just missing behavior. The gotcha format is consistent with the winning patterns from cesiumjs-camera.

**Location:** Lines 161-163 (blockquote before terrain exaggeration code).

---

### H6: Terrain + 3D Tiles interaction gotcha
**Change:** Added a blockquote gotcha explaining that when combining terrain with 3D Tiles buildings, `depthTestAgainstTerrain = true` is essential for correct visual ordering, otherwise buildings appear to float above terrain.

**Rationale:** This is a natural extension of H3 (depthTestAgainstTerrain) but targets the specific terrain + 3D Tiles combination which is extremely common (CesiumJS Sandcastle examples frequently combine these). The baseline had no guidance on this interaction at all. Updated the Performance Tips item #10 to cross-reference the gotcha.

**Location:** Lines 149-153 (blockquote after the depthTestAgainstTerrain gotcha).

---

## Changes NOT Made

- **No sections reordered or restructured.** All additions are insertions within existing sections.
- **No API coverage removed.** All original code examples, properties, and classes are preserved.
- **No APIs added from other skill domains.** The `camera.setView` call in H2 is minimal glue code for terrain visualization, not camera skill content.
- **No `flyTo` animations used.** All camera positioning uses `setView` for immediate placement, consistent with the winning pattern from cesiumjs-imagery.

## Line Count

- Baseline: 401 lines
- Optimized: 454 lines (+53 lines)
- Budget remaining: 46 lines (under 500 limit)

## Expected Impact

The highest-value changes are likely H1 (widget cleanup, proven 4-0 winner), H3 (depthTestAgainstTerrain, addresses the #1 terrain confusion point), and H4 (enableLighting prerequisite, prevents silent failures). H2 (camera table) transfers a pattern that worked on camera but is specifically tuned for terrain viewing contexts. H5 and H6 are lower-risk callouts that prevent common mistakes at minimal line cost.
