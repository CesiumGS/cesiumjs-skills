# PRD: Deterministic Scorecard Evaluation

Status: Core implementation complete; CI/CD wiring intentionally deferred
Last updated: 2026-05-27
Owner: CesiumJS skills maintainers
Primary stakeholders: CesiumJS skills maintainers and reviewers

## Definitions

- Evaluation: read-only quality-control testing of the current skills, prompts,
  plugins, or generated outputs against intended outcomes.
- Optimization: local development automation that proposes or evaluates
  candidate changes against a baseline.
- Scorecard: the CI/CD-facing evaluation artifact that reports overall result,
  category scores, per-case results, and per-check evidence.
- Deterministic check: a check with an objective expected value, explicit units
  or semantics, and a stable pass/fail rule.
- Qualitative visual review: a human or visual-judge assessment of the rendered
  output for framing, readability, occlusion, artifacting, and whether the scene
  visually communicates the requested outcome.

## Summary

Build a lightweight, CI/CD-safe evaluation framework for CesiumJS skills,
prompts, plugins, and generated outputs. The primary deliverable is a
scorecard: a deterministic, reviewable report that says whether the current
system meets intended behaviors, where it regressed, and which category failed.

This is separate from self-optimization. Self-optimization is useful local
development automation, but it must not be the CI/CD evaluation product.

## Source

This PRD is based on review feedback on the existing eval/optimization
prototype after it was demoed and reviewed.

Key feedback from that review:

- CI/CD wants a simpler quality-control evaluator, not a self-improving loop.
- The scorecard is the priority deliverable.
- Evaluation should run current prompts, skills, plugins, or generated outputs
  against intended outputs.
- The output may become binary pass/fail or percentage-with-threshold, but it
  should be scorecard-shaped with clear subcategories.
- Iterative self-optimization should remain local development automation.
- Deterministic and unit-test-like checks should complement visual judging.
- Visual judging should become a reviewable scorecard lane, not an optimizer-only
  side channel.
- Some failures are not visible in a side-by-side screenshot, such as
  translating objects against an empty background.
- Camera targeting needs deterministic checks, such as ensuring the camera is
  viewing the target from an acceptable volume rather than flying above it.
- Qualitative visual judging can remain useful, but it should not be the only
  way to catch regressions.

## Problem

The existing prototype mixes two related but different workflows:

1. Evaluation: run the current system against intended outputs and produce a
   quality-control signal.
2. Optimization: propose changes, compare candidate versus baseline, and decide
   whether to keep the candidate.

This makes the current system too expensive and too active for normal CI/CD. A
five-hour, multi-million-token self-optimization loop is useful for development,
but it is not the right default PR gate. CI/CD needs a deterministic scorecard
that is cheap enough to run, stable enough to trust, and clear enough to debug.

## Goals

1. Produce a deterministic scorecard for the current repository state.
2. Catch regressions in skills, prompts, plugins, and generated CesiumJS code.
3. Prefer objective checks over subjective judgment when behavior can be
   measured.
4. Support synthetic cases with known expected state.
5. Provide category-level scoring and qualitative visual summaries so
   maintainers can see whether failures are execution, semantic scene-state,
   camera, prompt-output, or visual-quality problems.
6. Make CI/CD gating simple: no candidate generation, no skill mutation, no
   autonomous PR creation.
7. Keep the self-optimization workflow available as a local development tool
   that can consume scorecard results.

## Non-Goals

- Automatically creating PRs from CI.
- Mutating `skills/`, current-best metadata, optimization history, or baselines
  during scorecard evaluation.
- Treating side-by-side visual judging as the only evaluation mechanism.
- Replacing local self-optimization or development automation.
- Requiring every evaluation case to render a globe or screenshot.
- Requiring an LLM judge for checks that can be asserted with structured state.

## Users

- Maintainer reviewing a PR: needs a concise pass/fail signal plus category
  details.
- Skill author: needs to know which intended behavior regressed.
- Developer using self-optimization locally: needs scorecard output to identify
  where deeper optimization should spend time.
- Future MCP/plugin owner: needs a reusable pattern for evaluating prompts,
  skills, plugins, and generated outputs against intended outcomes.

## User Stories

1. As a maintainer, I can run a CI-safe command and get a scorecard showing
   whether the repo is safe to merge.
2. As a skill author, I can add a deterministic case that says "translate all
   objects 10 units in +X" and verify the generated behavior even if the
   screenshot looks unchanged.
3. As a reviewer, I can see whether camera fly-to behavior views the target
   from an acceptable angle instead of positioning the camera above it.
4. As a developer, I can use self-optimization locally after scorecard
   evaluation identifies weak categories.
