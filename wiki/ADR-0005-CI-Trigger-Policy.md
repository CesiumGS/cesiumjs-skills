# ADR-0005: Use Cost-Aware CI Trigger Policy

## Context

Full LLM-assisted judging is useful but can be expensive and slow. Public contributors need fast feedback on routine changes, while maintainers need deeper evaluation before releases or high-risk changes.

## Decision

Use tiered CI triggers:

- Pull requests run deterministic checks by default.
- Visual judge suites run on scheduled, manual, release, or high-risk triggers.
- Maintainers can request a full judge run when a change plausibly affects generated visual quality.
- CI output must include enough artifacts to reproduce failures locally.

## Consequences

- Routine PRs remain practical for contributors.
- Expensive judge runs are used where they add the most value.
- Some visual regressions may not be caught immediately on every PR.
- Release and scheduled runs become important safety nets.
- Trigger policy must be documented so contributors know what evidence is required.
