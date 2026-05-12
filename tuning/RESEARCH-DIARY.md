# Research Diary: Self-Optimizing Skill Prompts via Meta-Harness

A working record of decisions, discoveries, and methodology evolution as we develop
an automated system for optimizing LLM skill documents using the Meta-Harness
blueprint.

---

## 2026-04-08: Project Inception

### Motivation

We have 14 CesiumJS skill documents (~400 lines each, ~5,200 lines total) that serve
as passive reference material for Claude when generating CesiumJS code. These skills
are hand-written and have never been systematically evaluated or optimized. The
question: can we build an automated system that iteratively improves these skills by
measuring their real-world effectiveness?

### Foundational Research

We studied 15+ prompt optimization frameworks (DSPy, TextGrad, OPRO, PromptBreeder,
SCULPT, SPO, PromptWizard, EvoPrompt, etc.) and two key projects:

1. **AutoResearch** (Karpathy, 2025) — Greedy hill-climbing with git-based state
   management. An LLM proposes changes to code, evaluates against a single metric,
   keeps or discards. The human writes `program.md` (meta-instructions), not the
   research artifact itself.

2. **Meta-Harness** (Lee et al., Stanford, 2026) — End-to-end optimization of model
   harnesses via agentic search. The key innovation: **full filesystem access to all
   prior experience** (source code, execution traces, scores) beats compressed feedback
   by 15+ points (Table 3: 50.0% vs 34.6% for scores-only).

### Key Design Decision: LLM-as-Researcher, Not Algorithmic Mutation

We explicitly rejected TextGrad, SCULPT, and evolutionary approaches. The LLM is the
optimizer — it reads prior iterations' artifacts, traces, and scores, forms hypotheses,
and proposes changes. No mutation operators, no search heuristics. This follows both
Meta-Harness (Section 3: "the proposer is not a raw next-token model... it is an agent
that retrieves information, navigates prior artifacts, and edits code") and Karpathy's
AutoResearch philosophy ("program the researcher, not the research").

### Evaluation Architecture

We designed a multi-axis evaluation system:
- **Programmatic checks** (deterministic): code runs, no errors, correct API patterns
- **Visual verification** (multimodal): screenshots evaluated by Claude vision
- **Structural integrity** (deterministic): SKILL.md format, line count, sections

The evaluation harness renders CesiumJS code in a headless Chrome browser via the
Chrome DevTools MCP server, captures screenshots, and scores them.

---

## 2026-04-08: Tracer Bullet — cesiumjs-viewer-setup

### Setup

7 eval scenarios designed for the viewer-setup skill:
- 3 fundamentals (basic globe, no widgets, production NYC with OSM buildings)
- 4 trap scenarios (Google ToS, baseLayerPicker dependency, space scene, low-power)

### Baseline Results (3 evals, aggregate: 0.9469)

All code ran without errors. Visual scores were excellent (1.0, 1.0, 0.9625).
The api_accuracy score was artificially depressed (0.75) by CDN eval environment
artifacts — the skill teaches ES module imports but the eval runs CesiumJS via CDN.

### Iteration 001 → DISCARD

The proposer made 16 targeted changes (callouts, dependency traps, formatting). The
aggregate was essentially unchanged (0.9469 → 0.9456). The proposer correctly
identified that its changes target evals 004-007 (which weren't run in the tracer
bullet).

### Lesson Learned: CDN Import Mismatch

The eval environment uses `Cesium.Viewer` (CDN globals) while the skill teaches
`import { Viewer } from "cesium"` (ES modules). This creates false negatives in
pattern matching. For future evals, we need patterns that match both styles.

---

## 2026-04-08: First Successful Optimization — cesiumjs-camera

### Setup

5 eval scenarios:
1. flyTo Paris (easy)
2. setView Grand Canyon (medium)
3. Constrain navigation London (medium)
4. lookAt Rome with lock/unlock (hard — trap)
5. Chained flyTo NYC (hard)

### Baseline Results (aggregate: 0.975)

Perfect programmatic scores (36/36 checks, 1.0). Visual scores ranged 0.82-0.95.
The weakest: **eval-003 (London constrained nav) at 0.82**.

### Root Cause Analysis (by Proposer)

The proposer traced eval-003's low visual score to a specific root cause:

> The baseline SKILL.md's only `setView` example used 15,000m altitude (for San
> Diego). The constraining-navigation section had no `setView` call at all. The LLM
> had no city-view example to pattern-match against, so it copied the 15,000m altitude.
> At 15km with -45° pitch, London is an indistinguishable patch of green/brown.

