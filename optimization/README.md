# CesiumJS Skills Optimization Framework

This directory contains the existing self-optimization pipeline for CesiumJS
agent skills. It is candidate-relative: propose a candidate skill, run it
against scenarios, compare it with the current baseline, judge the result, and
decide whether the candidate should be accepted or rejected.

Pure deterministic evaluation is being split into [`../evaluation/`](../evaluation/).
That directory should grow the unit-test-like scene-state checks requested in
review feedback, while this directory remains the optimization and promotion
surface.

## Contents

- `scenarios/` - Public-safe optimization scenario manifests grouped by skill.
- `results/public-status.json` - Sanitized current-best and decision summary.
- `schemas/scenario.schema.json` - Human-readable schema for scenario files.
- `framework/` - Optimization pipeline implementation modules, including
  adapters, deterministic checks, decision policy, judges, and proposer prompt
  templates.
- `scripts/scorecard-focus.py` - Local bridge that reads deterministic
  `evaluation/` scorecards and turns failures into optimization focus hints.
- `tests/` - Unit and CLI tests for the optimization pipeline.
- `docs/` - Optimization framework source-of-truth and PRD notes.

The repo intentionally does not use a top-level `tests/` directory. Optimization
tests belong here and pure evaluation tests belong under `../evaluation/tests/`,
so the product-facing root stays centered on `skills/`.

Scenarios default to `runner_mode: "global-js"`, meaning they can run through
`optimization/scripts/run-public-eval.py` with generated JavaScript snippets that use the
global `Cesium` object. Scenarios marked `runner_mode: "review-only"` are
public catalog and coverage scenarios until a compatible execution adapter is
added.

## Public Artifact Boundary

Committed eval artifacts may include scenario manifests, coverage summaries,
programmatic-check summaries, pairwise judge summaries, decision records, and
curated screenshots that have been reviewed for public safety.

Do not commit raw generated HTML, raw prompts, localhost trace URLs, access
tokens, private planning links, local filesystem paths, or unreviewed model
outputs. Keep those artifacts local or in temporary CI storage.

## Validation

Run the public v1 checks before publishing optimization changes:

```bash
pytest -q optimization/tests
pytest -q evaluation/tests
python3 optimization/scripts/validate-evals.py
python3 optimization/scripts/check-canonical-eval-surface.py
python3 optimization/scripts/check-public-artifacts.py
./optimization/scripts/check-secrets.sh
```

The validation scripts use only the Python standard library.
`validate-evals.py` is read-only: if a scenario changes, update the matching
hash deliberately with `python3 optimization/scripts/rebaseline-scenario.py <skill> <eval-id>`.

The previous local tuning harness has been removed from the active repository
surface. New self-optimization scenarios, results, and public optimization
artifacts should be added under `optimization/`, not under a second parallel
tree. New deterministic evaluation cases should be added under `evaluation/`.

To use the deterministic scorecard as local optimization input, run:

```bash
python3 evaluation/scripts/run-scorecard.py --fixture-expectation fail --output-dir /tmp/cesium-scorecard
python3 optimization/scripts/scorecard-focus.py /tmp/cesium-scorecard/scorecard.json --format markdown
python3 optimization/scripts/run-all-evals.py --from-scorecard /tmp/cesium-scorecard/scorecard.json --max-iterations 1 --stop-on regression --dry-run
```

This is intentionally one-way: optimization consumes scorecard JSON, but
`evaluation/` must not import or call optimization code.
