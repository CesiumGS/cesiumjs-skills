---
name: cesiumjs-skill-optimizer
description: "CesiumJS Skill Optimizer — automated, phased optimization of CesiumJS skill markdown files with visual verification, coverage analysis, hypothesis-driven improvements, and 3-parallel-judge evaluation. Invoke with a target skill name (e.g., cesiumjs-camera) to start an optimization run."
---

# CesiumJS Skill Optimizer

Iteratively improve a CesiumJS SKILL.md by generating code from it, rendering in a
browser, taking screenshots, and comparing results. Follows the Meta-Harness blueprint
(Lee et al., Stanford 2026) with AutoResearch-style hypothesis testing (Karpathy 2025).

## Inputs

When invoked, determine:
1. **Which skill?** — e.g., `cesiumjs-camera`, `cesiumjs-entities`, `cesiumjs-viewer-setup`
2. **Eval scenarios** — either provided by the user, or generate 3-5 automatically (default)

All work happens in: `tuning/{skill-name}/`

---

## Phase 1: PARSE & INVENTORY

**Goal:** Decompose the SKILL.md into sections and measure coverage.

1. Read `skills/{skill-name}/SKILL.md` completely
2. Run `python3 tools/coverage-analyzer.py <skill-path> <evals-dir>`
3. List every `##` section with line counts, code blocks, and APIs taught
4. If coverage < 90%, generate new eval scenarios for uncovered sections before proceeding

**Auto-generating eval scenarios (default 3-5):**
- For each uncovered or weakly-covered section, create an eval that:
  - Uses an iconic, recognizable landmark (Eiffel Tower, Grand Canyon, NYC, etc.)
  - Tests a specific API or pattern from that section
  - Has clear visual expectations (what should appear in the screenshot)
  - Has programmatic checks (regex patterns in generated code)
- Save to `evals/eval-{NNN}-{landmark}-{perspective}.json`
- Use human-readable naming throughout

**Gate Check:**
```
□ Coverage ≥ 90%
□ Every section with code examples has ≥ 1 eval
□ All evals use iconic, visually verifiable landmarks
□ Eval JSONs saved with descriptive names
```

---

## Phase 2: RESEARCH

**Goal:** Pull official CesiumJS documentation to inform improvements.

1. WebSearch for official docs for each major API in the skill
2. Compare skill examples against official Sandcastle examples
3. Identify discrepancies, missing patterns, or better approaches
4. Save findings to `iterations/{N}/research-notes.md`

**Gate Check:**
```
□ Official docs consulted for every major API
□ At least 3 official examples compared
□ Discrepancies documented
□ Research notes saved
```

---

## Phase 3: BASELINE EVALUATION

**Goal:** Run all evals against the current skill and capture traces.

For each eval scenario:
1. **Generate code** — spawn a sub-agent with SKILL.md as context + eval prompt.
   CesiumJS loaded globally as `Cesium` via CDN. Container div exists. Ion token set.
   Generate ONLY JavaScript code body (async IIFE context).
2. **Assemble HTML** — substitute into eval-template.html (token + code)
3. **Execute in browser** — Chrome DevTools MCP: navigate, wait, capture console, screenshot
4. **Run programmatic checks** — regex pattern matching against generated code

Save everything to `iterations/{N}/traces/{eval-name}/`:
- `generated-code.js`
- `eval.html`
- `console.json`
- `screenshot-{landmark}-{perspective}.png`
- `programmatic-checks.json`

**Gate Check:**
```
□ All evals executed, zero skipped
□ All screenshots captured with descriptive filenames
□ Programmatic checks run and saved
□ Any failures noted for Phase 4
```

---

## Phase 4: HYPOTHESIZE

**Goal:** Propose 3-5 specific, testable improvements based on baseline + research.

Each hypothesis MUST follow this format:

```markdown
### Hypothesis H{N}: {descriptive name}

**Observation:** {What baseline result is weak? Cite eval + screenshot}
**Root cause:** {Why did the LLM generate suboptimal code? Cite SKILL.md wording}
**Research support:** {What do official docs say?}
**Proposed change:** {Exact wording change — section, content}
**Expected impact:** {Which eval(s) will improve?}
**Regression risk:** {Could this hurt other evals?}
```

Save to `iterations/{N}/hypotheses.md`.

**Gate Check:**
```
□ At least 3 hypotheses
□ Each follows the format (observation, root cause, research, change, impact, risk)
□ Each targets a different weakness
□ Each has research support
□ All saved to iteration directory
```

---

## Phase 5: IMPLEMENT & TEST

**Goal:** Apply hypotheses to the SKILL.md and re-run all evals.

1. Copy current best SKILL.md to `iterations/{N}/SKILL.md`
2. Apply all hypothesis changes
3. Document changes in `iterations/{N}/proposer-reasoning.md`
4. Re-run full eval pipeline (same as Phase 3) with the new SKILL.md
5. All traces saved to `iterations/{N}/traces/{eval-name}/`

