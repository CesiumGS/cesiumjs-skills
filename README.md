# CesiumJS Agent Skills

Curated agent skills for CesiumJS development — 14 domain skills covering ~551 public symbols across the CesiumJS v1.143 API surface.

See the [July 2026 / CesiumJS 1.143 coverage matrix](docs/DOMAINS.md#july-2026--cesiumjs-1143-coverage)
for the exact skill owner of every release addition, runtime fix, and announced
workflow surface.

## Quick Start

### OpenCode

Install OpenCode and run it from a checkout of this repository:

```bash
npm i -g opencode-ai@latest
opencode
```

OpenCode discovers Agent Skills from `skills/<name>/SKILL.md` in the project.

### Any Agent Skills-Compatible Tool

These skills follow the [Agent Skills](https://agentskills.io/) open standard. Copy or symlink the `skills/` directory into your workspace — skills are discovered automatically from `skills/<name>/SKILL.md`.

---

## Table of Contents

- [Skills Catalog](#skills-catalog)
- [Domain Mapping](#domain-mapping)
- [Architecture](#architecture)
- [Evaluation Framework](#evaluation-framework)
- [Compatibility](#compatibility)
- [Repository Layout](#repository-layout)
- [Contributing](#contributing)
- [License](#license)

## Skills Catalog


| Skill                            | Activates when...                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| **cesiumjs-viewer-setup**        | Initializing a CesiumJS app, configuring widgets, setting Ion tokens, bootstrapping a globe      |
| **cesiumjs-camera**              | Positioning the camera, flyTo animations, constraining navigation, entity tracking               |
| **cesiumjs-entities**            | Adding graphics and time-segmented paths; loading GeoJSON/KML/CZML/GPX through DataSources       |
| **cesiumjs-3d-tiles**            | Loading tilesets, compressed/CAD glTF, or MVT; styling, metadata, voxels, clipping               |
| **cesiumjs-imagery**             | Adding/swapping base map layers, configuring imagery providers, split-screen comparisons         |
| **cesiumjs-terrain-environment** | Configuring terrain, querying heights, atmosphere/sky/fog/lighting/shadows, panoramas            |
| **cesiumjs-primitives**          | Performance-critical static/vector geometry, GeoJsonPrimitive, BufferPrimitive collections       |
| **cesiumjs-materials-shaders**   | Fabric materials, ImageBasedLighting, post-processing effects, bloom, tonemapping                |
| **cesiumjs-custom-shader**       | Writing GLSL shader bodies for Model/Cesium3DTileset/VoxelPrimitive; feature IDs, EXT_structural_metadata |
| **cesiumjs-time-properties**     | Dynamic properties, simulation clock, interpolation, and interval/sampled path materials         |
| **cesiumjs-spatial-math**        | Coordinate conversions, ellipsoid geometry, model matrices, intersection tests, projections      |
| **cesiumjs-interaction**         | User clicks on the globe, multi-modifier shortcuts, entity/feature selection, hover, drag        |
| **cesiumjs-models-particles**    | Compressed/CAD glTF/GLB loading, edge display, animations, and particle effects                  |
| **cesiumjs-core-utilities**      | HTTP requests via Resource, Color, Event, error handling, helper functions                       |


## Domain Mapping

Every public class, function, and enum in CesiumJS is assigned to exactly one skill. Cross-domain ownership rules and the full symbol map are documented in the wiki's [Domain Mapping](wiki/Domain-Mapping.md) page.

## Architecture

The AI evaluation framework architecture is documented in the wiki's [Architecture Concept Document](wiki/Architecture-Concept-Document.md), with supporting architecture decision records in [`wiki/`](wiki/). The wiki is source-controlled in this repository and published from `main` by [`.github/workflows/wiki-sync.yml`](.github/workflows/wiki-sync.yml).

## Evaluation Framework

The repository now separates pure evaluation from self-optimization:

- [`evaluation/`](evaluation/) is the new deterministic evaluation surface. It is
  where unit-test-like scene-state checks and synthetic evaluation cases should
  be fleshed out.
- [`optimization/`](optimization/) contains the existing self-optimization loop:
  candidate generation, browser runs, pairwise judging, keep/reject decisions,
  promotion metadata, and historical results.

Reproduce the blocking CI checks locally with:

```bash
npm ci
npm run gate
npm run build --workspace @cesiumjs-skills/evaluation-console
npm test --workspace @cesiumjs-skills/evaluation-console
bash .github/scripts/workflow-safety.sh
```

`npm run gate` is the same script CI runs (`.github/scripts/gate.sh`): build,
both manifest suites, the skill contract, the unit tests, the deterministic
scorecard, and `verify-fixtures`, which asserts that every tracked fixture still
produces the result it declares. The three commands after it cover the other two
blocking jobs, and they are separate on purpose: a TypeScript error under
`apps/evaluation-console/src/` leaves `npm run gate` at exit 0 while the console
job goes red.

### Changing a skill

Editing `skills/<id>/SKILL.md` changes agent behaviour, so it gets its own CI
path on top of the gate above:

- **`cesium-eval check skills`** runs inside the gate on every pull request. It
  reads the skill file itself — frontmatter, the `Use when ...` activation
  clause, code fences that must parse, and CesiumJS symbols that must exist in
  [Domain Mapping](wiki/Domain-Mapping.md). Free, hermetic, works on forks.
- **[`skill-eval.yml`](.github/workflows/skill-eval.yml)** re-runs the real path
  for each changed skill that has scenarios: the edited wording goes into the
  codegen prompt, the result renders in headless Chromium, and the deterministic
  checks score it. Needs the `CODEX_AUTH_CONTENT` secret, so it does not run on
  forks.

See [ADR-0007](wiki/ADR-0007-Skill-Change-Evaluation.md) for why it is split in
two and what each tier does not catch.

Three parts of CI are not reproduced by the list above: `actionlint` (needs the
pinned binary the workflow installs), the full-history `gitleaks` scan, and
`gate.sh`'s clean-tree assertion, which is skipped outside CI by design because a
dirty working tree is normal while developing.

For local browser-backed optimization scenario reproduction, place generated JavaScript snippets under `optimization/generated/<skill>/<iteration>/`, set `CESIUM_ION_TOKEN`, and run:

```bash
node packages/eval/bin/cesium-eval.js optimize render cesiumjs-camera --iteration candidate --only eval-001
```

For the full autonomous optimization loop across every skill scenario group, use `cesium-eval optimize all --skills all --max-iterations 1` after configuring an agent CLI harness and setting `CESIUM_ION_TOKEN`. Role defaults (harness, model, reasoning effort) live in [`eval.config.json`](eval.config.json) and the harness/model catalog in [`config/harness-registry.json`](config/harness-registry.json); command-line flags and environment variables override them. To run the same phases through Codex CLI agents, pass `--proposer-harness codex --codegen-harness codex --judge-harness codex`; for GitHub Copilot CLI agents, use `copilot` as the harness id.
Raw generated code, HTML, screenshots, and run traces under `optimization/generated/` and `optimization/runs/` are local-only and gitignored by default.
The evaluation platform's unit tests live under `packages/eval/tests/`.
Scenario validation is read-only; update changed scenario hashes explicitly with `cesium-eval optimize rebaseline <skill> <eval-id>`.
Scenarios marked `runner_mode: "review-only"` are included in the public catalog but skipped by the browser runner until a compatible adapter exists.

The previous local tuning harness has been removed from the active repo surface. New self-optimization scenarios and results belong under `optimization/`; new deterministic, candidate-agnostic evaluation cases belong under `evaluation/`. See [`optimization/docs/source-of-truth.md`](optimization/docs/source-of-truth.md) and [`evaluation/README.md`](evaluation/README.md).

## Compatibility

The [Agent Skills](https://agentskills.io/) format is an open standard adopted by multiple AI development tools. These skills are plain Markdown files under `skills/`, so compatible tools can load them without provider-specific Python SDKs.

## Repository Layout

```
cesiumjs-skills/
├── skills/                          # The product
│   ├── cesiumjs-*/SKILL.md          # 14 domain skills (CesiumJS v1.143)
│   └── using-cesiumjs-skills/       # Bootstrap orientation skill
├── evaluation/                      # Pure deterministic evaluation cases, checks, and scripts
├── optimization/                    # Self-optimization loop, scripts, candidates, decisions, and results
├── wiki/                            # Source-controlled GitHub Wiki pages and reference docs
├── .github/workflows/wiki-sync.yml  # Publishes wiki/ to the GitHub Wiki from main
├── .mcp.json                        # Chrome DevTools MCP server
└── LICENSE
```

## Contributing

Keep product-facing skill guidance under [`skills/`](skills/), public evaluation scenarios and summaries under [`optimization/`](optimization/), and long-form reference material under [`wiki/`](wiki/). When changing skill coverage or public APIs, update [Domain Mapping](wiki/Domain-Mapping.md) and run the blocking CI checks listed above before opening a PR.

## License

[Apache 2.0](LICENSE)
