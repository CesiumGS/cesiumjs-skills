# Self-Optimizing Prompt Engineering via Meta-Harness

A methodology for automated, iterative improvement of LLM skill documents (or any
text artifact that governs LLM behavior) using a coding-agent proposer with full
filesystem access to all prior experience.

Adapted from:
- **Meta-Harness** (Lee et al., Stanford 2025) — end-to-end optimization of model
  harnesses via agentic search with full execution trace access
- **AutoResearch** (Karpathy 2025) — greedy hill-climbing with git-based state
  management and structured logging

---

## 1. Core Principle

The optimizer is a coding agent — not a fixed algorithm. It reads prior iterations'
source text, scores, execution traces, and screenshots from a filesystem, forms
hypotheses about what to change and why, and proposes a revised artifact. The outer
loop is deliberately minimal: evaluate the proposal, log everything, repeat.

This works because:
- **Full history beats summaries.** Compressed feedback (scalar scores, LLM-generated
  summaries) discards the diagnostic detail needed to trace downstream failures to
  upstream causes. The Meta-Harness ablation shows full-trace access achieves 50.0%
  median accuracy vs 34.6% for scores-only and 34.9% for scores+summary (Table 3 of
  the paper). Summaries can actually hurt by compressing away critical details.
- **The agent decides what to inspect.** Rather than feeding a fixed prompt with the
  last N results, the agent navigates the filesystem with grep, cat, and file reads.
  It chooses what prior iterations to examine based on its own reasoning about what
  might be relevant. In the Meta-Harness TerminalBench experiments, the proposer read
  a median of 82 files per iteration, referencing 20+ prior candidates per step.
