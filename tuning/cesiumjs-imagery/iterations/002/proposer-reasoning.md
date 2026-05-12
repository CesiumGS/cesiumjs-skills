# Iteration 002 — Proposer Reasoning

## Files Examined
- iterations/000-baseline/SKILL.md (414 lines)
- iterations/001/SKILL.md (diff: +68 lines, camera table, widget cleanup)
- iterations/001/proposer-reasoning.md (4 hypotheses)
- iterations/001/decision.json (keep: 2W/1L/1T)
- All 15 generated-code-001.js files from iteration 001
- Baseline screenshots for evals 002, 003, 009, 010
- Iteration 001 screenshots for evals 002, 003, 009, 010

## Trace Analysis

### Pattern adoption from iter-001 mutations:
- 14/15 evals correctly adopted `animation: false, timeline: false`
- 1/15 (eval-012) correctly kept `animation: true` for time-dynamic content
- 15/15 evals used `camera.setView` instead of `flyTo`
- Camera altitudes aligned with the height reference table across all evals
- The model faithfully followed the skill's patterns

### Identified issues in iter-001 code:
1. **Navigation tooltip visible**: eval-002 screenshot showed the "Pan view / Zoom view / Rotate view" help tooltip in the upper-right, causing a judge-confirmed regression
2. **Remove-then-add pattern**: evals 004, 005, 009, 013 used `imageryLayers.remove(get(0))` then `add(..., 0)` instead of `baseLayer: false` in constructor — loads and discards the default Bing tiles unnecessarily
3. **eval-009**: Baseline used `baseLayer: ImageryLayer.fromProviderAsync(...)` in the constructor (clean). Iter-001 switched to remove+add (less clean). This was because the skill's "Swapping" section only showed remove+add.

## Hypotheses

### H1: Suppress navigation help tooltip (fixes known regression)
- **Observation**: eval-002 iter-001 judges flagged "help tooltip overlay adds UI clutter"
- **Root cause**: `navigationInstructionsInitiallyVisible` defaults to `true`. The tooltip appeared because we removed timeline/animation but left the help button.
- **Change**: Add `navigationHelpButton: false, navigationInstructionsInitiallyVisible: false` to clean viewer pattern.
- **Expected impact**: eval-002 regression fixed. All evals get 100% clean viewport.
- **Regression risk**: Minimal — removes only UI chrome.

### H2: Add `baseLayer: false` constructor pattern
- **Observation**: 4 evals used remove+add pattern. This briefly loads default Bing tiles (wasted network request) and is more code.
- **Root cause**: The "Swapping the Base Layer" section only showed the runtime remove+add pattern, not the constructor-time `baseLayer: false` option.
- **Change**: Add Option A (`baseLayer: false`) as the preferred pattern, keep Option B (remove+add) as the runtime alternative.
- **Expected impact**: Cleaner generated code for evals that replace the base layer entirely.
- **Regression risk**: Low — model may choose either pattern based on context.

## Changes Applied
- Quick Start: added `navigationHelpButton: false` and `navigationInstructionsInitiallyVisible: false`
- Swapping the Base Layer: restructured as Option A (baseLayer: false, preferred) and Option B (remove+add, runtime)
