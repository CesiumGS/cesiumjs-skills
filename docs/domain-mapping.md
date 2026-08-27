# Domain Mapping

The collection partitions CesiumJS into 14 focused domains. A request may activate
several skills, but each public symbol is documented by one primary owner.

## Domain map

| Surface | Owning skill | Typical requests |
| --- | --- | --- |
| Application shell and platform services | `cesiumjs-viewer-setup` | Create a Viewer, configure widgets, initialize Ion, choose render modes |
| Camera and navigation | `cesiumjs-camera` | Fly, look at, constrain movement, track entities |
| High-level scene objects and data sources | `cesiumjs-entities` | Add graphics, load GeoJSON/KML/CZML/GPX, organize entities |
| Streamed geospatial content | `cesiumjs-3d-tiles` | Load and style tilesets, inspect metadata, clip content, work with voxels |
| Raster layers | `cesiumjs-imagery` | Add providers, manage layer order, build split-screen comparisons |
| Globe and atmosphere | `cesiumjs-terrain-environment` | Configure terrain, sample heights, control fog, sky, lighting, and shadows |
| Low-level geometry | `cesiumjs-primitives` | Batch static geometry, manage collections, tune rendering performance |
| Materials and scene effects | `cesiumjs-materials-shaders` | Use Fabric materials, image-based lighting, and post-processing stages |
| Custom model shading | `cesiumjs-custom-shader` | Author model or voxel shader bodies and consume structural metadata |
| Time and dynamic properties | `cesiumjs-time-properties` | Configure clocks, sampled values, callbacks, interpolation, and intervals |
| Coordinates and geometry math | `cesiumjs-spatial-math` | Convert coordinates, build transforms, intersect geometry, use projections |
| Input and picking | `cesiumjs-interaction` | Handle pointer events, select content, hover, drag, and drill-pick |
| Models and particles | `cesiumjs-models-particles` | Load glTF/GLB, control animations, render edges, create particle effects |
| Networking and core helpers | `cesiumjs-core-utilities` | Fetch resources, schedule requests, handle events, colors, and errors |

## Cross-domain routing rules

| If the request says… | Start with… | Add when needed… |
| --- | --- | --- |
| “Create a viewer and fly to this model” | Viewer setup | Models and camera |
| “Click a building and color the selected feature” | Interaction | 3D Tiles or entities, plus materials if the effect is scene-wide |
| “Animate an aircraft along sampled positions” | Time properties | Entities, models, and camera tracking |
| “Clamp geometry to terrain and query its height” | Terrain/environment | Entities or primitives, depending on representation |
| “Render metadata-driven model styling” | Custom shader | Models or 3D Tiles for loading and lifecycle |
| “Optimize thousands of static shapes” | Primitives | Spatial math for transforms and bounding volumes |

## Ownership rules

1. **Constructors and enums have one owner.** Other skills link to the owner when a
   workflow depends on them.
2. **Representation determines routing.** High-level `Entity` graphics and low-level
   `Primitive` geometry solve related problems but have different lifecycle and
   performance contracts.
3. **Loading and styling can be separate domains.** A tileset belongs to 3D Tiles, while
   a scene post-process effect belongs to materials and shaders.
4. **Shared concepts do not imply duplicate documentation.** Coordinates remain spatial
   math even when used in camera, entity, or terrain examples.

## Canonical inventory

This page is a routing overview. The full class, function, interface, enum, and ownership
inventory remains source-controlled in
[wiki/Domain-Mapping.md](https://github.com/CesiumGS/cesiumjs-skills/blob/main/wiki/Domain-Mapping.md).
Update that canonical file whenever public API ownership changes.
