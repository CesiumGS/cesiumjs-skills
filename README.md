# CesiumJS Agent Skills

Curated agent skills for CesiumJS development — 14 domain skills covering ~551 public symbols across the CesiumJS v1.143 API surface, with native plugin support for Codex and Claude Code.

See the [July 2026 / CesiumJS 1.143 coverage matrix](docs/DOMAINS.md#july-2026--cesiumjs-1143-coverage)
for the exact skill owner of every release addition, runtime fix, and announced
workflow surface.

## Quick Start

### Codex

**One-line install (recommended):**

```bash
codex plugin marketplace add CesiumGS/cesiumjs-skills && codex plugin add cesiumjs-skills@cesiumjs-skills
```

This registers the CesiumJS Skills marketplace and installs the plugin, including all 14 skills, the SessionStart hook, and the Chrome DevTools MCP server. Start a new Codex session after installation so the skills and tools are loaded.

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
- [Compatibility](#compatibility)
- [Repository Layout](#repository-layout)
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

Every public class, function, and enum in CesiumJS is assigned to exactly one skill. Cross-domain ownership rules and the full symbol map are documented in [`docs/DOMAINS.md`](docs/DOMAINS.md).

## Compatibility

The [Agent Skills](https://agentskills.io/) format is an open standard originally developed by Anthropic and adopted by leading AI development tools including Claude Code, GitHub Copilot, and many others.

This repository ships as native plugins for both **Codex** and **Claude Code**, with a SessionStart hook and Chrome DevTools MCP integration for browser-based verification.

## Repository Layout

```
cesiumjs-skills/
├── skills/                          # The product
│   ├── cesiumjs-*/SKILL.md          # 14 domain skills (CesiumJS v1.143)
│   └── using-cesiumjs-skills/       # Bootstrap orientation skill
├── docs/
│   ├── DOMAINS.md                   # Symbol ownership map
│   └── skills-catalog.md            # Skills catalog
├── .agents/plugins/marketplace.json # Codex plugin marketplace catalog
├── .codex-plugin/plugin.json        # Codex plugin manifest
├── .claude-plugin/
│   ├── plugin.json                  # Claude Code plugin manifest
│   └── marketplace.json             # Plugin marketplace catalog
├── .mcp.json                        # Chrome DevTools MCP server
├── hooks/                           # SessionStart hook + runner
└── LICENSE
```

## License

[Apache 2.0](LICENSE)
