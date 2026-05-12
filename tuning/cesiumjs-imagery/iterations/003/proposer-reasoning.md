# Iteration 003 — Proposer Reasoning

## Files Examined
- iterations/001/SKILL.md (current best, 456 lines)
- iterations/001/decision.json (keep: 2W/1L/1T)
- iterations/002/SKILL.md (discarded)
- iterations/002/decision.json (discard: critical regression on 3 evals)
- All 15 generated-code-002.js files from iteration 002
- Screenshots: eval-001, eval-002, eval-003, eval-009 from iteration 002

## Trace Analysis from Iteration 002 (DISCARDED)

### What went wrong:
The `baseLayer: false` constructor pattern (H2 from iter-002) was adopted by the
model in evals 002, 003, and 009. All three showed satellite imagery instead of
the expected replacement tiles (OSM or ArcGIS). The replacement layers were added
correctly in code but didn't render visually.

Possible root causes:
1. Generated code wraps in its own `(async () => { ... })()` which nests inside
   the eval template's async IIFE. This may cause timing issues where the viewer
   is created but imagery layers aren't resolved before the screenshot.
2. `baseLayer: false` might interact differently with `imageryLayers.add(layer, 0)`
   vs the runtime `remove(get(0))` then `add(layer, 0)` pattern.

### What went right:
- `navigationHelpButton: false` and `navigationInstructionsInitiallyVisible: false`
  worked perfectly — eval-001 iter-002 had a completely clean viewport.
- This fix should resolve the eval-002 regression from iter-001 (help tooltip).

## Hypotheses

### H1: Navigation tooltip suppression (carry forward from iter-002, validated)
- Add `navigationHelpButton: false, navigationInstructionsInitiallyVisible: false`
- This was validated in iter-002 even though the iteration was discarded overall.

### H2: Keep remove+add pattern only (revert iter-002's baseLayer: false)
- Do NOT introduce `baseLayer: false` — it caused critical regressions.
- Keep only the proven `remove(get(0))` then `add(layer, 0)` pattern.

## Changes Applied (from iter-001 base)
- Quick Start viewer: added `navigationHelpButton: false` and
  `navigationInstructionsInitiallyVisible: false` (the ONLY change)
- NO changes to base layer swap section (keep iter-001's working pattern)
- This is a minimal, targeted fix to address the iter-001 eval-002 regression
  without introducing new risk.