5. As an evaluator author, I can add a new case without changing optimization
   code or creating a second hidden pipeline.

## Product Requirements

### Functional Requirements

FR1. Scorecard command

- Provide a command that runs the deterministic evaluation suite and writes a
  scorecard artifact.
- The scorecard must include an overall result, category scores, per-case
  results, and per-check details.
- The command must be read-only with respect to tracked product files.

FR2. Deterministic case catalog

- Evaluation cases must live under `evaluation/cases/`.
- Each case must define the prompt/task, preflight fixture setup, probe fields,
  expected checks, timeout, and metadata.
- Cases must be schema-validated before running.

FR3. Synthetic evidence fixtures

- Cases may include tracked synthetic evidence under `evaluation/fixtures/`.
- Every deterministic matcher should have at least one passing fixture and one
  failing fixture or unit test.
- Synthetic fixtures must be token-free, local-path-free, and stable across
  machines.

FR4. Structured evidence capture

- Runtime evaluation must capture structured evidence, not just screenshots.
- Required evidence includes before/after scene-state snapshots when a case
  depends on scene changes.
- Evidence must support entity positions, camera pose, selected primitive or
  entity metadata, layer state, clock state, and console/runtime health as the
  case catalog expands.

FR5. Deterministic matcher registry

- Checks must dispatch by type through a registry.
- Matchers must return actual value, expected value, pass/fail, detail, and
  metadata.
- Numeric matchers must declare units, coordinate frame, and tolerance.

FR6. Initial matcher categories

- Execution health: code loaded, no fatal console errors, no unhandled
  exceptions.
- Entity state: entity exists, entity count, entity property equality.
- Spatial transforms: local ENU or Cartesian translation/rotation deltas.
- Camera targeting: camera is outside forbidden overhead volume, camera is
  within acceptable target-view volume, camera direction intersects or faces the
  target region.
- Generated-output semantics: generated function/code satisfies a unit-test-like
  contract without relying on visual output.
- Visual quality supplement: first-class qualitative or screenshot-based review
  where deterministic checks are insufficient.

FR7. Visual review lane

- Scorecards must support a per-case qualitative visual review object with
  status, summary, observations, risks, reviewer metadata, screenshots, and
  artifact references.
- Scorecards must include a top-level visual summary with reviewed count,
  required count, not-reviewed count, and blocking visual issues.
- Visual review must be read-only and must not invoke candidate generation,
  skill mutation, promotion decisions, or optimization history writes.
- Visual review should be configurable as gate-blocking for cases where render
  quality is part of the product contract.

FR8. Score aggregation

- Scorecard output must include category scores and an overall score.
- The gating policy must support binary pass/fail and percentage thresholds.
- Regression-critical cases must be able to fail the gate even if aggregate
  score remains above threshold.
- Optional visual or LLM-judged checks must be separated from deterministic
  gate-critical checks unless explicitly configured.

FR9. CI/CD behavior

- CI/CD must run the scorecard evaluator, not the self-optimization loop.
- CI/CD must not generate candidate skill changes, promote candidates, or open
  PRs.
- CI/CD should fail when the scorecard is below threshold or a critical case
  fails.
- CI/CD artifacts should include the scorecard and sanitized evidence needed to
  debug failures.

FR10. Local optimization integration

- The local self-optimization loop may consume scorecard output to decide where
  to focus.
- Optimization must remain under `optimization/` and must be development
  automation, not the definition of evaluation.
- Optimization code may depend on evaluation APIs; evaluation code must not
  depend on optimization.

FR11. Reviewable reporting

- The scorecard must make failures understandable without reading runner code.
- For each failure, show the prompt/task, expected behavior, check category,
  actual value, expected value, tolerance, and evidence path.
- If screenshots are present, they should be supporting evidence alongside the
  qualitative visual review summary, observations, and risks.

## Architecture

```text
evaluation/cases
    -> evaluator runner
    -> fixture/preflight setup
    -> candidate or generated output execution
    -> structured evidence capture
    -> deterministic matcher registry
    -> qualitative visual review lane
    -> score aggregator
    -> scorecard JSON + Markdown
    -> CI/CD pass/fail gate
```

Hard boundary:

```text
evaluation/  = quality-control evaluation and scorecards
optimization/ = local development automation and self-improvement
```

Evaluation must be pure from the perspective of the repository: it can write
ignored artifacts and tracked scorecard outputs only when explicitly requested,
but it cannot mutate skills, baselines, candidates, history, or PR state.

## Scorecard Model

The scorecard should use this initial category shape:

