# ADR-0003: Separate Deterministic Decision Policy From Report Scores

## Context

Evaluation systems often mix LLM judgment, programmatic checks, and numeric aggregate scores. That can make decisions hard to audit. For Cesium AI evaluation, maintainers need to know whether a candidate was kept because it passed critical correctness gates, won visual comparisons, or merely improved a weighted average.

The desired pattern is:

```text
structured evidence -> deterministic decision -> report score
```

## Decision

Use deterministic gates and rule-based decisions as the source of truth:

1. Deterministic checks produce pass/fail facts.
2. Pairwise judges produce structured verdicts.
3. Critical-regression failures block acceptance.
4. Majority verdicts decide visual wins, losses, and ties.
5. Numeric report scores are derived afterward for dashboards and trends.

Manual override is allowed only when a maintainer records the reason.

## Consequences

- Decisions are explainable and auditable.
- Dashboards can still show scores without hiding the decision basis.
- Weighted formulas can evolve without changing the core keep/discard semantics.
- More metadata must be stored so decisions can be reconstructed later.
