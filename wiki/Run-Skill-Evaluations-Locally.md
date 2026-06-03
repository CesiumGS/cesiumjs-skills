# Run Skill Evaluations Locally

The public v1 evaluation workflow has multiple layers:

1. Cheap deterministic checks that validate public manifests and public-facing artifacts.
2. Browser-backed reproduction runs for maintainers who have a Cesium ion token.
3. Full autonomous loop for skill evaluation and optimization.

## Prerequisites

### Install Dependencies

Create a virtual environment and install all dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
playwright install-deps chromium
```

### Set Environment Variables

Export required tokens for full pipeline execution:

```bash
export CESIUM_ION_TOKEN="<your-cesium-ion-token>"
export ANTHROPIC_API_KEY="<your-anthropic-api-key>"
```

**Note:** The Anthropic API key is only required for LLM-powered components (proposer, skills adapter, judges). Deterministic checks and browser runner work without it.

## Validate Public Artifacts

Run these checks before proposing changes to eval scenarios, architecture docs, wiki pages, or public summaries:

```bash
python3 optimization/scripts/validate-evals.py
python3 optimization/scripts/check-canonical-eval-surface.py
python3 optimization/scripts/check-public-artifacts.py
bash optimization/scripts/check-secrets.sh
```

These checks do not require external model access.

## Run a Single Scenario

### Manual Generated Code

For browser-backed reproduction with manually prepared code, save generated JavaScript snippets under:

```text
optimization/generated/<skill>/<iteration>/<eval-id>.js
```

Example:

```text
optimization/generated/cesiumjs-camera/001/eval-001.js
```

The generated file should contain only the JavaScript body. The runner provides the page, CesiumJS CDN script, `cesiumContainer`, and token assignment.

### Execute Scenario

Run the public runner for a single scenario:

```bash
python3 optimization/scripts/run-public-eval.py cesiumjs-camera --iteration 001 --only eval-001
```

Scenarios marked `runner_mode: "review-only"` are skipped by the local runner. They remain part of the public scenario catalog, but need a compatible execution adapter before browser automation can run them directly.

Raw output is written under:

```text
optimization/runs/<skill>/<iteration>/<eval-id>-<name>/
```

That directory is gitignored because it can contain generated HTML, console logs, screenshots, and environment-specific details.

### Review Single Scenario Results

Each run directory includes:

- `eval.html` - generated local page.
- `screenshot.png` (or numbered series) - visual evidence for local review.
- `console.json` - console messages and captured page errors.
- `programmatic-checks.json` - deterministic check results.
- `scene-state.json` - serialized scene state (camera, entities, imagery layers).
- `metadata.json` - reproducibility metadata (hashes, versions, timestamps).

Only sanitized summaries should be committed to `optimization/results/`.

## Run Full Autonomous Loop

The autonomous loop orchestrates the complete evaluation pipeline from proposal to decision:

### Full Loop Execution

Run a complete multi-iteration evaluation loop for a skill:

```bash
python3 optimization/scripts/run-loop.py cesiumjs-camera --max-iterations 5 --stop-on plateau
```

This executes the 7-step pipeline for each iteration:

1. **Proposer** - Analyzes history and proposes skill revision
2. **Skills Adapter** - Generates JavaScript for all scenarios
3. **Browser Runner** - Executes code in headless Chromium
4. **Deterministic Checks** - Runs programmatic validation
5. **Three-Judge Panel** - Visual pairwise comparison (baseline vs candidate)
6. **Decision Engine** - Autonomous KEEP/REJECT decision
7. **Report Generator** - Creates summary and updates public status

### Loop Options

```bash
# Run up to 10 iterations
python3 optimization/scripts/run-loop.py cesiumjs-camera --max-iterations 10

# Stop after 3 consecutive ties (plateau)
python3 optimization/scripts/run-loop.py cesiumjs-camera --max-iterations 10 --stop-on plateau --plateau-n 3

# Stop immediately on first regression (REJECT)
python3 optimization/scripts/run-loop.py cesiumjs-camera --max-iterations 10 --stop-on regression

# Configure models and temperature
python3 optimization/scripts/run-loop.py cesiumjs-camera \
  --proposer-model claude-sonnet-4-5-20250929 \
  --proposer-temp 1.0 \
  --eval-model claude-sonnet-4-5-20250929 \
  --eval-temp 0.0 \
  --judge-models claude-sonnet-4-5-20250929 claude-sonnet-4-5-20250929 claude-sonnet-4-5-20250929
```

### Loop Stopping Conditions

The loop stops when any of these conditions is met:

- **max-iterations** - Completed the specified number of iterations
- **plateau** - N consecutive TIE decisions (no improvement detected)
- **regression** - First REJECT decision (breaking change detected)
- **SIGINT** - Ctrl+C pressed (graceful shutdown after current step)

### Loop Outputs

Each iteration produces:

- **Candidate skill** - `optimization/candidates/<skill>/<iteration>/SKILL.md`
- **Hypothesis** - `optimization/candidates/<skill>/<iteration>/hypothesis.md`
- **Generated code** - `optimization/generated/<skill>/<iteration>/<eval-id>.js`
- **Run bundles** - `optimization/runs/<skill>/<iteration>/<eval-id>-<name>/`
- **Decision** - `optimization/results/<skill>/<iteration>/decision.json`
- **Summary** - `optimization/results/<skill>/<iteration>/summary.md`

On KEEP decisions, the candidate skill replaces `skills/<skill>/SKILL.md`.

All iterations are archived to `optimization/history/<skill>/iteration-NNN/` for reproducibility.

### Coverage Analysis

Analyze which skill sections and APIs lack scenario coverage:

```bash
python3 optimization/scripts/analyze-coverage.py
```

Output is written to `optimization/results/coverage.json` with per-skill section and API coverage mappings.

The proposer uses this coverage data to prioritize gaps when suggesting skill revisions.

## Reproduce a Public Decision

To reproduce a decision from a published iteration:

1. Check out the repository at the commit referenced in the decision's `metadata.json`
2. Locate the archived iteration under `optimization/history/<skill>/iteration-NNN/`
3. Verify scenario hashes match the recorded baselines in `optimization/results/baselines.json`
4. Re-run the decision engine with archived artifacts:

```bash
python3 optimization/scripts/make-decision.py \
  cesiumjs-camera \
  001 \
  --check-results optimization/history/cesiumjs-camera/iteration-001/check-results.json \
  --judge-results optimization/history/cesiumjs-camera/iteration-001/judge-results.json \
  --scenario-meta optimization/history/cesiumjs-camera/iteration-001/scenario-meta.json \
  --baselines optimization/results/baselines.json
```

The decision engine is deterministic - same inputs always produce the same decision.

## Scenario Version Changes

When a scenario manifest is modified, its content hash changes. The framework requires explicit re-baselining:

```bash
# Preview the current scenario hash without writing baselines.json
python3 optimization/scripts/rebaseline-scenario.py cesiumjs-camera eval-001 --dry-run

# Re-baseline a single scenario after review
python3 optimization/scripts/rebaseline-scenario.py cesiumjs-camera eval-001

# Re-baseline updates optimization/results/baselines.json with the new hash
```

Until re-baselined, changed scenarios are excluded from win/loss counts and tagged `rebaseline_required` in decision reports.

## Local Artifact Safety

Before committing any results to `optimization/results/`, ensure they pass public safety checks:

```bash
python3 optimization/scripts/check-canonical-eval-surface.py
python3 optimization/scripts/check-public-artifacts.py
bash optimization/scripts/check-secrets.sh
```

The runner and report generator automatically validate outputs before writing tracked files.
