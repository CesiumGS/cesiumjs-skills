# Optimization Pipeline Source of Truth

`optimization/` is the supported source of truth for the CesiumJS skills
self-optimization pipeline. Live optimization scenario manifests, aggregate
public summaries, baselines, schemas, scripts, and tests belong under
`optimization/`.

Pure deterministic evaluation is intentionally separate. New unit-test-like
evaluation cases and scene-state assertions belong under `evaluation/`, where
they can run without proposer, judge, decision, or promotion side effects.

The previous experimental tuning tree has been removed from the tracked active
repo surface. It served as an early local research harness with duplicate
scenarios, generated iteration history, old runner helpers, old coverage tools,
local agent configuration, and curated screenshots. Those artifacts are not
required to understand or run the current public eval framework.

## Migration Audit

The old scenario candidates were compared against the current public scenario
catalog before removal.

| Old skill area | Old scenario count | Outcome |
| --- | ---: | --- |
| `cesiumjs-camera` | 14 | Already covered exactly by `optimization/scenarios/cesiumjs-camera/`. |
| `cesiumjs-entities` | 5 | Already covered exactly by `optimization/scenarios/cesiumjs-entities/`. |
| `cesiumjs-imagery` | 15 | Already covered exactly by `optimization/scenarios/cesiumjs-imagery/`. |
| `cesiumjs-viewer-setup` | 7 | Already covered by schema-evolved scenarios in `optimization/scenarios/cesiumjs-viewer-setup/`. |

No old scenario lacked a current public counterpart, so no scenario migration was
needed in this cleanup.

## Active Optimization Rules

- Add new self-optimization scenarios only under `optimization/scenarios/<skill>/`.
- Keep raw generated code and browser run outputs under ignored local paths such
  as `optimization/generated/` and `optimization/runs/`.
- Keep candidate snapshots, per-iteration decision folders, generated dashboards,
  and history archives local or as CI artifacts. Commit only compact aggregate
  result state such as `optimization/results/baselines.json`,
  `optimization/results/public-status.json`, and
  `optimization/results/coverage.json`.
- Use the current public runner, `optimization/framework/` implementation modules, and
  report outputs; do not restore old local tuning helpers as active code.
- Do not put deterministic unit-style evaluation cases here. Put them in
  `evaluation/cases/` with explicit check contracts.
- Keep historical context as concise documentation only, not as a second
  runnable framework.
