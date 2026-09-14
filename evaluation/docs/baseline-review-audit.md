# Baseline Review Audit

Last updated: 2026-05-27

## What Happened

The previous four-case scorecard UI was built from deliberately failing
synthetic fixtures selected with:

```bash
node packages/eval/bin/cesium-eval.js score --fixture-expectation fail
```

Those failures were useful for testing that the scorecard explains
actual-versus-expected values, but they were not a comprehensive baseline review
of the skills. They also made the UI look like the current baseline was failing
when the scorecard was actually exercising negative fixtures.

The comprehensive baseline review now uses observed archived baseline artifacts
from `optimization/scenarios`, `optimization/generated`, and
`optimization/runs`.

## Current Coverage

The evaluation suite now accounts for every archived optimization scenario
prompt:

| Source | Count |
| --- | ---: |
| Archived optimization prompts imported into `evaluation/cases` | 83 |
| Additional hand-built deterministic unit-style cases | 4 |
| Total evaluation cases | 87 |
| Skills covered | 14 |

The imported archived cases use `eval-101+` identifiers so they do not collide
with hand-built deterministic cases such as `cesiumjs-entities/eval-001`.

## Expected vs Actual Provenance

For imported archived cases:

- Expected prompt, behavior, visual expectation, and source-pattern contracts
  come from `optimization/scenarios/<skill>/eval-*.json`.
- Actual generated code comes from
  `optimization/generated/<skill>/baseline/eval-*.js`.
- Actual browser/runtime observations come from
  `optimization/runs/<skill>/baseline/<eval-id>-*/`.
- Screenshot quality and render images come from the same observed baseline run
  artifact, not from a newly invented mock.

For hand-built deterministic unit-style cases:

- Expected values are explicit synthetic contracts derived from the review
  examples, such as `+6m east`, `+10 X`, or "input points are not mutated".
- Actual values come from tracked synthetic evidence fixtures under
  `evaluation/fixtures`.
- Positive fixtures are used for baseline review; negative fixtures remain for
  testing that failure reporting is understandable.

## Current Result

Running the baseline-observed suite with:

```bash
node packages/eval/bin/cesium-eval.js score \
  --fixture-expectation pass \
  --visual-review evaluation/artifacts/review-ui/sample-scorecard/visual-review.json \
  --output-dir evaluation/artifacts/review-ui/sample-scorecard
```

produces:

- Overall result: `PASS`
- Overall score: `100%`
- Cases: `87`
- Skills: `14`
- Critical failures: `0`
- Visual review: `83/87` reviewed, all imported archived prompt screenshots
  pass screenshot-quality review.

## Interpretation

The archived baseline generated code appears acceptable under the same
programmatic checks that the optimization pipeline used: runtime health,
source-pattern requirements, source-pattern exclusions, and screenshot
nonblank/viewport checks.

This does not mean every imported case has a deep semantic scene-state check
yet. It means every archived prompt is now represented in the evaluation review
suite with deterministic expected-vs-actual evidence, and the remaining work is
to progressively upgrade source-pattern checks into stronger scene-state or
unit-test-style checks wherever the behavior can be measured directly.

## Why The Old Failures Looked Strange

- `5.9m` actual versus `6.0m` expected was an intentionally failing fixture for
  precision reporting, not the observed current baseline.
- `Y drift = 1m` was an intentionally failing fixture for axis-drift reporting.
- `input_points_after_call` differing from expected input points was an
  intentionally failing fixture for mutation-contract reporting.
- The overhead camera failure was an intentionally failing camera geometry
  fixture.

Those remain valuable negative fixtures, but they should not be presented as
the primary baseline review.
