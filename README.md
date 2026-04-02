# CesiumJS Agent Skills

Curated agent skills for CesiumJS development — 13 domain skills covering ~535 public symbols across the CesiumJS v1.139 API surface.

## Table of Contents

- [Skills Catalog](#skills-catalog)
- [Domain Mapping](#domain-mapping)
- [Compatibility](#compatibility)
- [Getting Started](#getting-started)
- [Repository Layout](#repository-layout)
- [License](#license)

## Skills Catalog

| Skill | Activates when... |
|---|---|
| **cesiumjs-viewer-setup** | Initializing a CesiumJS app, configuring widgets, setting Ion tokens, bootstrapping a globe |
| **cesiumjs-camera** | Positioning the camera, flyTo animations, constraining navigation, entity tracking |
| **cesiumjs-entities** | Adding points/labels/models/polygons, loading GeoJSON/KML/CZML/GPX data |
| **cesiumjs-3d-tiles** | Loading tilesets, styling features, querying metadata, voxels, point clouds, clipping |
| **cesiumjs-imagery** | Adding/swapping base map layers, configuring imagery providers, split-screen comparisons |
| **cesiumjs-terrain-environment** | Configuring terrain, querying heights, atmosphere/sky/fog/lighting/shadows, panoramas |
| **cesiumjs-primitives** | Performance-critical static geometry, custom shapes, batching, billboard/label/point collections |
| **cesiumjs-materials-shaders** | Custom materials, GLSL shaders, post-processing effects, bloom, tonemapping |
| **cesiumjs-time-properties** | Time-dynamic entity attributes, simulation clock, interpolation, sampled/callback properties |
| **cesiumjs-spatial-math** | Coordinate conversions, ellipsoid geometry, model matrices, intersection tests, projections |
| **cesiumjs-interaction** | User clicks on the globe, entity/feature selection, hover effects, drag interactions |
| **cesiumjs-models-particles** | glTF/GLB model loading, animations, particle effects (fire, smoke) |
| **cesiumjs-core-utilities** | HTTP requests via Resource, Color, Event, error handling, helper functions |

## Domain Mapping

Every public class, function, and enum in CesiumJS is assigned to exactly one skill. Cross-domain ownership rules and the full symbol map are documented in [`skills/cesiumjs/DOMAINS.md`](skills/cesiumjs/DOMAINS.md).

## Compatibility

These skills follow the [Agent Skills](https://agentskills.io/) open standard and work with any tool that supports it — Claude Code, GitHub Copilot, Cursor, Android Studio with Gemini, and others.

By popular demand, this repository also ships as a **Claude Code plugin** with a SessionStart hook and Chrome DevTools MCP integration for browser-based verification.

## Getting Started

### Claude Code

**From the terminal:**

```bash
claude plugin marketplace add CesiumGS/cesiumjs-skills
claude plugin install cesiumjs-skills@cesiumjs-skills
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

## Repository Layout

```
cesiumjs-skills/
├── skills/                          # The product
│   ├── cesiumjs-*/SKILL.md          # 13 domain skills (CesiumJS v1.139)
│   ├── using-cesiumjs-skills/       # Bootstrap orientation skill
│   ├── cesiumjs/DOMAINS.md          # Symbol ownership map
│   └── README.md                    # Skills catalog
├── .claude-plugin/
│   ├── plugin.json                  # Claude Code plugin manifest
│   └── marketplace.json             # Plugin marketplace catalog
├── .mcp.json                        # Chrome DevTools MCP server
├── hooks/                           # SessionStart hook + runner
└── LICENSE
```

## License

[Apache 2.0](LICENSE)
