# Public Artifact Policy

The evaluation framework is public-facing. Artifacts committed to the repository must be useful to contributors without exposing credentials, private planning material, or local machine details.

## Allowed by Default

- Scenario manifests under `optimization/scenarios/`.
- Aggregate evaluation summaries under `optimization/results/*.json`.
- Architecture docs and ADRs.
- Public wiki pages.
- Programmatic check summaries that use relative paths and no credentials.
- Pairwise judge summaries that describe outcomes without private prompts or links.

## Local or Temporary by Default

- Generated JavaScript snippets under `optimization/generated/`.
- Raw browser runs under `optimization/runs/`.
- Generated candidate skill snapshots under `optimization/candidates/`.
- Generated HTML pages. Review results in the evaluation console instead (`cesium-eval serve <scorecard.json>`).
- Per-skill iteration output under `optimization/results/<skill>/<iteration>/`.
- The `optimization/history/` archive.
- Console logs from local browser runs.
- Raw screenshots before review.
- Model prompts or raw model transcripts.

## Required Checks

Before publishing eval or wiki changes, run:

```bash
node packages/eval/bin/cesium-eval.js check canonical-surface
node packages/eval/bin/cesium-eval.js check public-artifacts
./optimization/scripts/check-secrets.sh
```

Public docs and wiki pages must not link to private planning material or depend on private context for comprehension.
