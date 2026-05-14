# CesiumJS Skills Evaluation Framework

This directory is the public v1 surface for evaluating CesiumJS agent skills.
It is intentionally separate from local tuning traces.

## Contents

- `scenarios/` - Public-safe scenario manifests grouped by skill.
- `results/public-status.json` - Sanitized current-best and decision summary.
- `schemas/scenario.schema.json` - Human-readable schema for scenario files.

Scenarios default to `runner_mode: "global-js"`, meaning they can run through
`scripts/run-public-eval.py` with generated JavaScript snippets that use the
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

Run the public v1 checks before publishing eval changes:

```bash
python3 scripts/validate-evals.py
python3 scripts/check-public-artifacts.py
./scripts/check-secrets.sh
```

The validation scripts use only the Python standard library.
