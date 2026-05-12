# Iteration 001 -- Proposer Reasoning

## Baseline Analysis

The baseline SKILL.md at 400 lines covers all model and particle APIs well. The code patterns are correct and the API coverage is comprehensive. However, it lacks several patterns that produced measurable wins in prior optimization runs on `cesiumjs-camera` and `cesiumjs-imagery`.

## Hypotheses and Changes Applied

### H1: Widget cleanup in viewer constructors

**Observation:** The baseline has two sections where a `Viewer` is constructed or implicitly assumed -- the Smoke Trail example and the Entity API Model section. Neither disables unneeded widgets.

**Change:** Added `animation: false, timeline: false, navigationHelpButton: false, navigationInstructionsInitiallyVisible: false` to viewer constructors in the Smoke Trail example and the Entity API Model example. These are the two places where a viewer construction is shown explicitly or most likely to be generated.

**Expected impact:** Cleaner screenshots with more visible model/particle content. This was a 4-0 win on the imagery skill.

**Regression risk:** Minimal -- only affects viewer constructor options, no API changes.

### H2: Camera positioning for model viewing

**Observation:** The baseline's "Positioned Model with Heading" section loads a model at (-123.074, 44.050, 5000) but provides no guidance on where to put the camera to see it. The Entity API section uses `viewer.trackedEntity = entity` which works but produces an automated camera position that may not be ideal for screenshots/demos.

**Change:** Added an explicit `camera.setView` call after the positioned model example, with altitude slightly above the model and a moderate pitch angle (-35 degrees). Replaced `viewer.trackedEntity = entity` in the Entity API section with an explicit `camera.setView` call. Added prose guidance: "Use `camera.setView` for immediate positioning (not `flyTo`, which animates and may not finish before a screenshot)."

**Expected impact:** Generated code will position the camera explicitly rather than relying on `trackedEntity` or `zoomTo`, producing more predictable and visually correct screenshots. Camera altitude/orientation guidance was a measurable win on `cesiumjs-camera`.

**Regression risk:** Low -- the Entity API section notes this is for simpler use cases, and the camera positioning is advisory.

### H3: readyEvent timing gotcha

**Observation:** The baseline mentions the readyEvent timing issue in prose ("Wait for readyEvent before accessing animations, nodes, or boundingSphere") but it reads as neutral documentation rather than a prominent warning. This is a common source of runtime errors.

**Change:** Added a blockquote warning callout: "Accessing `model.boundingSphere`, `model.activeAnimations`, or `model.getNode()` before `readyEvent` fires can return `undefined` or throw." Placed directly after the prose explanation and before the code example.

**Expected impact:** Generated code will more consistently use `readyEvent` gating, reducing runtime errors in generated code. Gotcha blockquotes were identified as a validated optimization pattern.

**Regression risk:** None -- purely additive warning, no code or API changes.

### H4: heightReference requires scene parameter

**Observation:** The baseline mentions `scene` in a comment ("scene is required for height reference") but the comment is easy to miss and doesn't explain what happens without it. This is one of the most common CesiumJS Primitive API pitfalls.

**Change:** Added a blockquote warning callout explaining that without `scene: viewer.scene`, `CLAMP_TO_GROUND` silently does nothing. Added `scene` to the options table. Added an inline comment on the `scene` line in the code example: `// <-- without this, CLAMP_TO_GROUND silently fails`.

**Expected impact:** Generated code using height reference with the Primitive API will consistently include the `scene` parameter. The "silently fails" framing is more memorable than the baseline's neutral comment.

**Regression risk:** None -- strengthens existing documentation, no API changes.

### H5: Particle image requirement -- canvas as default

**Observation:** The baseline's particle examples use string paths like `"smoke.png"` which rely on external files that may not exist in the user's project. The Canvas-Based section exists but is presented as an alternative rather than the default. A `ParticleSystem` with no `image` or a missing image file renders invisible particles with no error.

**Change:** (a) Added a blockquote warning at the top of the Particle Systems section: "A `ParticleSystem` with no `image` property renders invisible particles." (b) Changed all particle examples to use `createCircleImage()` instead of string file paths, with comments noting "canvas-based -- no external file needed." (c) Added emphasis in the Canvas-Based section: "This is the **recommended approach for demos and standalone examples**."

**Expected impact:** Generated particle code will work out of the box without requiring external image files. This eliminates a common failure mode where particles are created but invisible.

**Regression risk:** Low -- `createCircleImage()` is used in place of `"smoke.png"` which would also fail without the file. The canvas approach is strictly more reliable for generated code.

### H6: Model scale vs minimumPixelSize interaction

**Observation:** The baseline lists `scale`, `minimumPixelSize`, and `maximumScale` as separate options without explaining how they interact. The interaction is non-obvious: CesiumJS renders at whichever produces a larger on-screen size, which can cause distant models to appear enormous.

**Change:** Added a "Scale vs minimumPixelSize" subsection in Quick Reference with a table mapping goals to the appropriate property combination. Key insight: "When both are set, CesiumJS renders at whichever produces a LARGER on-screen size." Updated Performance Tip #4 to say "Always pair with `maximumScale` to cap the effect."

**Expected impact:** Generated code will use the correct combination of scale properties, avoiding the common pitfall of distant models appearing disproportionately large.

**Regression risk:** None -- purely additive guidance in Quick Reference.

## Summary of All Changes

| Location | Change | Hypothesis |
|---|---|---|
| Quick Reference | Added Scale vs minimumPixelSize subsection with table | H6 |
| Loading a glTF/GLB Model | Added camera.setView example after positioned model | H2 |
| Key Options table | Added `scene` parameter row | H4 |
| Readiness and Lifecycle | Added blockquote warning about readyEvent timing | H3 |
| Height Reference | Added blockquote warning about scene requirement, inline comment | H4 |
| Particle Systems intro | Added blockquote warning about invisible particles | H5 |
| Smoke Trail | Widget cleanup in viewer, camera.setView, canvas-based image | H1, H2, H5 |
| Particle Bursts | Changed to canvas-based image | H5 |
| Update Callback | Changed to canvas-based image | H5 |
| Attaching Particles | Changed to canvas-based image | H5 |
| Canvas-Based section | Added "recommended approach" emphasis | H5 |
| Entity API Model | Widget cleanup in viewer, camera.setView replaces trackedEntity | H1, H2 |
| Performance Tips #4 | Added "Always pair with maximumScale" | H6 |

## Changes NOT Made

- **No API coverage removed.** Every class, method, property, and pattern from the baseline is retained.
- **No sections reordered.** All sections remain in the same order as the baseline.
- **No APIs from other skill domains added.**
- **GPM Extension** -- unchanged.
- **Emitter Types** -- unchanged.
- **Model Nodes** -- unchanged.
- **Coloring, Silhouettes, and Feature Picking** -- unchanged.
- **Animation Events** -- unchanged.
- **Performance Tips** -- only tip #4 modified (additive).

## Line Count

Baseline: 400 lines. Optimized: 472 lines. Net +72 lines. Within the 500-line limit.

## Regression Risk Assessment

- **code_executes**: LOW risk. All examples use the same APIs. Canvas-based particle images are more likely to work than file paths.
- **api_accuracy**: NO risk. No APIs removed. `scene` added to the options table (it was already a valid option, just undocumented in the baseline table).
- **structural_integrity**: NO risk. Same sections, same order, YAML frontmatter preserved.
- **conciseness**: LOW risk. +72 lines, mostly blockquote warnings and one camera example. Still under 500 lines.
- **no_console_errors**: LOW risk. Canvas-based images eliminate the most common error source (missing image files).
