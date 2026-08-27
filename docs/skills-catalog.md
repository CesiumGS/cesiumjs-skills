# Skills Catalog

Use the orientation skill when the request spans the collection or when the owning domain
is unclear. Use a domain skill directly when the task already has a precise CesiumJS
surface.

## Orientation

| Skill | Use it for |
| --- | --- |
| [`using-cesiumjs-skills`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/using-cesiumjs-skills) | Discover the collection, choose global-script or module conventions, and route multi-domain requests |

## Application and scene setup

| Skill | Activates when… |
| --- | --- |
| [`cesiumjs-viewer-setup`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-viewer-setup) | Initializing an application, configuring Viewer widgets, platform services, credits, or render modes |
| [`cesiumjs-camera`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-camera) | Positioning or animating the camera, constraining navigation, or tracking scene objects |
| [`cesiumjs-terrain-environment`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-terrain-environment) | Configuring terrain, height queries, globe state, atmosphere, fog, sky, lighting, or shadows |

## Content and visualization

| Skill | Activates when… |
| --- | --- |
| [`cesiumjs-entities`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-entities) | Adding high-level graphics or loading GeoJSON, KML, CZML, or GPX data sources |
| [`cesiumjs-3d-tiles`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-3d-tiles) | Loading streamed geospatial content, styling features, querying metadata, clipping, or voxels |
| [`cesiumjs-imagery`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-imagery) | Adding providers, managing imagery layers, or comparing raster sources |
| [`cesiumjs-models-particles`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-models-particles) | Loading glTF/GLB, controlling model animations and edges, or building particle effects |

## Rendering and performance

| Skill | Activates when… |
| --- | --- |
| [`cesiumjs-primitives`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-primitives) | Rendering performance-critical static or batched geometry with lower-level APIs |
| [`cesiumjs-materials-shaders`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-materials-shaders) | Applying Fabric materials, image-based lighting, bloom, tonemapping, or post-processing |
| [`cesiumjs-custom-shader`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-custom-shader) | Authoring model or voxel shader bodies and reading feature IDs or structural metadata |

## Behavior and foundations

| Skill | Activates when… |
| --- | --- |
| [`cesiumjs-time-properties`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-time-properties) | Building simulations, sampled values, callbacks, intervals, interpolation, or dynamic graphics |
| [`cesiumjs-spatial-math`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-spatial-math) | Converting coordinates, composing transforms, calculating intersections, or using projections |
| [`cesiumjs-interaction`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-interaction) | Handling mouse or touch input, picking scene content, selection, hover, or dragging |
| [`cesiumjs-core-utilities`](https://github.com/CesiumGS/cesiumjs-skills/tree/main/skills/cesiumjs-core-utilities) | Fetching resources, scheduling requests, managing events, colors, errors, and core helpers |

## A practical selection test

Choose an **entity** when you need declarative, time-aware objects managed by data sources.
Choose a **primitive** when you need explicit batching, lower-level lifecycle control, or
high-volume static geometry. Choose a **model** or **3D Tiles** workflow when the content
already exists as glTF or streamed tiles rather than geometry created in the application.

For API-level ownership, use the [Domain Mapping](domain-mapping.md).