### The Fix: Altitude Guidelines Table

The proposer added an explicit altitude/orientation guidelines table:

| View Type  | Altitude      | Pitch        | Use Case               |
|-----------|---------------|--------------|------------------------|
| Landmark  | 500-1,500 m   | -25 to -35°  | Single building/monument |
| City      | 2,000-5,000 m | -45 to -60°  | Urban overview           |
| Metro     | 8,000-20,000 m| -60 to -90°  | Regional view            |
| Country   | 50,000+ m     | -80 to -90°  | National-scale           |

Plus the directive: "When the prompt says 'looking at [city]', default to city
overview range (2,000-5,000 m) with pitch -45 to -60."

### Result: eval-003 Improved 0.82 → 0.918 (+0.098)

The LLM now generates code with 3,000m altitude and -50° pitch for London instead
of 15,000m/-45°. The screenshot shows recognizable urban detail (Hyde Park, rail
stations, street grids) vs. the baseline's indistinguishable green blob.

### Decision: KEEP (despite aggregate dip 0.975 → 0.969)

---

## 2026-04-08: Critical Methodology Discovery — Judge Variance Problem

### The Problem

Despite a genuine improvement on eval-003 (+0.098), the aggregate score *decreased*
(0.975 → 0.969). This is because the visual judge gave different scores to
*functionally identical* screenshots across runs:

| Eval | Baseline Visual | Iter 001 Visual | Code Changed? |
|------|----------------|-----------------|---------------|
| 001 (Paris) | 0.950 | 0.915 | No |
| 002 (Grand Canyon) | 0.900 | 0.793 | No |
| 003 (London) | 0.820 | 0.918 | **Yes** |
| 004 (Rome) | 0.930 | 0.885 | No |
| 005 (NYC) | 0.900 | 0.873 | No |

The Grand Canyon screenshot was scored 0.90 in one run and 0.793 in the next, despite
showing the same scene. This is pure LLM judge variance — estimated at ±0.05-0.10 per
evaluation.

### Why This Matters

With 5 evals and ±0.10 judge variance, a single unlucky swing on one eval can flip
the aggregate direction. The absolute scoring approach (0.0-1.0) is fundamentally too
noisy for detecting small improvements.

### The Fix: Pairwise Comparison

Instead of asking "score this screenshot 0-1" for each iteration independently, we
will switch to **pairwise comparison**: show the judge BOTH screenshots (baseline and
candidate) side by side and ask "which better matches the expected outcome?"

This eliminates absolute calibration noise. The judge doesn't need to assign a number
— it just picks a winner. This is the approach used by SPO (Self-supervised Prompt
Optimization, EMNLP 2025), which achieves reliable results with only 3 samples.

### Supporting Research

- **Meta-Harness** uses 3 samples per problem and reports median + best
- **SPO** achieves results with only 3 pairwise samples at 1.1-5.6% of TextGrad's cost
- **Research consensus**: 3 independent judgments with majority vote is the standard
  for reliable pairwise LLM evaluation
- **Pairwise is more stable** than pointwise with smaller variance between LLM and
  human annotations (Zheng et al., 2023)

### Implementation Plan

1. For each eval scenario, present the judge with:
   - The eval's visual expectations
   - Screenshot A (baseline) and Screenshot B (candidate)
   - Randomize A/B order to prevent position bias
2. Ask: "Which screenshot better matches the expected outcome? Respond A, B, or TIE."
3. Run 3 independent judgments per eval
4. Majority vote determines winner per eval
5. Count wins across evals: if candidate wins more evals than baseline → KEEP

This approach is:
- **Cheaper** (binary choice vs. multi-dimensional scoring)
- **More robust** (relative comparison is easier than absolute calibration)
- **Less noisy** (the London improvement is obvious in pairwise — no reasonable judge
  would prefer the 15km blob over the 3km city view)

---

## What Makes This Groundbreaking

1. **First application of Meta-Harness methodology to skill document optimization.**
   Meta-Harness was designed for harness code (Python programs). We've adapted it
   for long-form instructional documents (~400 lines of Markdown).

2. **Full-stack evaluation with visual verification.** Unlike existing prompt
   optimization (which uses task accuracy on classification/math), our eval pipeline
   generates code, renders it in a real browser, takes screenshots, and judges the
   visual output. This is end-to-end evaluation of a skill's effectiveness.