| Category | Purpose | Example Checks | Default Gate |
| --- | --- | --- | --- |
| Execution Health | Ensure generated code can run | no fatal console errors, viewer created | Critical |
| Semantic Scene State | Validate observable world state | entity translated +10 X, entity exists | Critical |
| Camera Behavior | Validate viewpoint intent | not overhead, target in view cone/volume | Critical for camera cases |
| Generated Output Semantics | Validate generated code/function behavior independent of rendering | unit-test-like function result checks | Critical where available |
| Visual Quality | Catch subjective regressions | target visible, visual comparison | Supplemental unless configured |
| Cost/Runtime | Track operational cost | duration, retries, token use if any | Informational |

Minimum scorecard JSON fields:

- `schema_version`
- `run_id`
- `timestamp_utc`
- `git_commit`
- `overall_result`
- `deterministic_result`
- `overall_score`
- `threshold`
- `category_scores`
- `critical_failures`
- `visual_summary`
- `cases[]`
- `artifacts`

Each case result should include:

- `case_id`
- `skill`
- `task`
- `result`
- `score`
- `category`
- `checks[]`
- `visual_review`
- `evidence_path`
- `screenshots[]` when available

Each check result should include:

- `check_id`
- `type`
- `category`
- `result`
- `actual`
- `expected`
- `tolerance`
- `detail`
- `critical`

## Example Cases From Feedback

### Translation Without Visual Signal

Prompt: translate all objects in a scene by 10 units in the positive X
direction.

Why this matters: on a blank or flat background, the screenshot may look the
same before and after, so the evaluator must inspect semantic state or generated
function behavior.

Deterministic checks:

- all target entities exist before and after
- each target entity has +10 X delta
- Y and Z deltas remain within tolerance

### Camera Fly-To Targeting

Prompt: fly to a landmark such as the Golden Gate Bridge and view it.

Why this matters: agents often fly above the target instead of viewing it from
an angle. A pure screenshot judge may catch this, but a deterministic target
volume check is a better CI signal.

Deterministic checks:

- camera position is outside a forbidden overhead cone or volume
- camera is inside an acceptable viewing shell around the target
- camera direction intersects the target bounding volume or points within an
  angular tolerance of the target center

## Nonfunctional Requirements

- Runtime: PR-gate scorecard should be fast enough for CI. Long-running visual
  or optimization passes must remain separate.
- Cost: default CI scorecard should avoid multi-agent loops and unnecessary LLM
  judging.
- Determinism: cases must use stable inputs and explicit tolerances.
- Reproducibility: scorecards must record git commit, case versions, and
  evidence artifact paths.
- Security: no tokens, local paths, localhost URLs, raw tracebacks, or private
  transcripts in tracked artifacts.
- Extensibility: new check types should be add-only through registry entries
  and schemas.
- Explainability: every failed check must expose actual versus expected values.

## Acceptance Criteria

1. `evaluation/` contains the scorecard evaluator requirements, schemas, cases,
   fixtures, framework, scripts, tests, and local ignored artifacts.
2. `optimization/` remains separate and is described as local development
   automation.
3. CI can run an evaluation command that produces a scorecard without mutating
   skills or optimization state.
4. Deterministic checks cover at least one non-visual spatial case.
5. Qualitative visual review is represented in scorecard JSON, Markdown, and
   the local review UI.
6. A camera-targeting deterministic case can be added without changing the
   architecture.
7. Scorecard output has category scores, per-case results, and per-check
   actual/expected details.
8. The public-safety scan passes over all tracked evaluation artifacts.
9. The canonical-surface guard prevents reintroducing top-level eval scripts or
   evaluation-to-optimization imports.

## Open Questions

1. What default CI threshold should block merges: binary critical-fail policy,
   minimum overall percentage, or both?
2. Which category weights should be used for the first scorecard?
3. How many cases should run in PR CI versus nightly CI?
4. Which visual review cases should be gate-critical in PR CI versus advisory
   in local development?
5. What is the first camera target fixture and accepted view volume?
6. Should scorecard trends be stored in tracked files, CI artifacts, or an
   external dashboard?

## Phased Delivery

Phase 1: Contract and scorecard spec

- Define scorecard schema.
- Validate cases, evidence, and scorecard outputs.
- Keep deterministic fixtures tracked.

Phase 2: Deterministic case expansion

- Add Cartesian translation case.
- Add camera fly-to target-volume case.
- Add generated-output semantic test case.

Phase 3: CI integration

- Run scorecard command in PR checks.
- Upload sanitized scorecard and evidence artifacts.
- Keep optimization workflow out of default CI.

Phase 4: Developer automation integration

- Allow local optimization to consume scorecard weaknesses.
- Keep optimization as opt-in local or scheduled development automation.
