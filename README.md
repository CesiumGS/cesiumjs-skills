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

Run the lightweight public checks with:

```bash
pytest -q optimization/tests
pytest -q evaluation/tests
python3 evaluation/scripts/validate-evaluation.py
python3 optimization/scripts/validate-evals.py
python3 optimization/scripts/check-canonical-eval-surface.py
python3 optimization/scripts/check-public-artifacts.py
```

For local browser-backed optimization scenario reproduction, place generated JavaScript snippets under `optimization/generated/<skill>/<iteration>/`, set `CESIUM_ION_TOKEN`, and run:

```bash
python3 optimization/scripts/run-public-eval.py cesiumjs-camera --iteration candidate --only eval-001
```

For the full autonomous optimization loop across every skill scenario group, use `python3 optimization/scripts/run-all-evals.py --skills all --max-iterations 1` after configuring an agent CLI harness and setting `CESIUM_ION_TOKEN`. The default is GPT-5.6 Sol (`github-copilot/gpt-5.6-sol` on OpenCode, `gpt-5.6-sol` on Codex) pinned to `low` reasoning effort for proposal, code generation, and judging, to keep batch calls cheap and fast. To test the same phases through Codex CLI agents, pass `--proposer-harness codex --eval-harness codex --judge-harness codex`.
Raw generated code, HTML, screenshots, and run traces under `optimization/generated/` and `optimization/runs/` are local-only and gitignored by default.
Optimization-specific tests live under `optimization/tests/`; pure evaluation tests live under `evaluation/tests/`.
Scenario validation is read-only; update changed scenario hashes explicitly with `python3 optimization/scripts/rebaseline-scenario.py <skill> <eval-id>`.
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

Keep product-facing skill guidance under [`skills/`](skills/), public evaluation scenarios and summaries under [`optimization/`](optimization/), and long-form reference material under [`wiki/`](wiki/). When changing skill coverage or public APIs, update [Domain Mapping](wiki/Domain-Mapping.md) and run the public checks listed above before opening a PR.

## License

[Apache 2.0](LICENSE)
