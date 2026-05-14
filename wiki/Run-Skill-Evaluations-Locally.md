# Run Skill Evaluations Locally

The public v1 evaluation workflow has two layers:

1. Cheap deterministic checks that validate public manifests and public-facing artifacts.
2. Optional browser-backed reproduction runs for maintainers who have a Cesium ion token.

## Validate Public Artifacts

Run these checks before proposing changes to eval scenarios, architecture docs, wiki pages, or public summaries:

```bash
python3 scripts/validate-evals.py
python3 scripts/check-public-artifacts.py
./scripts/check-secrets.sh
```

These checks do not require external model access.

## Prepare Generated Code

For browser-backed reproduction, save generated JavaScript snippets under:

```text
evals/generated/<skill>/<iteration>/<eval-id>.js
```

Example:

```text
evals/generated/cesiumjs-camera/candidate/eval-001.js
```

The generated file should contain only the JavaScript body. The runner provides the page, CesiumJS CDN script, `cesiumContainer`, and token assignment.

## Run a Scenario

Install Playwright locally, set a Cesium ion token, and run the public runner:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install playwright
python -m playwright install chromium

export CESIUM_ION_TOKEN="<token>"
python3 scripts/run-public-eval.py cesiumjs-camera --iteration candidate --only eval-001
```

Raw output is written under:

```text
evals/runs/<skill>/<iteration>/<eval-id>-<name>/
```

That directory is gitignored because it can contain generated HTML, console logs, screenshots, and environment-specific details.

## Review Results

Each run directory includes:

- `eval.html` - generated local page.
- `screenshot.png` - visual evidence for local review.
- `console.json` - console messages and captured page errors.
- `programmatic-checks.json` - deterministic check results.

Only sanitized summaries should be committed to `evals/results/`.