3. **The optimization target is wording, not code.** A single wording change
   ("default to city overview range 2,000-5,000m") caused a measurable improvement
   in generated code quality. This demonstrates that skill documents can be
   systematically optimized, not just hand-tuned.

4. **Causal reasoning from traces.** The proposer identified a specific root cause
   ("the only setView example used 15,000m, so the LLM copied that altitude") by
   examining the generated code traces. This is the same diagnostic capability
   that Meta-Harness credits for its 10x speedup over other optimizers.

5. **Discovery of judge variance problem and pivot to pairwise comparison.** The
   first run revealed that absolute visual scoring is too noisy for incremental
   optimization. We pivoted to pairwise comparison mid-experiment — this mirrors
   the Meta-Harness philosophy of adapting the search loop based on observed behavior.

---

## 2026-04-08: Methodological Correction — 3 Parallel Independent Judges

### The Flaw

Our initial pairwise comparison implementation used a SINGLE agent to judge all eval
pairs sequentially. This introduces three sources of bias:

1. **Anchoring** — the agent's judgment on eval-001 influences its judgment on eval-002
2. **Consistency pressure** — the agent may try to be "consistent" across judgments
   rather than evaluating each pair independently
3. **Fatigue** — later judgments may be less careful than earlier ones

### The Fix (Non-Negotiable)

For EVERY pairwise comparison step, we MUST launch **3 independent sub-agents in
parallel**. Each agent:
- Sees only ONE pair of screenshots (baseline vs candidate) for ONE eval
- Has no shared context with the other judges
- Returns A/B/TIE with a one-sentence rationale

Majority vote (2-of-3) determines the winner per eval. All 3 individual verdicts are
stored for auditability.

This matches:
- Meta-Harness: 3 samples per problem for math evals
- SPO: 3 pairwise samples for reliable optimization
- Research consensus: 3 independent judgments with majority vote

### Impact on Cost

For 8 eval scenarios: 8 × 3 = 24 judge calls per iteration (vs 8 with single agent).
The 3× cost increase is justified by the dramatic improvement in reliability. Parallel
execution means wall-clock time is roughly the same.

---

## 2026-04-08: Camera v2 — Iconic Landmarks Eval Suite

### Redesigned Eval Suite

Replaced the 5 generic camera evals with 8 focused landmark scenarios:

| # | Landmark | Perspective | Camera API |
|---|----------|------------|------------|
| 001 | Eiffel Tower | Ground level | setView |
| 002 | Eiffel Tower | Aerial bird's eye | setView |
| 003 | Eiffel Tower | From south, lookAt | lookAt |
| 004 | Empire State | From east, lookAt | lookAt |
| 005 | NYC Skyline | Panoramic from Hudson | setView/flyTo |
| 006 | Grand Canyon | South rim perspective | setView |
| 007 | Grand Canyon | Aerial overview | setView |
| 008 | Empire State | From north, lookAt | lookAt |

### Key Discovery: 3D Tiles Transform City Views

The most dramatic improvement came from iteration 002's guidance to load OSM Buildings
for city views. The NYC skyline eval went from a flat satellite grid to a 3D
cityscape with recognizable skyscrapers. This was caused by a single addition to the
skill: suggesting `createOsmBuildingsAsync()` when the user asks for a city panorama.

Before (flat grid): eval-005 baseline
After (3D skyline): eval-005 iteration 002

This demonstrates that skill optimization can affect not just camera parameters but
the entire scene composition — a much broader impact than expected.

---

## 2026-04-08: Coverage Analysis — Ensuring Complete Skill Testing

### The Problem

Our eval scenarios were designed ad-hoc based on "interesting" test cases. This risks
leaving entire sections of the SKILL.md untested. For a 400-line skill with 19+
sections, we need systematic coverage tracking.

### Solution: Deterministic Coverage Analyzer

Built `tools/coverage-analyzer.py` — a script that:

1. **Parses SKILL.md** into sections by heading level
2. **Extracts code blocks and API references** from each section
3. **Cross-references with eval scenarios** to find which evals exercise which sections
4. **Produces a coverage report** with percentage and uncovered section list

First run on cesiumjs-camera revealed **78.9% coverage (15/19 sections)** with
critical gaps in ScreenSpaceCameraController (constraining navigation, remapping input
events).

### Naming Convention Improvement

Adopted human-readable directory naming throughout the tuning tree:

**Before:** `iterations/000-baseline/traces/eval-001/`
**After:** `iterations/000-baseline/traces/eval-001-eiffel-ground-level/`

