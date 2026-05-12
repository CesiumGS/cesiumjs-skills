# Iteration 004 — Proposer Reasoning

## Files Examined
- iterations/001/SKILL.md, proposer-reasoning.md, decision.json
- iterations/002/SKILL.md, proposer-reasoning.md, decision.json
- iterations/003/SKILL.md, proposer-reasoning.md, decision.json
- iterations/001/traces/eval-002/screenshot-after_load.png (tooltip visible)
- tuning/METHODOLOGY.md (sections 6.3, 8.2-8.5)

## Trace Review Summary

### Iter-001 (KEPT, current best): Widget disable + altitude table
- 2 wins (003-London zoom, 009-DC detail), 1 loss (002-Paris tooltip), 1 tie
- Navigation help tooltip appeared in eval-002, caused confirmed regression

### Iter-002 (DISCARDED): Tooltip fix + altitude category split
- Tooltip fix VALIDATED (no tooltip in any screenshot)
- Altitude split REGRESSED (3 losses — judges want wider city views, not 3-8km tight zoom)
- Lesson: Do NOT split altitude table

### Iter-003 (DISCARDED): Tooltip fix only (same as iter-004 intent)
- Tooltip fix confirmed working, but PNG vs JPEG format confound dominated
- ALL 3 judges cited sharpness differences, ignoring the actual content change
- Lesson: MUST use same screenshot format (PNG) for baseline and candidate

## Hypothesis for Iteration 004

**Single change: Add `navigationInstructionsInitiallyVisible: false` to the Quick Start viewer constructor.**

- **Observation**: Iter-001 eval-002 (Paris) lost because navigation tooltip partially obscured the map
- **Root cause**: The Viewer shows a "Pan view / Zoom view / Rotate view" tooltip by default. Iter-001 disabled timeline/animation but not this tooltip.
- **Proposed change**: Add one line to the viewer constructor example
- **Expected impact**: Eval-002 should no longer regress. Other evals unaffected.
- **Regression risk**: Minimal — only adds a constructor option
- **Confound prevention**: Using PNG for ALL screenshots (not JPEG) to avoid iter-003's format confound

This is the same fix as iter-003, but with the format confound eliminated.
