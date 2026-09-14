# Add an Evaluation Scenario

Evaluation scenarios are public, versioned task manifests stored under:

```text
optimization/scenarios/<skill>/eval-NNN-short-name.json
```

Start from an existing scenario in the same skill directory and keep the manifest understandable without private context.

## Required Fields

Each scenario must include:

- `id` - Stable id in `eval-NNN` format.
- `name` - Short slug-like name.
- `difficulty` - Scenario difficulty label.
- `description` - What behavior the scenario exercises.
- `prompt` - Public-safe task prompt given to the agent.
- `expected_behaviors` - Concrete behaviors the output should satisfy.
- `visual_expectations` - What a correct rendered scene should show.
- `programmatic_checks` - Deterministic checks such as `no_console_errors`, `code_runs`, `pattern_present`, or `pattern_absent`.
- `screenshots` - Capture timing and description.
- `regression_critical` - Whether losing this scenario blocks a candidate.
- `runner_mode` - Optional. Use `global-js` for scenarios runnable by `cesium-eval optimize render`; use `review-only` for public catalog scenarios that need a future adapter.

The human-readable schema is in `optimization/schemas/scenario.schema.json`.

## Acceptance Rules

A good scenario should:

- Exercise a real CesiumJS user workflow.
- Map to one or more skill sections or public APIs.
- Avoid private URLs, local paths, credentials, customer data, and private planning references.
- Have deterministic checks that catch basic failures without pretending to replace visual review.
- Mark `regression_critical` only when a loss should block a candidate.

## Validate

Run:

```bash
node packages/eval/bin/cesium-eval.js validate --suite optimization
node packages/eval/bin/cesium-eval.js check canonical-surface
node packages/eval/bin/cesium-eval.js check public-artifacts
```

If the scenario affects visual quality, also run a local browser reproduction with `cesium-eval optimize render <skill> --only <eval-id>` before requesting review.
