# ADR-0002: Use Pairwise Judge Protocol

## Context

CesiumJS correctness is often visual. A scene can execute without console errors and still be wrong because the camera is poorly framed, terrain is missing, imagery is incorrect, or an expected object is not visible.

Early absolute visual scoring is vulnerable to judge calibration noise. The same or equivalent output can receive different numeric scores across runs, which can flip aggregate decisions even when the candidate did not materially change a scenario.

## Decision

Use pairwise A/B/TIE judging for visual and qualitative comparisons:

1. Present the same scenario evidence for current best and candidate.
2. Ask each judge to choose `BASELINE`, `CANDIDATE`, or `TIE`.
3. Use three independent judges.
4. Compute the per-scenario majority verdict.

## Consequences

- Relative comparison reduces absolute-score calibration noise.
- Three independent judges reduce single-judge bias.
- Judge results are easier for maintainers to inspect.
- The protocol costs more than one judge, so it should be used selectively in CI.
- Numeric scores can still be produced for reporting, but they are not the primary visual decision mechanism.
