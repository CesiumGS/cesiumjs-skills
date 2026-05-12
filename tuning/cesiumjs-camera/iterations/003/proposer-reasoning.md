# Iteration 003 Proposer Reasoning

**Date:** 2026-04-08
**Base:** iteration 002 SKILL.md (500 lines)
**Result:** iteration 003 SKILL.md (500 lines)

---

## Changes Applied

### H1: Cardinal Direction Reference Table for lookAt Heading

**What changed:**
- Added a 4-row cardinal direction reference table immediately after the two `lookAt` code examples, before the `lookAtTransform(Matrix4.IDENTITY)` release example.
- Table columns: "To view from...", "Camera faces...", "Heading (deg)", "Heading (rad)".
- Added a one-line summary beneath the table: heading = direction camera faces; camera is positioned opposite.
- Removed the previous inline blockquote that conveyed the same info in prose (`> **lookAt heading:** heading = direction camera **faces**...`). The table replaces it more clearly.

**Why:** The mapping between heading value, viewing direction, and camera position is the single most confusing aspect of `lookAt`. A scannable table is faster to reference than prose, and the radian column prevents conversion errors. The previous prose-based callout is now redundant since the table conveys the same information more precisely.

**Line budget impact:** +7 lines (table + summary), -4 lines (removed old prose callout). Net: +3 lines.

---

### H2: Gimbal Lock Warning + Safe Pitch Value

**What changed:**
- Added a blockquote warning in the Camera Fundamentals section (after the top-down views paragraph): "Never use `pitch: -Math.PI/2` exactly. Use `-(Math.PI / 2 - 0.0001)`..."
- Added a new `setView` code example showing the safe top-down pitch value with `-(Math.PI / 2 - 0.0001)` and an inline comment explaining why.
- Updated the "Overhead / map view" row in the Common Patterns Quick Reference table to show `-(Math.PI/2 - 0.0001)` instead of `pitch -90`.

**Why:** Exact pitch of -PI/2 is a known gimbal lock singularity in CesiumJS (GitHub issue #2468). Heading becomes undefined, causing erratic camera behavior. The 0.0001 radian offset (~0.006 degrees) is invisible but avoids the singularity. This prevents a real production bug.

**Line budget impact:** +2 lines (compact warning) + combined setView example with Rectangle form. Net: ~0 lines (the new top-down example replaces the old Rectangle-only example and merges both into one code block).

---

### H3: OSM Buildings Callout for City Views

**What changed:**
- Added a prominent blockquote in the Camera Fundamentals section (before the altitude table): "City views need 3D buildings. For skyline, street-level, or urban panorama views, add `Cesium.createOsmBuildingsAsync()`..."
- Updated the "City panoramic / skyline" row in the altitude table to include bold text: "**Requires OSM Buildings or 3D Tiles**".
- Updated the "Skyline panoramics" blockquote to end with "**Add `Cesium.createOsmBuildingsAsync()` for 3D silhouette.**"
- Updated the "City skyline / panoramic" row in the Common Patterns Quick Reference to include "**Load OSM Buildings.**"

**Why:** eval-005 (NYC skyline) demonstrated that the presence of OSM Buildings guidance was the single biggest driver of visual quality for city views. This change reinforces the guidance at four touchpoints so the LLM encounters it regardless of which section it reads first. The callout is deliberately placed early in Camera Fundamentals so it's seen before any code examples.

**Line budget impact:** +4 lines (compact blockquote). Existing ground-level and skyline blockquotes were tightened to offset. Table changes are inline edits.

---

### H4: maximumZoomDistance + enableCollisionDetection Gotcha

**What changed:**
- Added a blockquote warning in the Constraining Navigation subsection, immediately after the constraint code example: "`maximumZoomDistance` is silently ignored when `enableCollisionDetection = false`..."
- Included a workaround suggestion: re-enable collision detection after underground views, or enforce zoom limits manually in a `clock.onTick` listener.

**Why:** This interaction is confirmed in CesiumJS source code (issue #10303) and is a known gotcha that trips developers who disable collision detection for underground views but expect zoom limits to still work. The skill previously documented both properties independently without mentioning the interaction.

**Line budget impact:** +3 lines (compact blockquote).

---

### H5: flyHome Orientation Limitation + Workaround

**What changed:**
- Added a compact blockquote explaining the limitation and workaround: "flyHome() always produces a top-down, north-up view -- no orientation control. Workaround: intercept `viewer.homeButton.viewModel.command.beforeExecute`, cancel it, and call `flyTo` with custom orientation."
- Kept the workaround as prose rather than a code block to save lines.

**Why:** CesiumJS issue #6134 confirms flyHome has no orientation parameter. Developers who try to set heading/pitch on their home view discover this through trial and error. The workaround (intercepting `HomeButton.viewModel.command.beforeExecute`) is not obvious and saves significant debugging time.

**Line budget impact:** +3 lines (compact limitation note with inline workaround).

---

## Summary

All five hypotheses were applied as additive changes. To stay within the 500-line
budget, existing prose was tightened throughout (shorter blockquotes, compressed
descriptions for setView/flyTo/lookAt/first-person-controls sections, combined
code examples, trimmed performance tips). No API coverage was removed.

**Final line count:** 500 lines (at the upper bound of the 300-500 target).

## Sections Preserved

All required sections from iteration 002 remain:
- Camera Fundamentals (with Altitude & Orientation Guidelines)
- setView
- flyTo
- flyHome
- lookAt
- lookAtTransform
- flyToBoundingSphere / viewBoundingSphere
- Movement, Rotation, Look, and Zoom Methods
- ScreenSpaceCameraController (Constraining Navigation + Remapping Input Events)
- Custom First-Person Controls
- Camera Events
- pickEllipsoid
- Entity Tracking
- Performance Tips
- Common Patterns Quick Reference
- See Also

## API Coverage Preserved

No API methods, properties, or patterns were removed. All changes are additive (new warnings, tables, code examples) or in-place edits to existing content.
