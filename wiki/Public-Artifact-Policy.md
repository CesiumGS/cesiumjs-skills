# Public Artifact Policy

The evaluation framework is public-facing. Artifacts committed to the repository must be useful to contributors without exposing credentials, private planning material, or local machine details.

## Allowed by Default

- Scenario manifests under `optimization/scenarios/`.
- Sanitized evaluation summaries under `optimization/results/`.
- Architecture docs and ADRs.
- Public wiki pages.
- Programmatic check summaries that use relative paths and no credentials.
- Pairwise judge summaries that describe outcomes without private prompts or links.

## Local or Temporary by Default

- Generated JavaScript snippets under `optimization/generated/`.
- Raw browser runs under `optimization/runs/`.
- Generated HTML pages.
- Console logs from local browser runs.
- Raw screenshots before review.
- Model prompts or raw model transcripts.

## Required Checks

Before publishing eval or wiki changes, run:

```bash
python3 optimization/scripts/check-canonical-eval-surface.py
python3 optimization/scripts/check-public-artifacts.py
./optimization/scripts/check-secrets.sh
```

Public docs and wiki pages must not link to private planning material or depend on private context for comprehension.
