# Run Skill Evaluations Locally

The public v1 evaluation workflow has multiple layers:

1. Cheap deterministic checks that validate public manifests and public-facing artifacts.
2. Browser-backed reproduction runs for maintainers who have a Cesium ion token.
3. Full autonomous loop for skill evaluation and optimization.

## Prerequisites

### Install Dependencies

Install the workspace dependencies and build the `cesium-eval` CLI:

```bash
npm ci
npm run build --workspace @cesiumjs-skills/eval
npx playwright install chromium
```

### Set Environment Variables

Export required tokens for full pipeline execution:

```bash
opencode auth login --provider github-copilot
codex login
copilot login
export CESIUM_ION_TOKEN="<your-cesium-ion-token>"
export AGENT_HARNESS="opencode"  # or "codex", or "copilot"
# Defaults to github-copilot/gpt-5.6-sol (opencode) or gpt-5.6-sol (codex,
# copilot) at "low" reasoning effort; override with OPENCODE_MODEL/
# OPENCODE_VARIANT, CODEX_MODEL/CODEX_VARIANT, or COPILOT_MODEL/COPILOT_VARIANT
# (and role-specific variants, e.g. OPENCODE_PROPOSER_VARIANT) if needed.
```

**Note:** OpenCode, Codex CLI, and GitHub Copilot CLI each handle authentication through their local login state. Deterministic checks and the browser runner work without model access.

## Validate Public Artifacts

Run the blocking CI checks before proposing changes to eval scenarios,
architecture docs, wiki pages, or public summaries:

```bash
npm ci
npm run gate
npm run build --workspace @cesiumjs-skills/evaluation-console
npm test --workspace @cesiumjs-skills/evaluation-console
bash .github/scripts/workflow-safety.sh
```

`npm run gate` runs `.github/scripts/gate.sh`, the same definition CI uses, which
covers the build, both manifest suites, the unit tests, the deterministic
scorecard, `verify-fixtures`, and both hygiene checks. The earlier list on this
page was narrower than CI in ways that mattered: it never ran
`validate --suite evaluation`, never ran the unit tests, and never scored
anything. It also listed `check-secrets.sh`, which the `secret-scan` workflow
does invoke, but running it bare does not reproduce that lane: CI installs a
pinned gitleaks 8.18.2, runs the scanner self-test first, and narrows the scan to
the pull-request commit range.

None of these require external model access. Not reproduced locally:
`actionlint`, the full-history gitleaks scan, and `gate.sh`'s clean-tree
assertion, which is CI-only by design.

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
node packages/eval/bin/cesium-eval.js optimize render cesiumjs-camera --iteration 001 --only eval-001
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

Only compact aggregate summaries should be committed under
`optimization/results/*.json`. Per-run bundles and per-iteration summaries are
local or CI artifacts by default.

## Run Full Autonomous Loop

The autonomous loop orchestrates the complete evaluation pipeline from proposal to decision:

### Full Loop Execution

Run a complete multi-iteration evaluation loop for a skill:

```bash
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera --max-iterations 5 --stop-on plateau
```

This executes the 7-step pipeline for each iteration:

1. **Proposer** - Analyzes history and proposes skill revision
2. **Skills Adapter** - Generates JavaScript for all scenarios
3. **Browser Runner** - Executes code in headless Chromium
4. **Deterministic Checks** - Runs programmatic validation
5. **Three-Judge Panel** - Visual pairwise comparison (baseline vs candidate)
6. **Decision Engine** - Autonomous KEEP/REJECT decision
7. **Report Generator** - Creates summary and updates public status

### Promotion Gate (human-in-the-loop)

A `KEEP` decision does **not** modify `skills/<skill>/SKILL.md` by default. The
candidate is staged as `optimization/candidates/<skill>/<iteration>/PROMOTED-PENDING.md`,
the loop stops, and the CLI prints the apply command:

```bash
# Review the staged candidate, then apply it (backs up the previous version):
node packages/eval/bin/cesium-eval.js optimize promote cesiumjs-camera 001

# Or opt in to automatic promotion for unattended runs:
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera --max-iterations 5 --promote
```

### Loop Options

```bash
# Run up to 10 iterations
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera --max-iterations 10

# Stop after 3 consecutive ties (plateau)
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera --max-iterations 10 --stop-on plateau --plateau-n 3

# Stop immediately on first regression (REJECT)
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera --max-iterations 10 --stop-on regression

# Configure harnesses, model, reasoning variants, and temperature.
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera \
  --proposer-harness opencode \
  --proposer-model auto \
  --proposer-variant high \
  --proposer-temperature 1.0 \
  --eval-harness opencode \
  --eval-model auto \
  --eval-variant medium \
  --eval-temperature 1.0 \
  --judge-harness opencode \
  --judge-model auto \
  --judge-variant medium

# Run the same proposal, codegen, and judge phases through Codex CLI agents.
node packages/eval/bin/cesium-eval.js optimize loop cesiumjs-camera \
  --max-iterations 1 \
  --proposer-harness codex \
  --eval-harness codex \
  --judge-harness codex \
  --proposer-model auto \
  --eval-model auto \
  --judge-model auto
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

The candidate, decision, summary, and history folders are ignored local outputs.
CI uploads them as workflow artifacts when the visual workflow runs. The
repository keeps only the promoted skill change and compact aggregate result
state.

### Coverage Analysis

Analyze which skill sections and APIs lack scenario coverage:

```bash
node packages/eval/bin/cesium-eval.js optimize coverage
```

Output is written to `optimization/results/coverage.json` with per-skill section and API coverage mappings.

The proposer uses this coverage data to prioritize gaps when suggesting skill revisions.

## Reproduce a Workflow Artifact Decision

To reproduce a decision from a visual workflow artifact:

1. Check out the repository at the commit referenced in the artifact metadata.
2. Download the evaluation report artifact from the visual workflow run.
3. Verify scenario hashes match the recorded baselines in `optimization/results/baselines.json`
4. Re-run the decision engine with the artifact's check, judge, and scenario metadata files:

```bash
node packages/eval/bin/cesium-eval.js optimize decide \
  cesiumjs-camera \
  001 \
  --check-results path/to/artifact/check-results.json \
  --judge-results path/to/artifact/judge-results.json \
  --scenario-meta path/to/artifact/scenario-meta.json \
  --baselines optimization/results/baselines.json
```

The decision engine is deterministic - same inputs always produce the same decision.

## Scenario Version Changes

When a scenario manifest is modified, its content hash changes. The framework requires explicit re-baselining:

```bash
# Preview the current scenario hash without writing baselines.json
node packages/eval/bin/cesium-eval.js optimize rebaseline cesiumjs-camera eval-001 --dry-run

# Re-baseline a single scenario after review
node packages/eval/bin/cesium-eval.js optimize rebaseline cesiumjs-camera eval-001

# Re-baseline updates optimization/results/baselines.json with the new hash
```

Until re-baselined, changed scenarios are excluded from win/loss counts and tagged `rebaseline_required` in decision reports.

## Local Artifact Safety

Before committing aggregate result updates, ensure they pass public safety checks:

```bash
node packages/eval/bin/cesium-eval.js check canonical-surface
node packages/eval/bin/cesium-eval.js check public-artifacts
bash optimization/scripts/check-secrets.sh
```

The runner and report generator validate public outputs before writing them.
