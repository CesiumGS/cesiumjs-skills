# Iteration 001 — Proposer Reasoning

## Baseline Observations

- 8/15 full pass, 7 partial (6 Ion token access, 1 NASA GIBS service)
- All 15 code generations used correct API patterns — the skill teaches APIs well
- Zero runtime crashes or code generation failures

## Hypotheses

### H1: Viewer widget clutter (low risk, visible impact)
**Observation**: All baseline code creates `new Viewer("cesiumContainer")` with default widgets (animation, timeline, help). These consume screen space and distract from imagery.
**Change**: Add `animation: false, timeline: false` to Quick Start example.
**Expected**: Cleaner screenshots, more imagery visible.
**Regression risk**: Minimal — only affects viewer constructor options.

### H2: setView vs flyTo timing (medium risk, correctness impact)
**Observation**: Some baseline evals used `flyTo` which animates. If screenshot delay is too short, camera may not have arrived.
**Change**: Add explicit guidance preferring `setView` for immediate positioning. Add prose above Quick Start code.
**Expected**: More predictable camera positions in generated code.
**Regression risk**: Low — models may still choose flyTo for animated scenarios.

### H3: Camera altitude guidance (medium risk, visual quality impact)
**Observation**: Eval-003 used 800km altitude for "centered on London" showing all of England. No altitude guidance existed.
**Change**: Add camera height reference table: street (500-2000m), city (5000-25000m), metro (50-200km), region (300-1500km), continent (3-8M m).
**Expected**: More appropriate zoom levels per geographic context.
**Regression risk**: Low — table is advisory, not prescriptive.

### H4: Base layer swap completeness
**Observation**: The base layer swap example was terse and missing credit/maximumLevel.
**Change**: Expanded example with credit, maximumLevel, and explanatory comment.
**Expected**: More complete generated swap patterns.
**Regression risk**: Minimal.

## Changes Applied
- Quick Start: added widget-disable pattern, setView usage, altitude table
- Swapping Base Layer: expanded with credit, maximumLevel
