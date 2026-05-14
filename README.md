# CesiumJS Agent Skills

Curated agent skills for CesiumJS development — 14 domain skills covering ~535 public symbols across the CesiumJS v1.139 API surface.

## Quick Start

### Claude Code

**One-Liner from the terminal (recommended):**

```bash
claude plugin marketplace add CesiumGS/cesiumjs-skills
```

**From inside Claude Code:**

1. Type `/plugin` and press Enter
2. Select **Add Marketplace**
3. Enter `CesiumGS/cesiumjs-skills`
4. Once the marketplace is added, type `/plugin` again
5. Select **Install Plugin**
6. Choose **cesiumjs-skills** from the list

After installing, run `/reload-plugins` to activate the skills in your current session.

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
- [License](#license)

## Skills Catalog


| Skill                            | Activates when...                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| **cesiumjs-viewer-setup**        | Initializing a CesiumJS app, configuring widgets, setting Ion tokens, bootstrapping a globe      |
| **cesiumjs-camera**              | Positioning the camera, flyTo animations, constraining navigation, entity tracking               |
| **cesiumjs-entities**            | Adding points/labels/models/polygons, loading GeoJSON/KML/CZML/GPX data                          |
| **cesiumjs-3d-tiles**            | Loading tilesets, styling features, querying metadata, voxels, point clouds, clipping            |
| **cesiumjs-imagery**             | Adding/swapping base map layers, configuring imagery providers, split-screen comparisons         |
| **cesiumjs-terrain-environment** | Configuring terrain, querying heights, atmosphere/sky/fog/lighting/shadows, panoramas            |
| **cesiumjs-primitives**          | Performance-critical static geometry, custom shapes, batching, billboard/label/point collections |
| **cesiumjs-materials-shaders**   | Fabric materials, ImageBasedLighting, post-processing effects, bloom, tonemapping                |
| **cesiumjs-custom-shader**       | Writing GLSL shader bodies for Model/Cesium3DTileset/VoxelPrimitive; feature IDs, EXT_structural_metadata |
| **cesiumjs-time-properties**     | Time-dynamic entity attributes, simulation clock, interpolation, sampled/callback properties     |
| **cesiumjs-spatial-math**        | Coordinate conversions, ellipsoid geometry, model matrices, intersection tests, projections      |
| **cesiumjs-interaction**         | User clicks on the globe, entity/feature selection, hover effects, drag interactions             |
| **cesiumjs-models-particles**    | glTF/GLB model loading, animations, particle effects (fire, smoke)                               |
| **cesiumjs-core-utilities**      | HTTP requests via Resource, Color, Event, error handling, helper functions                       |


## Domain Mapping

Every public class, function, and enum in CesiumJS is assigned to exactly one skill. Cross-domain ownership rules and the full symbol map are documented in [`docs/DOMAINS.md`](docs/DOMAINS.md).

## Architecture

The AI evaluation framework architecture is documented in [`.architecture/acd.md`](.architecture/acd.md), with supporting architecture decision records in `.architecture/`. Source-controlled GitHub Wiki pages live in [`wiki/`](wiki/) and are published from `main` by [`.github/workflows/wiki-sync.yml`](.github/workflows/wiki-sync.yml).

## Evaluation Framework

Public v1 evaluation scenarios and sanitized status summaries live in [`evals/`](evals/). Run the lightweight public checks with:

```bash
python3 scripts/validate-evals.py
python3 scripts/check-public-artifacts.py
```

For local browser-backed scenario reproduction, place generated JavaScript snippets under `evals/generated/<skill>/<iteration>/`, set `CESIUM_ION_TOKEN`, and run:

```bash
python3 scripts/run-public-eval.py cesiumjs-camera --iteration candidate --only eval-001
```

Raw generated code, HTML, screenshots, and run traces under `evals/generated/` and `evals/runs/` are local-only and gitignored by default.

## Compatibility

The [Agent Skills](https://agentskills.io/) format is an open standard originally developed by Anthropic and adopted by leading AI development tools including Claude Code, GitHub Copilot, and many others.

By popular demand, this repository also ships as a **Claude Code plugin** with a SessionStart hook and Chrome DevTools MCP integration for browser-based verification.

## Repository Layout

```
cesiumjs-skills/
├── skills/                          # The product
│   ├── cesiumjs-*/SKILL.md          # 14 domain skills (CesiumJS v1.139)
│   └── using-cesiumjs-skills/       # Bootstrap orientation skill
├── docs/
│   ├── DOMAINS.md                   # Symbol ownership map
│   └── skills-catalog.md            # Skills catalog
├── .architecture/                   # ACD and ADRs for the AI eval framework
├── evals/                           # Public-safe eval scenarios and summaries
├── wiki/                            # Source-controlled GitHub Wiki pages
├── .github/workflows/wiki-sync.yml  # Publishes wiki/ to the GitHub Wiki from main
├── scripts/                         # Secret, public-artifact, and eval validation tools
├── .claude-plugin/
│   ├── plugin.json                  # Claude Code plugin manifest
│   └── marketplace.json             # Plugin marketplace catalog
├── .mcp.json                        # Chrome DevTools MCP server
├── hooks/                           # SessionStart hook + runner
└── LICENSE
```

## License

[Apache 2.0](LICENSE)
