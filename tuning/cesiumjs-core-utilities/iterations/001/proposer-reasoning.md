# Proposer Reasoning: cesiumjs-core-utilities Iteration 001

## Prior Art Examined

- `cesiumjs-camera/best.json` — 3W/0L/11T with gotcha blockquotes
- `cesiumjs-imagery/best.json` — 4W/0L/0T with widget cleanup
- Core-utilities is the least visual skill — optimization focuses on code correctness gotchas

## Hypotheses

### H1: defaultValue removal emphasis (HIGH IMPACT)
**Observation:** The breaking change section at the top is good, but many codebases
still have `defaultValue` calls from pre-v1.134 code. Generated code should NEVER use
`defaultValue` — it was removed. The baseline shows the migration but could make the
warning more prominent with a gotcha blockquote.

**Proposed change:** Add a gotcha blockquote emphasizing this is a BREAKING change and
any code using `defaultValue` will throw a ReferenceError.

**Expected impact:** HIGH — prevents the most common migration error.
**Net lines:** +3

### H2: Resource.fetchJson error handling (HIGH IMPACT)
**Observation:** The baseline shows `Resource.fetchJson` and `resource.fetchJson()` but
doesn't show error handling. When a fetch fails (404, network error), it throws a
RuntimeError. Generated code should always wrap async resource fetches in try/catch.
The error handling section shows this for tileset loading but not for Resource directly.

**Proposed change:** Add a gotcha after the fetching section about always wrapping
Resource fetch calls in try/catch.

**Expected impact:** Defensive improvement — prevents unhandled promise rejections.
**Net lines:** +4

### H3: Color constant mutation warning (MEDIUM IMPACT)
**Observation:** `Color.RED` and other named constants are FROZEN. Calling
`Color.RED.withAlpha(0.5)` is fine (returns new Color), but trying to modify
`Color.RED.alpha = 0.5` throws in strict mode or silently fails. The Performance Tips
mention "Never mutate frozen Color constants" but this needs a gotcha near the Color
section where developers first encounter constants.

**Proposed change:** Add a gotcha blockquote in the Color section.

**Expected impact:** TIE (defensive improvement).
**Net lines:** +3

### H4: defined() vs truthiness (MEDIUM IMPACT)
**Observation:** `defined(value)` correctly returns `false` only for `null` and
`undefined`, while truthiness checks (`if (value)`) also reject `0`, `""`, and `false`.
This distinction matters when checking CesiumJS properties that can legitimately be 0
(like heights or alpha values). The Performance Tips mention this but a callout near
the `defined` section would be more visible.

**Proposed change:** Add a brief note in the Helper Functions section.

**Expected impact:** TIE (prevents subtle bugs).
**Net lines:** +3

### H5: EventHelper cleanup pattern (MEDIUM IMPACT)
**Observation:** `EventHelper.removeAll()` is the cleanup analog of
`ScreenSpaceEventHandler.destroy()`. In SPAs, forgetting to call `removeAll()` leaks
event listeners. The baseline shows the pattern but doesn't call it out as critical
for component cleanup.

**Proposed change:** Add a note connecting EventHelper cleanup to SPA lifecycle.

**Expected impact:** TIE (defensive improvement).
**Net lines:** +2

## Summary

| Hypothesis | Impact | Lines | Risk |
|---|---|---|---|
| H1: defaultValue removal emphasis | HIGH | +3 | Zero — callout only |
| H2: Resource fetch error handling | HIGH | +4 | Zero — callout only |
| H3: Color constant mutation | MEDIUM | +3 | Zero — callout only |
| H4: defined() vs truthiness | MEDIUM | +3 | Zero — callout only |
| H5: EventHelper cleanup | MEDIUM | +2 | Zero — callout only |

Total net lines: +15 (from ~401 baseline to ~416)
