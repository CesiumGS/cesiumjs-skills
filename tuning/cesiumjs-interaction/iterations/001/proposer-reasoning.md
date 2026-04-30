# Proposer Reasoning: cesiumjs-interaction Iteration 001

## Prior Art Examined

- `cesiumjs-camera/iterations/003/SKILL.md` — widget cleanup, altitude guidance, gotcha blockquotes
- `cesiumjs-imagery/iterations/003/SKILL.md` — widget cleanup (4-0 win), camera setView guidance
- `cesiumjs-camera/best.json` — 3W/0L/11T
- `cesiumjs-imagery/best.json` — 4W/0L/0T

## Hypotheses

### H1: Widget cleanup in viewer-dependent examples (HIGH IMPACT)
**Observation:** The interaction skill doesn't construct its own Viewer, but many recipes
implicitly assume one exists. Generated code that creates a Viewer for interaction demos
will inherit the default widgets (animation, timeline, navigation help), cluttering the
viewport and potentially obscuring the picking results.

**Proposed change:** Add a "Quick Start" preamble at the top of the Recipes section showing
the clean Viewer pattern with disabled widgets, camera.setView for immediate positioning.
This matches the imagery iter-003 pattern that produced a 4-0 win.

**Expected impact:** Cleaner screenshots for all recipe evals. No regressions expected since
this is purely additive.

**Net lines:** +10

### H2: pickPosition requires depthTestAgainstTerrain for terrain accuracy (HIGH IMPACT)
**Observation:** Recipe 3 (Terrain Position Picking) uses `camera.pickEllipsoid` which
only picks the WGS84 ellipsoid surface, ignoring terrain. The baseline mentions
`scene.pickPosition` for 3D content but doesn't connect the dots: for accurate terrain
picking, `depthTestAgainstTerrain: true` is essential. Without it, `pickPosition` returns
positions on the render surface, which may be above or below actual terrain.

**Proposed change:** Add a gotcha blockquote after the pick methods section explaining:
- `pickEllipsoid` → ellipsoid surface (ignores terrain)
- `pickPosition` → depth buffer (needs `depthTestAgainstTerrain: true` for terrain)
- When both terrain and 3D Tiles are present, `pickPosition` with depth test gives best results

**Expected impact:** WIN on terrain picking evals where accurate heights matter.

**Net lines:** +6

### H3: MOUSE_MOVE handler memory pattern (MEDIUM IMPACT)
**Observation:** Several recipes store state in a `highlighted` object with `feature` and
`originalColor`. This pattern works but has a subtle bug: if the user moves the mouse
rapidly, the previous feature's color may not be restored before a new feature is highlighted.
The recipes correctly handle this, but don't warn about the common mistake of forgetting
to restore the previous color.

**Proposed change:** Add a brief gotcha note about always restoring the previous color
BEFORE setting the new one. This is already shown in the code but making it explicit
as a callout ensures the pattern is followed in generated code.

**Expected impact:** TIE (defensive improvement). Prevents visual artifacts in production.

**Net lines:** +3

### H4: handler.destroy() is critical for SPAs (MEDIUM IMPACT)
**Observation:** The baseline mentions `handler = handler && handler.destroy()` but only
in the first example. In an SPA (Single Page Application), failing to destroy handlers
causes memory leaks and ghost event listeners. This is the #1 support issue for CesiumJS
in React/Angular apps.

**Proposed change:** Add a gotcha blockquote early in the file emphasizing the destroy
pattern and specifically mentioning SPA/React/Angular cleanup.

**Expected impact:** TIE (defensive improvement for production use).

**Net lines:** +4

### H5: drillPick limit parameter (MEDIUM IMPACT)
**Observation:** `drillPick` without a `limit` parameter re-renders the scene for every
overlapping object, which can be extremely expensive. The performance tips mention this
but a gotcha blockquote near the drillPick code would be more visible.

**Proposed change:** Add inline comment and gotcha near the drillPick usage.

**Expected impact:** TIE (performance improvement, not visually testable).

**Net lines:** +2

## Summary

| Hypothesis | Impact | Lines | Risk |
|---|---|---|---|
| H1: Widget cleanup + camera setView | HIGH | +10 | Zero — additive |
| H2: pickPosition + depthTest gotcha | HIGH | +6 | Zero — informational |
| H3: MOUSE_MOVE color restore pattern | MEDIUM | +3 | Zero — callout only |
| H4: handler.destroy() for SPAs | MEDIUM | +4 | Zero — callout only |
| H5: drillPick limit warning | MEDIUM | +2 | Zero — callout only |

Total net lines: +25 (from ~401 baseline to ~426)