- **Causal reasoning emerges from trace access.** With access to execution traces, the
  agent can identify confounds (e.g., "iterations 1-2 both regressed because they
  bundled structural fixes with prompt rewrites"), isolate variables, and make targeted
  changes. This is impossible with score-only feedback.
- **Minimal outer loop = maximum flexibility.** No evolutionary operators, mutation
  strategies, or search heuristics are imposed. The agent's judgment improves with
  richer history, and the system automatically benefits from more capable models.

---

## 2. When to Use This Methodology

This approach is appropriate when:

1. **The optimization target is a text artifact** that governs LLM behavior — a skill
   document, system prompt, harness code, agent instructions, or similar.
2. **Quality can be evaluated programmatically and/or via LLM-as-judge** — there exist
   measurable criteria (code correctness, visual output, task completion) that can be
   scored without a human in the loop.
3. **The artifact is too complex for manual A/B testing** — 350+ line instructional
   documents with multiple interacting sections cannot be effectively optimized by
   hand-tweaking individual phrases.
4. **You can define a representative eval set** — a set of test scenarios that exercise
   the artifact's most important behaviors and are hard enough that the baseline doesn't
   already saturate them.

---

## 3. Setting Up for a New Repository

### 3.1 Identify the Optimization Target

The optimization target is the text artifact whose wording directly affects LLM output
quality. Examples:

| Domain | Target Artifact | What Changes |
|--------|----------------|--------------|
| Skill plugin | `SKILL.md` files | Wording, examples, structure, API coverage |
| Agent harness | System prompt / harness code | Context management, retrieval, orchestration |
| Coding assistant | Instruction templates | Task decomposition, error handling guidance |
| RAG pipeline | Retrieval prompt | Query formulation, context presentation |

**Key constraint:** The optimization target must be a discrete, versionable artifact.
Each iteration produces exactly one new version of this artifact.

### 3.2 Define the Eval Set (Search Set)

The eval set is a collection of test scenarios that exercise the artifact's most
important behaviors. This is the **most critical setup step** — a weak eval set
produces meaningless optimization.

**Principles for eval set construction:**

1. **Start with failures.** Run the current artifact on representative tasks. The
   scenarios where it performs worst are the most informative eval cases. An eval set
   that the baseline already saturates gives the optimizer nothing to improve.

2. **Cover the important axes.** Each eval scenario should exercise a specific
   capability or failure mode. For a CesiumJS camera skill, this might include:
   - Basic flyTo animation
   - Camera constraints (min/max altitude)
   - Entity tracking
   - Screen-to-world coordinate conversion
   - Edge case: flyTo with duration=0

3. **Verify coverage with the coverage analyzer.** Run `tools/coverage-analyzer.py`
   on the SKILL.md to extract all sections, code blocks, and API references. Then
   cross-reference with your eval scenarios. **Target ≥90% section coverage.** Every
   section with code examples should have at least 2 eval scenarios testing it.
   Coverage gaps mean optimization blind spots — you can't improve what you don't test.

4. **Design multiple scenarios per section.** Each major section of the SKILL.md
   should be exercised by several evals testing different aspects. For a camera skill's
   lookAt section, this means: lookAt from different cardinal directions, lookAt at
   different ranges, and the critical lock/unlock pattern.

5. **Use iconic, visually verifiable landmarks.** Eval scenarios that render
   recognizable real-world scenes (Eiffel Tower, Grand Canyon, NYC skyline) are
   far more reliably judged than abstract geometric scenes. The visual judge can
   immediately tell if the Eiffel Tower area is centered versus a random patch of land.

6. **Make scenarios reproducible.** Each eval scenario must produce deterministic,
   comparable results. Fix random seeds, model temperatures, browser viewport sizes,
   and any other sources of variance.

7. **Use human-readable naming throughout.** Directories and files should be
   scannable at a glance:
   - Eval files: `eval-001-eiffel-ground-level.json`
   - Trace dirs: `eval-001-eiffel-ground-level/`
   - Screenshots: `screenshot-eiffel-ground-level.png`
   - Top-level: `cesiumjs-camera/` not `skill-002/`

**Eval scenario format:**

```json
{
  "id": "eval-001",
  "name": "fly-camera-to-nyc",
  "description": "Generate code that flies the camera to New York City with a smooth animation",
  "prompt": "Write CesiumJS code that creates a viewer and flies the camera to New York City (40.7128 N, 74.0060 W) at 10,000 meters altitude with a 3-second animation.",
  "expected_behaviors": [
    "Uses Cesium.Viewer or CesiumWidget constructor",
    "Calls camera.flyTo with correct coordinates",
    "Longitude is negative (west)",
    "Altitude is approximately 10000",
    "Duration is set to 3 seconds"
  ],
  "visual_expectations": "Globe visible with camera positioned over the New York City metropolitan area. Urban area or recognizable coastline should be visible.",
  "programmatic_checks": [
    { "type": "no_console_errors", "description": "No JavaScript errors in console" },
    { "type": "code_runs", "description": "Code executes without throwing" },
    { "type": "api_check", "pattern": "camera\\.flyTo", "description": "Uses flyTo API" }
  ],
  "screenshots": [
    { "timing": "after_load", "delay_ms": 1000, "description": "Initial state" },
    { "timing": "after_animation", "delay_ms": 5000, "description": "After flyTo completes" }
  ]
}
```

### 3.3 Define Success Criteria

Success criteria are the axes along which each iteration is scored. These should be:

- **Comprehensive** — cover all dimensions that matter
- **Measurable** — each criterion produces a numeric score or boolean
- **Weighted** — not all criteria are equally important
- **Regression-sensitive** — any regression on a critical axis is a disqualifier

**Criteria taxonomy:**

#### Programmatic (automated, deterministic)

These checks run without an LLM and produce boolean or numeric results.

| Criterion | What it measures | How to check |
|-----------|-----------------|--------------|
| Code executes | Generated code runs without errors | Browser evaluate + console check |
| API accuracy | Correct APIs, signatures, defaults | AST analysis or regex on generated code |
| Domain boundary | Skill stays within its domain scope | Check for APIs owned by other skills |
| Structural integrity | Valid frontmatter, See Also, sections | Parse SKILL.md structure |
| Line budget | Skill stays within target length | Line count |
| No deprecated APIs | Uses current API surface | Check against deprecation list |

#### Visual (LLM-as-judge on screenshots)

These require sending screenshots to a multimodal model for evaluation.

| Criterion | What it measures | How to check |
|-----------|-----------------|--------------|
| Visual correctness | Does the rendered scene match expectations? | Screenshot + judge prompt |
| Scene completeness | Are expected elements present? | Screenshot + judge prompt |
| Rendering quality | No visual artifacts, correct lighting, etc. | Screenshot + judge prompt |

The visual judge receives:
1. The eval scenario description and visual expectations
2. The screenshot(s)
3. A structured grading rubric

And returns a structured score with rationale.

#### Qualitative (LLM-as-judge on generated code/text)

| Criterion | What it measures | How to check |
|-----------|-----------------|--------------|
| Code quality | Is the generated code idiomatic, clean? | LLM review of generated code |
| Completeness | Does the skill cover all important patterns? | LLM review of SKILL.md |
| Triggering accuracy | Would this skill activate for the right queries? | LLM review of description field |

#### Aggregate Scoring

Each criterion produces a score in [0, 1]. The aggregate is a weighted combination:

```json
{
  "weights": {
    "code_executes": 0.20,
    "api_accuracy": 0.20,
    "visual_correctness": 0.25,
    "no_regressions": 0.15,
    "completeness": 0.10,
    "conciseness": 0.05,
    "structural_integrity": 0.05
  },
  "regression_policy": "any_critical_regression_disqualifies",
  "critical_criteria": ["code_executes", "api_accuracy", "structural_integrity"]
}
```

**Regression policy:** If a new iteration scores lower than the current best on ANY
critical criterion, it is automatically disqualified regardless of aggregate score
improvement. This prevents the optimizer from trading correctness for other gains.

### 3.4 Set Up the Directory Structure

```
tuning/
├── METHODOLOGY.md              ← This document
├── {target-name}/              ← One directory per optimization target
│   ├── search-config.json      ← Eval set, objectives, weights, constraints
│   ├── evals/                  ← Test scenarios (the search set)
│   │   ├── eval-001.json
│   │   ├── eval-002.json
│   │   └── ...
│   ├── iterations/
│   │   ├── 000-baseline/       ← Initial artifact + scores + traces
│   │   │   ├── SKILL.md        ← (or whatever the target artifact is)
│   │   │   ├── scores.json     ← Per-eval + aggregate scores
│   │   │   ├── traces/         ← Full execution traces per eval
│   │   │   │   ├── eval-001/
│   │   │   │   │   ├── generated-code.js
│   │   │   │   │   ├── screenshot-load.png
│   │   │   │   │   ├── screenshot-after.png
│   │   │   │   │   ├── console.log
│   │   │   │   │   └── trace.json
│   │   │   │   └── eval-002/
│   │   │   └── summary.json
│   │   ├── 001/
│   │   │   ├── SKILL.md
│   │   │   ├── proposer-reasoning.md   ← Agent's full reasoning (verbatim)
│   │   │   ├── scores.json
│   │   │   ├── traces/
│   │   │   └── decision.json           ← {status, rationale, comparison}
│   │   ├── 002/
│   │   └── ...
│   └── best.json               ← Pointer to current best iteration
```

**Logging requirements (non-negotiable):**

Every iteration MUST preserve:

1. **The exact artifact version** — the complete SKILL.md (or equivalent) as proposed
2. **The proposer's reasoning** — verbatim text of why the agent chose these changes,
   what prior iterations it examined, what hypotheses it formed
3. **Per-eval scores** — individual scores for every eval scenario on every criterion
4. **Aggregate scores** — weighted combination with the formula used
5. **Full execution traces** — for every eval scenario:
   - The generated code (what the LLM produced when using this skill)
   - Console output (errors, warnings, logs)
   - Screenshots at specified timings
   - The full LLM interaction trace (prompt sent, response received)
6. **The keep/discard decision** — with explicit rationale and comparison to prior best
7. **Diff from prior best** — what specifically changed in the artifact

This comprehensive logging is what enables the proposer to perform causal reasoning
in future iterations. Compressing or omitting any of these reduces the optimizer's
effectiveness.

---

## 4. The Optimization Loop

### 4.1 Phase 0: Establish Baseline

Before any optimization begins:

1. Copy the current artifact into `iterations/000-baseline/`
2. Run the full eval set against it
3. Score every criterion
4. Store all traces and screenshots
5. This becomes the "current best" that all future iterations are compared against

The baseline serves two purposes:
- It defines the starting point that must not regress
- It gives the proposer concrete evidence of what currently works and what doesn't

### 4.2 Phase 1: Iterative Optimization

```
For each iteration t = 1..N:

  ┌─────────────────────────────────────────────────────┐
  │  PROPOSE                                            │
  │                                                     │
  │  Launch a coding agent with:                        │
  │  - Read access to tuning/{target}/                  │
  │  - Write access to iterations/{t}/ only             │
  │  - The proposer skill (see Section 5)               │
  │                                                     │
  │  The agent:                                         │
  │  1. Navigates the filesystem freely                 │
  │  2. Reads prior iterations' artifacts, scores,      │
  │     traces, screenshots, and reasoning              │
  │  3. Forms hypotheses about what to improve          │
  │  4. Writes a new artifact version                   │
  │  5. Documents its reasoning (proposer-reasoning.md) │
  └───────────────────┬─────────────────────────────────┘
                      │
                      ▼
  ┌─────────────────────────────────────────────────────┐
  │  EVALUATE                                           │
  │                                                     │
  │  Automated — runs outside the proposer agent:       │
  │  1. For each eval scenario:                         │
  │     a. Present the eval prompt to the LLM           │
  │        with the new artifact loaded as a skill      │
  │     b. Capture the generated code                   │
  │     c. Execute in browser (Chrome DevTools MCP)     │
  │     d. Capture screenshots at specified timings     │
  │     e. Run programmatic checks                      │
  │     f. Run visual judge on screenshots              │
  │     g. Run qualitative judge on generated code      │
  │  2. Compute per-eval and aggregate scores           │
  │  3. Store everything in iterations/{t}/             │
  └───────────────────┬─────────────────────────────────┘
                      │
                      ▼
  ┌─────────────────────────────────────────────────────┐
  │  DECIDE                                             │
  │                                                     │
  │  Compare new scores to current best:                │
  │  - Any critical regression? → DISCARD               │
  │  - Aggregate improved + no regressions? → KEEP      │
  │  - Marginal/ambiguous? → DISCARD (conservative)     │
  │                                                     │
  │  Write decision.json with:                          │
  │  - status: "keep" | "discard"                       │
  │  - rationale: why                                   │
  │  - comparison: per-criterion delta from best        │
  │  - If keep: update best.json                        │
  └─────────────────────────────────────────────────────┘
```

### 4.3 Stopping Criteria

The loop runs for a configured number of iterations (recommended: 10-20 for initial
runs, can be extended). Additional stopping signals:

- **Convergence:** If the last K iterations were all discarded, the optimizer may have
  reached a local optimum. The proposer should be informed of this pattern and
  encouraged to try more radical changes before giving up.
- **Budget:** Each iteration has a cost (LLM calls for generation, evaluation, judging,
  and proposing). Set a total budget and stop when exhausted.
- **Diminishing returns:** If the improvement delta is consistently below a threshold,
  stop.

Unlike AutoResearch (which runs infinitely), we recommend a fixed iteration count for
initial runs. The comprehensive logging means you can always resume later.

---

## 5. The Proposer Skill

The proposer is a coding agent guided by a skill document. Following Meta-Harness
Appendix D, the skill should constrain outputs and safety-relevant behavior, NOT the
agent's diagnosis procedure.

**The skill should specify:**
- Where to find the filesystem (directory layout)
- What files the agent can and cannot modify
- What objectives to optimize
- What is forbidden (regressions, domain violations, etc.)
- Output format (where to write the new artifact + reasoning)

**The skill should NOT specify:**
- How to diagnose problems (let the agent decide what to inspect)
- What kind of changes to make (let the agent choose edits vs rewrites)
- Which prior iterations to examine (let the agent navigate freely)

**Example proposer skill structure:**

```markdown
# Skill Optimizer Proposer

You are optimizing a SKILL.md document to improve its effectiveness
as an LLM instruction set.

## Your Environment

All prior optimization history is at: tuning/{target-name}/
- iterations/000-baseline/ through iterations/{t-1}/ contain prior attempts
- Each iteration has: the SKILL.md version, scores.json, traces/, and reasoning
- best.json points to the current best iteration

## Your Task

1. Examine the filesystem to understand what has been tried and what worked
2. Form a hypothesis about what to change and why
3. Write a new SKILL.md to iterations/{t}/SKILL.md
4. Write your full reasoning to iterations/{t}/proposer-reasoning.md

## Objectives (in priority order)

1. Generated code must execute without errors
2. Generated code must use correct, current APIs
3. Visual output must match scenario expectations
4. Skill must maintain complete API coverage
5. Skill should be concise (no unnecessary bloat)

## Constraints

- Do NOT remove API coverage that exists in the baseline
- Do NOT add APIs that belong to other skill domains
- Do NOT exceed {line_budget} lines
- The artifact MUST have valid YAML frontmatter with name and description

## What you must NOT do

- Do not run any evaluations yourself — that happens after you propose
- Do not modify any file outside iterations/{t}/
```

The key insight from Meta-Harness: "iterating on the skill text had a larger effect on
search quality than changing iteration count or population size." This proposer skill
is itself worth optimizing via a meta-meta loop — but start simple and refine based on
the search trajectories you observe.

---

## 6. The Evaluation Harness

Evaluation is automated and runs OUTSIDE the proposer. It is a fixed procedure that
scores every proposed artifact identically.

### 6.1 Evaluation Pipeline

For each eval scenario:

```
┌──────────────────────────────┐
│ 1. Code Generation           │
│                              │
│ Present the eval prompt to   │
│ an LLM with the proposed     │
│ SKILL.md loaded as context.  │
│ Capture the generated code.  │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 2. Code Execution            │
│                              │
│ Load the generated code in   │
│ a browser via Chrome DevTools│
│ MCP or Playwright.           │
│ Capture console output.      │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 3. Screenshot Capture        │
│                              │
│ At specified timings:        │
│ - After initial load         │
│ - After animations complete  │
│ - After interactions         │
│ Capture PNG screenshots.     │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 4. Programmatic Checks       │
│                              │
│ Run deterministic checks:    │
│ - Console error count        │
│ - API pattern matching       │
│ - Code structure validation  │
│ Produce boolean/numeric      │
│ scores per check.            │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 5. Pairwise Visual Judging   │
│    (3 PARALLEL JUDGES)       │
│                              │
│ For each eval scenario:      │
│ Launch 3 independent sub-    │
│ agents in parallel. Each     │
│ sees baseline + candidate    │
│ screenshots and picks A/B/   │
│ TIE. Majority vote decides.  │
│ Store all 3 verdicts.        │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ 6. Score Aggregation         │
│                              │
│ Combine all scores per       │
│ configured weights.          │
│ Check regression policy.     │
│ Write scores.json.           │
└──────────────────────────────┘
```

### 6.2 The Visual Judge Prompt

The visual judge prompt is itself a critical artifact. It must be:
- **Specific** — describe exactly what to look for in each screenshot
- **Structured** — return scores in a parseable format
- **Calibrated** — provide reference examples of what "good" and "bad" look like

Example structure:

```
You are evaluating a CesiumJS rendered scene. You will see screenshots
of a 3D globe application.

## Scenario
{scenario_description}

## Expected Visual Outcome
{visual_expectations}

## Grading Rubric

Score each dimension 0-10:

1. SCENE_RENDERED: Is a 3D globe/scene visible (not a blank screen, error page,
   or loading spinner)?
2. CORRECT_LOCATION: Is the camera positioned at or near the expected location?
3. VISUAL_QUALITY: Is the rendering clean (no artifacts, missing tiles, z-fighting)?
4. EXPECTED_ELEMENTS: Are the expected visual elements present (entities, labels,
   buildings, terrain, etc.)?

## Response Format (JSON only)

{
  "scene_rendered": { "score": 0-10, "rationale": "..." },
  "correct_location": { "score": 0-10, "rationale": "..." },
  "visual_quality": { "score": 0-10, "rationale": "..." },
  "expected_elements": { "score": 0-10, "rationale": "..." },
  "overall": { "score": 0-10, "rationale": "..." }
}
```

This judge prompt is versioned and can itself be optimized (see Section 8).

### 6.3 Ensuring Fair Comparison

Following AutoResearch's fixed evaluation budget principle:
- **Same model** for code generation across all iterations
- **Same temperature** (recommend 0 for determinism)
- **Same browser viewport** size for screenshots
- **Same eval set** — never add or remove scenarios mid-search
- **Same judge model and prompt** across iterations

Any change to evaluation parameters invalidates comparison with prior iterations and
requires re-running the baseline.

---

## 7. Practical Implementation Notes

### 7.1 Cost Management

Each iteration involves:
- 1 proposer agent call (reading history, writing new artifact + reasoning)
- N eval scenarios x 1 code generation call each
- N eval scenarios x 1-3 screenshots each
- N eval scenarios x **3 independent pairwise judge calls each** (parallel)
- 1 aggregate/majority-vote step

For 8 eval scenarios and 10 iterations, this is roughly:
- 10 proposer calls
- 80 code generation calls
- 240 pairwise judge calls (8 evals x 3 judges x 10 iterations)
- Total: ~330 LLM calls

Cost scales linearly with eval set size and iteration count. Start small (3-5 evals,
5-10 iterations) and expand once the pipeline is validated.

### 7.2 Filesystem as the Primary Interface

The Meta-Harness paper's key finding: full filesystem access with selective reading
beats every form of compressed feedback. Implementation requirements:

- **Machine-readable formats:** Use JSON for scores, decisions, and configs. Use
  Markdown for reasoning and artifacts. Use plain text for logs.
- **Consistent naming:** `scores.json`, `trace.json`, `decision.json` in every
  iteration. The agent should be able to `grep` across all iterations.
- **Hierarchical organization:** `iterations/{n}/traces/eval-{id}/` makes it easy
  to navigate to a specific eval's results in a specific iteration.
- **Diffs are valuable:** Store or make it easy to compute diffs between iterations'
  artifacts. The agent can use `diff` to see exactly what changed.

### 7.3 Git Integration

Each optimization run should happen on a dedicated branch:
- `git checkout -b tuning/{target-name}`
- Each kept iteration is committed: `tuning: iteration {t} — {description}`
- Discarded iterations are still logged but not necessarily committed
- The final best artifact can be cherry-picked back to main

Git provides: rollback, audit trail, diff between iterations, and collaboration.

### 7.4 Bootstrapping: Cold Start Problem

The very first run has no history for the proposer to examine. To address this:

1. **Run the baseline evaluation thoroughly** — this gives the proposer concrete
   evidence of current failures and successes.
2. **Seed with human intuition** — if you know specific weaknesses ("the flyTo
   examples use an outdated callback pattern"), add these as notes in the baseline's
   summary.json.
3. **Start with the hardest eval scenarios** — scenarios where the baseline fails
   give the proposer the most signal for improvement.

### 7.5 When the Optimizer Gets Stuck

If several consecutive iterations are discarded:

1. **Check the eval set** — is it too easy (saturated) or too noisy (inconsistent)?
2. **Check the proposer reasoning** — is it repeating the same failed approach?
3. **Expand the eval set** — add new scenarios that test different capabilities.
4. **Adjust the proposer skill** — give it more specific guidance about what NOT to
   try (based on observed repeated failures).
5. **Reset from a different starting point** — try a more radically different artifact
   as the seed.

---

## 8. Pairwise Comparison (Replacing Absolute Scoring)

### 8.1 Why Absolute Scoring Fails

Our initial methodology used absolute visual scoring (0.0-1.0) per screenshot. This
revealed a fundamental problem: **LLM judge variance of ±0.05-0.10 per evaluation**
drowns out small improvements.

In our cesiumjs-camera optimization:
- eval-002 (Grand Canyon) scored 0.90 on baseline, 0.793 on iteration 001
- The generated code and screenshot were functionally identical
- The 0.107 difference was pure judge variance

With only 5 evals, one unlucky swing flipped the aggregate direction, hiding a genuine
improvement (+0.098 on eval-003).

### 8.2 The Pairwise Alternative

Instead of scoring each screenshot independently, present the judge with BOTH
screenshots (baseline and candidate) and ask which one better matches expectations.

**Protocol (per eval scenario) — MANDATORY 3 PARALLEL INDEPENDENT JUDGES:**

1. Take screenshots from both baseline and candidate iterations
2. Randomly assign as Image A / Image B (prevents position bias)
3. **Launch 3 INDEPENDENT sub-agents in parallel** — each agent sees ONLY
   the two screenshots for ONE eval and the eval's visual expectations.
   Each agent is a separate invocation with no shared context between judges.
   This is NON-NEGOTIABLE: a single agent judging all evals sequentially
   introduces anchoring bias, consistency pressure, and fatigue effects.
4. Each agent responds: "A", "B", or "TIE" with a one-sentence rationale
5. **Majority vote** across the 3 agents determines the winner for that eval
6. Store all 3 individual verdicts in the judgment record for auditability

**Why 3 parallel agents, not 1 sequential agent:**
- A single agent develops internal biases as it evaluates sequentially
- Independent agents cannot anchor on each other's prior judgments
- 3 judgments provide a majority vote (2-of-3 agreement)
- Parallel execution is faster than sequential
- This matches Meta-Harness (3 samples/problem) and SPO methodology

**Decision rule across evals:**

```
candidate_wins = count of evals where candidate won majority vote
baseline_wins = count of evals where baseline won majority vote
ties = count of TIE results

If candidate_wins > baseline_wins AND no critical programmatic regressions → KEEP
Otherwise → DISCARD
```

### 8.3 Why Pairwise Works

- **Eliminates absolute calibration noise.** The judge doesn't assign numbers — it
  picks a winner. "Is this 0.82 or 0.85?" is hard; "which looks more like London?"
  is easy.
- **Leverages the generation-verification gap.** LLMs are better at comparing two
  things than evaluating one thing in isolation (Zheng et al., 2023).
- **Extremely cost-efficient.** SPO (EMNLP 2025) achieves reliable optimization with
  only 3 pairwise samples at 1-6% of absolute scoring cost.
- **3 judgments + majority vote** matches the research consensus for reliable LLM
  evaluation (Meta-Harness uses 3 samples per problem for math evals).

### 8.4 Pairwise Judge Prompt Template

```
You are comparing two CesiumJS rendered scenes for the same task.

## Task Description
{eval.description}

## Expected Visual Outcome
{eval.visual_expectations}

## Images
- Image A: [attached]
- Image B: [attached]

## Question
Which image better matches the expected visual outcome described above?

Respond with ONLY one of:
- "A" — if Image A is clearly better
- "B" — if Image B is clearly better
- "TIE" — if both are roughly equivalent

Then provide a one-sentence rationale.
```

### 8.5 Combining Programmatic and Pairwise

Programmatic checks (code runs, API patterns, console errors) remain **absolute and
deterministic** — they are not affected by judge variance. The decision framework
becomes:

1. **Gate:** Do programmatic checks pass? Any critical regression → DISCARD
2. **Compare:** Pairwise visual comparison across evals → count wins
3. **Decide:** Candidate wins more evals → KEEP; otherwise → DISCARD

This separates the deterministic signal (does the code work?) from the subjective
signal (does it look right?) and applies the appropriate evaluation method to each.

---

## 9. Meta-Optimization: Optimizing the Optimizer

This methodology has several "meta" artifacts that are themselves candidates for
optimization:

1. **The proposer skill** — the instructions given to the proposer agent. Per
   Meta-Harness Appendix D: "iterating on the skill text had a larger effect on search
   quality than changing iteration count or population size."

2. **The visual judge prompt** — the rubric used to score screenshots. A poorly
   calibrated judge produces noisy signal that misleads the optimizer.

3. **The eval set** — which scenarios are included and how they're structured.

4. **The scoring weights** — how different criteria are balanced.

These can be optimized by running a higher-level loop:
- Run the optimization for N iterations with the current meta-artifacts
- Analyze the search trajectory (did the optimizer make progress? where did it stall?)
- Adjust the meta-artifacts based on the analysis
- Re-run

This is the "program the researcher, not the research" pattern from AutoResearch, and
the self-referential improvement concept from PromptBreeder. In practice, start with
simple meta-artifacts and refine them after observing 2-3 complete optimization runs.

---

## 9. Applying to a New Repository: Checklist

When setting up self-optimizing prompt engineering for a new repository:

- [ ] **Identify the target artifact** — what text controls LLM behavior?
- [ ] **Create the tuning/ directory** with the structure from Section 3.4
- [ ] **Define 5-10 eval scenarios** — focused on current failure modes
- [ ] **Define success criteria** — programmatic checks + visual + qualitative
- [ ] **Set scoring weights** — which criteria matter most?
- [ ] **Define the regression policy** — which criteria are critical (no regression)?
- [ ] **Write the proposer skill** — constrain outputs, not diagnosis
- [ ] **Write the visual judge prompt** — specific rubric per scenario type
- [ ] **Set up the evaluation pipeline** — browser automation, screenshot capture
- [ ] **Establish the baseline** — run full eval, store everything
- [ ] **Run 3-5 pilot iterations** — validate the pipeline works end-to-end
- [ ] **Review and refine** — examine proposer reasoning, adjust meta-artifacts
- [ ] **Run a full optimization** — 10-20 iterations
- [ ] **Cherry-pick the best artifact** — merge improvements back to main

---

## 10. What This Is NOT

To avoid misapplication, this methodology is explicitly NOT:

- **TextGrad / SCULPT / evolutionary algorithms** — we do not impose algorithmic
  mutation strategies. The LLM-as-coding-agent IS the optimizer.
- **DSPy-style program optimization** — we are not optimizing short instruction
  strings or few-shot examples. We are optimizing long-form instructional documents.
- **Blind A/B testing** — we log the proposer's full reasoning, enabling causal
  analysis, not just statistical comparison.
- **Continuous optimization** — runs are discrete, logged, and reviewable. Each
  iteration is a complete, inspectable artifact.
- **A replacement for human judgment** — the human reviews results after the run,
  validates the improvements make sense, and decides whether to accept them. The
  system automates the iteration, not the final decision.
