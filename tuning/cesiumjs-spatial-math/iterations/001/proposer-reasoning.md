# Proposer Reasoning: cesiumjs-spatial-math Iteration 001

## Prior Art Examined

- `cesiumjs-camera/best.json` — 3W/0L/11T with altitude guidance tables, gotcha blockquotes
- `cesiumjs-imagery/best.json` — 4W/0L/0T with widget cleanup, camera setView
- Camera iteration 003: gimbal lock gotcha (-PI/2 safe value) directly relevant to this skill

## Hypotheses

### H1: Cartesian3.normalize zero-length guard (HIGH IMPACT)
**Observation:** `Cartesian3.normalize` throws a `DeveloperError` on zero-length vectors.
This is the most common runtime crash from spatial math in CesiumJS. The Performance Tips
mention "Guard `Cartesian3.normalize`" but a prominent gotcha blockquote near the Vector
Operations section would prevent the error at the point where developers learn the API.

**Proposed change:** Add a gotcha blockquote after the Vector Operations code block warning
about zero-length input and showing the magnitude check pattern.

**Expected impact:** Defensive improvement — prevents the #1 spatial math crash.
**Net lines:** +4

### H2: Radians vs degrees confusion (HIGH IMPACT)
**Observation:** `Cartographic` stores angles in RADIANS, but most developers think in
degrees. The baseline mentions this in Core Concepts and shows `Math.toRadians()` but
doesn't have a prominent warning. When `Cartographic.fromRadians(-105, 40)` is used
(degrees passed as radians), the position wraps to a completely wrong location with no
error. This is a silent failure that produces wrong results.

**Proposed change:** Add a gotcha blockquote in Core Concepts emphasizing that Cartographic
is RADIANS and that passing degrees silently produces wrong positions.

**Expected impact:** HIGH — prevents the most common spatial math bug.
**Net lines:** +4

### H3: Result parameter pattern clarification (MEDIUM IMPACT)
**Observation:** The static-method-with-result pattern is mentioned once in Core Concepts
but not demonstrated consistently. Some operations REQUIRE a result parameter (Matrix4
operations) while others are optional but recommended for performance. The distinction
matters: forgetting a required result parameter throws, while forgetting an optional one
just allocates.

**Proposed change:** Add a brief note clarifying which operations require vs optionally
accept result parameters.

**Expected impact:** TIE (defensive improvement).
**Net lines:** +3

### H4: Transforms.headingPitchRollToFixedFrame heading convention (MEDIUM IMPACT)
**Observation:** Heading 0 = north, increasing clockwise. This is the COMPASS convention,
not the math convention (where 0 = east, increasing counterclockwise). The camera skill's
iteration 003 added a heading convention table that was validated. The spatial-math skill
should have a similar callout since `headingPitchRollToFixedFrame` is covered here.

**Proposed change:** Add a heading convention callout near the HeadingPitchRoll section,
matching the camera skill's validated table format.

**Expected impact:** TIE (prevents heading confusion, validated by camera wins).
**Net lines:** +7

### H5: Matrix4 column-major vs row-major (MEDIUM IMPACT)
**Observation:** The baseline says "Column-major storage (WebGL convention). Constructor
takes row-major for readability." This is a critical distinction — if you build a matrix
manually with `new Matrix4(...)`, the 16 numbers are in ROW-major order for readability,
but the internal storage is column-major. This trips up developers who try to index
elements directly.

**Proposed change:** Add a gotcha blockquote in the Matrix4 section.

**Expected impact:** TIE (defensive improvement).
**Net lines:** +3

## Summary

| Hypothesis | Impact | Lines | Risk |
|---|---|---|---|
| H1: normalize zero-length guard | HIGH | +4 | Zero — callout only |
| H2: Radians vs degrees warning | HIGH | +4 | Zero — callout only |
| H3: Result parameter clarification | MEDIUM | +3 | Zero — callout only |
| H4: Heading convention table | MEDIUM | +7 | Zero — validated by camera |
| H5: Column-major vs row-major | MEDIUM | +3 | Zero — callout only |

Total net lines: +21 (from ~352 baseline to ~373)
