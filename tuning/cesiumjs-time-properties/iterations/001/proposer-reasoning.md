# Iteration 001 — Proposer Reasoning

## Baseline Observations

- Baseline is 353 lines covering Clock, JulianDate, Property system, interpolation, splines, CZML, and a full animated flight example
- All API patterns are correct and well-structured
- Critical gotchas exist in code (e.g., `.clone()`, `shouldAnimate = true`) but are not called out prominently -- a model skimming the doc could miss them
- The "Putting It Together" section creates the Viewer with default navigation widgets enabled

## Hypotheses

### H1: shouldAnimate gotcha (HIGH IMPACT)
**Observation**: `shouldAnimate` defaults to `false` on the Viewer's clock. The baseline sets it to `true` in the Clock example but treats it as just another config line. Developers routinely forget this and conclude their time-dynamic data is broken.
**Change**: Added a prominent `> **Warning:**` blockquote at the top of the Clock section, before the code example. Explains the default, the symptom (entities appear frozen), and both remedies (Viewer constructor option or direct property set).
**Expected**: Models will consistently include `shouldAnimate: true` and understand WHY it's needed, not just copy-paste it.
**Regression risk**: None -- purely additive callout text.

### H2: Widget configuration for time demos
**Observation**: The "Putting It Together" Viewer constructor used `{ shouldAnimate: true }` but left navigation help widgets enabled. Validated pattern from camera/imagery tuning: `navigationHelpButton: false, navigationInstructionsInitiallyVisible: false` reduces visual clutter.
**Change**: Added `navigationHelpButton: false, navigationInstructionsInitiallyVisible: false` to the Viewer constructor in the Putting It Together section. Intentionally kept `animation` and `timeline` widgets ENABLED since they are essential for time-dynamic visualization.
**Expected**: Cleaner generated demos without the help overlay, while preserving the animation/timeline controls users need.
**Regression risk**: Minimal -- only affects constructor options in one example. Does NOT touch animation/timeline.

### H3: JulianDate.clone() for clock times
**Observation**: The baseline uses `.clone()` correctly in its Clock example (`start.clone()`, `stop.clone()`) but doesn't explain why. Without understanding the shared-reference hazard, a model might omit `.clone()` in generated code, especially when the pattern isn't obvious.
**Change**: Added a `> **Warning:**` blockquote after the JulianDate section explaining the shared-reference bug: assigning without `.clone()` means later mutations to the original date silently change the clock's time. Includes a concrete example of the bug.
**Expected**: Models understand clone is not optional and will include it consistently.
**Regression risk**: None -- additive explanation only.

### H4: CallbackProperty isConstant trap
**Observation**: The baseline mentions the second argument "must be `false` if value changes" but this is a single clause buried in a sentence above the code. The bug is extremely subtle: the entity renders correctly on frame 1, then appears frozen, making it look like a completely different problem.
**Change**: Added a `> **Warning:**` blockquote before the CallbackProperty code block. Explains the caching behavior when `isConstant` is `true`, the deceptive symptom (works on first frame, freezes after), and the fix.
**Expected**: Models will never accidentally pass `true` or omit the argument.
**Regression risk**: None -- additive callout.

### H5: SampledProperty interpolation defaults
**Observation**: The baseline mentions "Default: LinearApproximation degree 1" as an inline comment in code. It doesn't warn that the default produces visually broken-looking results for curved paths -- jagged piecewise-linear segments that look like a bug rather than a feature.
**Change**: Added a `> **Warning:**` blockquote after the SampledProperty code block. Explains that default interpolation is linear, producing jagged paths, and that `setInterpolationOptions` with Lagrange degree 5 is required for smooth curves.
**Expected**: Models will always pair `SampledPositionProperty` with `setInterpolationOptions` for flight/orbit scenarios.
**Regression risk**: None -- additive. The existing code example already shows setInterpolationOptions.

### H6: timeline.zoomTo prerequisite
**Observation**: The baseline calls `viewer.timeline.zoomTo(start, stop)` after setting clock times, which is correct. But it doesn't call out that the ORDER matters. If a model rearranges the code (e.g., moving `zoomTo` before clock setup), the timeline shows the wrong range.
**Change**: Added inline comment `// MUST be called AFTER setting clock start/stop` to the zoomTo line in the Clock section. Also added a `> **Warning:**` blockquote below the code block explaining the ordering dependency.
**Expected**: Models maintain correct ordering and understand why.
**Regression risk**: None -- additive comment and callout.

## Changes Applied
- JulianDate section: added `.clone()` shared-reference gotcha blockquote
- Clock section: added `shouldAnimate` gotcha blockquote (before code), added inline comment on `shouldAnimate = true` line, added inline comment on `timeline.zoomTo` line, added `timeline.zoomTo` ordering gotcha blockquote (after code)
- SampledProperty section: added interpolation defaults gotcha blockquote
- CallbackProperty section: added `isConstant` caching trap gotcha blockquote
- Putting It Together: added `navigationHelpButton: false, navigationInstructionsInitiallyVisible: false` to Viewer constructor (kept animation/timeline enabled)

## Line Count
- Baseline: 353 lines
- Iteration 001: ~395 lines (well under 500 limit)
- Net addition: ~42 lines (6 gotcha blockquotes + 2 inline comments + 2 constructor options)