**Gate Check:**
```
□ New SKILL.md within 300-500 lines
□ All required sections present
□ All changes documented
□ All evals re-executed, zero skipped
□ Zero runtime errors
```

---

## Phase 6: JUDGE (3 Parallel Independent Agents)

**Goal:** Pairwise comparison with 3 independent judges. NON-NEGOTIABLE.

**Launch 3 sub-agents IN PARALLEL.** Each agent independently evaluates ALL eval
pairs (baseline screenshot vs candidate screenshot). No agent sees another's verdicts.

Each agent receives:
- The eval's visual expectations
- Baseline screenshot
- Candidate screenshot
- Instruction: respond "BASELINE", "CANDIDATE", or "TIE" with one sentence

**Majority vote** (2-of-3) per eval determines the winner.

Save to `iterations/{N}/judge-A.json`, `judge-B.json`, `judge-C.json`.
Compute majority vote into `iterations/{N}/pairwise-comparison.json`.

**Decision rule:**
```
IF any regression_critical eval lost → DISCARD
ELIF candidate_wins > baseline_wins → KEEP
ELSE → DISCARD
```

**Gate Check:**
```
□ All 3 judges ran independently and in parallel
□ No judge saw another's verdict
□ All individual verdicts stored
□ Majority vote computed correctly
```

---

## Phase 7: DECIDE & LOG

**Goal:** Make decision, commit, and prepare the report.

1. Write `iterations/{N}/decision.json` with rationale
2. If KEEP: update `best.json`, note validated hypotheses
3. If DISCARD: note which hypotheses failed and why
4. Commit all artifacts to the private tuning repo

---

## Phase 8: REPORT

**Goal:** Generate a human-readable optimization report with before/after evidence.

Create `iterations/{N}/REPORT.md` containing:

```markdown
# Optimization Report: {skill-name} — Iteration {N}

## Summary
- **Decision:** KEEP / DISCARD
- **Pairwise results:** {wins} wins, {losses} losses, {ties} ties
- **Hypotheses tested:** {count}
- **Hypotheses validated:** {list}

## Most Impactful Changes

### {Change 1 name}
**Before:** ![baseline](traces/{eval-name}/screenshot-baseline.png)
**After:** ![candidate](traces/{eval-name}/screenshot-candidate.png)
**What changed in the skill:** {exact wording change}
**Why it worked:** {explanation}

### {Change 2 name}
...

## All Eval Results

| Eval | Landmark | Perspective | Judge A | Judge B | Judge C | Majority |
|------|----------|------------|---------|---------|---------|----------|
| 001  | ...      | ...        | ...     | ...     | ...     | ...      |

## Hypotheses Tested

| ID | Name | Target Eval | Result | Notes |
|----|------|-------------|--------|-------|
| H1 | ...  | ...         | ✓/✗    | ...   |

## Skill Diff
{diff between baseline and new SKILL.md, focused on meaningful changes}
```

Present the report path to the user and offer to open key screenshots.

---

## Directory Structure

```
tuning/{skill-name}/
├── evals/
│   ├── eval-001-{landmark}-{perspective}.json
│   └── ...
├── eval-template.html
├── search-config.json
├── coverage-report.json
├── best.json
├── iterations/
│   ├── 000-baseline/
│   │   ├── SKILL.md
│   │   ├── scores.json
│   │   └── traces/
│   │       ├── eval-001-{landmark}-{perspective}/
│   │       │   ├── generated-code.js
│   │       │   ├── eval.html
│   │       │   ├── console.json
│   │       │   ├── screenshot-{landmark}-{perspective}.png
│   │       │   └── programmatic-checks.json
│   │       └── ...
│   ├── 001/
│   │   ├── SKILL.md
│   │   ├── research-notes.md
│   │   ├── hypotheses.md
│   │   ├── proposer-reasoning.md
│   │   ├── judge-A.json, judge-B.json, judge-C.json
│   │   ├── pairwise-comparison.json
│   │   ├── decision.json
│   │   ├── REPORT.md
│   │   └── traces/
│   │       └── (same structure as baseline)
│   └── ...
```

---

## Key Principles

1. **The LLM is the optimizer.** No mutation algorithms. Read docs, form hypotheses,
   make changes, test empirically.
2. **3 parallel independent judges.** Never a single judge. Majority vote. Always.
3. **Research before hypothesis.** Official docs inform every proposed change.
4. **Gate checks between phases.** No skipping. Evidence before proceeding.
5. **Iconic landmarks for evals.** Eiffel Tower, Grand Canyon, NYC — visually
   unambiguous, easy for judges to evaluate.
6. **Human-readable naming.** `eval-005-nyc-skyline-hudson/` not `eval-005/`.
7. **Report at the end.** Before/after screenshots, diff, hypothesis results.
8. **Log everything.** Every artifact, every verdict, every hypothesis, every decision.
9. **LLMs copy examples.** The highest-impact optimization is providing better
   examples with explicit numeric defaults in the skill document.
