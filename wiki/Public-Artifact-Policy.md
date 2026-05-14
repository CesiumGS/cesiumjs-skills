# Public Artifact Policy

The evaluation framework is public-facing. Artifacts committed to the repository must be useful to contributors without exposing credentials, private planning material, or local machine details.

## Allowed by Default

- Scenario manifests under `evals/scenarios/`.
- Sanitized status summaries under `evals/results/`.
- Architecture docs and ADRs.
- Public wiki pages.
- Programmatic check summaries that use relative paths and no credentials.
- Pairwise judge summaries that describe outcomes without private prompts or links.

## Local or Temporary by Default

- Generated JavaScript snippets under `evals/generated/`.
- Raw browser runs under `evals/runs/`.
- Generated HTML pages.
- Console logs from local browser runs.
- Raw screenshots before review.
- Model prompts or raw model transcripts.

## Required Checks

Before publishing eval or wiki changes, run:

```bash
python3 scripts/check-public-artifacts.py
./scripts/check-secrets.sh
```

Public docs and wiki pages must not link to private planning material or depend on private context for comprehension.