This makes the file tree scannable at a glance — you can see what each eval tests
without opening JSON files. Same applies to screenshot filenames and top-level
skill directories.

### Coverage-Driven Eval Design

Going forward, the eval design process is:

1. Run coverage analyzer on the SKILL.md
2. Identify uncovered sections
3. Design eval scenarios that specifically exercise uncovered sections
4. Each section should have at least 2 eval scenarios covering different aspects
5. Re-run coverage analyzer to verify ≥90% coverage before starting optimization

This is analogous to code coverage in testing — you don't optimize what you don't
measure. The coverage report becomes a required artifact alongside scores.json and
decision.json for every optimization run.

### Key Insight for the Paper

This coverage-driven approach addresses a fundamental limitation of existing prompt
optimization research: **most systems optimize against a fixed eval set without
verifying the eval set actually exercises the full artifact.** Our coverage analyzer
ensures that the eval scenarios systematically cover every section of the
instructional document, preventing optimization blind spots.

---

## 2026-04-08: Architectural Evolution — 7-Phase Evaluation Skill

### The Insight

Our initial approach was ad-hoc: run baseline, run proposer, compare. The user
identified that this misses critical steps that make optimization truly systematic:

1. **Research before proposing** — every hypothesis should be informed by official
   CesiumJS documentation, not just the proposer's internal knowledge
2. **Explicit hypothesis formulation** — like Karpathy's AutoResearch, each proposed
   change should be a testable hypothesis with predicted impact
3. **Gate checks between phases** — independent verification that each phase completed
   fully before moving on (modeled after superpowers verification-before-completion)
4. **Parallel evaluation** — 6-8 sub-agents for code generation, 3 parallel judges

### The 7-Phase Architecture

Created `tuning/.claude/skills/skill-optimizer/SKILL.md` — a local skill that codifies
the entire optimization process:

```
Phase 1: PARSE & INVENTORY  → Section decomposition + coverage analysis
Phase 2: RESEARCH            → Official CesiumJS docs for each API
Phase 3: BASELINE EVALUATION → Run all evals, capture screenshots
Phase 4: HYPOTHESIZE         → 3-5 targeted improvements with predictions
Phase 5: IMPLEMENT & TEST    → Apply changes, re-run evals
Phase 6: JUDGE               → 3 parallel independent pairwise judges
Phase 7: DECIDE & LOG        → Keep/discard, commit everything
```

Each phase has a gate check — a set of verification criteria that MUST be satisfied
before proceeding. This prevents the optimizer from rushing through phases or making
claims without evidence.

### Hypothesis-Driven Optimization

The key methodological shift: instead of letting the proposer make arbitrary changes,
we require explicit hypotheses:

```
Hypothesis H1: Add altitude guidelines for city panoramas
- Observation: eval-005 shows flat grid instead of skyline
- Root cause: SKILL.md has no guidance for panoramic views
- Research: Official docs show lookAt with HeadingPitchRange for orbits
- Proposed change: Add "City panoramic" row to altitude table
- Expected impact: eval-005 visual score improves from 0.85 to 0.95+
- Regression risk: Low — additive change, no API coverage removed
```

This makes optimization auditable, reproducible, and paper-worthy. Every improvement
can be traced to a specific hypothesis backed by documentation research.

### Why This Matters for the Paper

This phased architecture addresses three limitations in existing prompt optimization:

1. **No research phase.** Existing systems (OPRO, TextGrad, DSPy) optimize based on
   task performance alone. Our system consults authoritative documentation before
   proposing changes, grounding improvements in domain knowledge.

2. **No hypothesis tracking.** Existing systems propose changes without predicting
   their impact. Our hypothesis format requires predicted outcomes, enabling
   scientific evaluation of the optimization process itself.

3. **No gate checks.** Existing systems run continuous optimization loops without
   verifying intermediate state. Our gate checks ensure each phase produces valid
   output before the next phase consumes it.

---

## References

- Lee, Y., et al. (2026). "Meta-Harness: End-to-End Optimization of Model Harnesses."
  Stanford. arXiv:2603.28052.
- Karpathy, A. (2025). "AutoResearch." GitHub: karpathy/AutoResearch.
- SPO: "Self-Supervised Prompt Optimization." EMNLP 2025. arXiv:2502.06855.
- "Noisy but Valid: Robust Statistical Evaluation of LLMs with Imperfect Judges."
  arXiv:2601.20913.
- Zheng, L., et al. (2023). "Aligning with Human Judgement: The Role of Pairwise
  Preference in LLM Evaluators." arXiv:2403.16950.
