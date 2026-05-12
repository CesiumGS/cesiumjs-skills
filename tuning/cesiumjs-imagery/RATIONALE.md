# Eval Rationale: cesiumjs-imagery

This document explains why the first imagery eval suite is organized the way it is,
what each eval is trying to prove, and which sections are intentionally deferred.

## Suite Design Principles

1. **Prefer public or ion-backed providers first.**
   The first suite prioritizes viewer-verifiable scenarios that can run with the
   existing Cesium ion token or public map services.

2. **Use recognizable real-world geography.**
   Imagery is much easier to judge when the region has obvious cartographic or
   terrain signatures: Paris, London, Grand Canyon, Florida, Japan, Manhattan,
   Greenland, Hawaii.

3. **Separate visible behavior from invisible wiring.**
   Some imagery APIs are easy to see in a screenshot (`splitDirection`,
   `cutoutRectangle`, base-layer swaps). Others are mostly code-level concerns
   (`errorEvent`, `NeverTileDiscardPolicy`). The suite still renders a real scene
   for the latter, but relies more heavily on programmatic checks.

4. **Use the suite to stress wording, not only API mention.**
   The goal is not just “did the model name the class,” but “did the skill
   produce the right kind of visual outcome for the requested scene.”

## Eval Groups

### Fundamentals

- `eval-001-ion-night-overlay-nyc`
  Tests the async factory path, ion imagery, and display-property tuning on a
  highly recognizable urban corridor.

- `eval-002-osm-base-layer-paris`
  Tests the most common imagery operation: replacing the base layer with a new
  cartographic provider.

- `eval-003-layer-management-grid-london`
  Tests layer collection manipulation with an unmistakable visible debug overlay.

### Public Raster Services

- `eval-004-usgs-hydro-wms-grand-canyon`
  Tests WMS on a geographically distinctive region.

- `eval-005-usgs-shaded-relief-wmts-grand-canyon`
  Tests WMTS with the same landmark so differences come from the service and not
  from camera ambiguity.

- `eval-009-arcgis-streets-dc`
  Covers the ArcGIS URL-based workflow using a recognizable city-center street map.

- `eval-012-time-dynamic-wmts-greenland`
  Covers time-dynamic WMTS using a northern regional raster where thematic data is
  plausible and visible.

### Visual Layer Manipulation

- `eval-006-split-screen-day-night-europe`
  Tests split-screen imagery comparison.

- `eval-007-cutout-rectangle-florida`
  Tests a cutout reveal with a simple visual story.

- `eval-008-color-to-alpha-japan`
  Tests color-keyed transparency using night lights over a dense urban region.

- `eval-010-single-tile-alert-florida`
  Covers the single-tile provider with a self-generated overlay image, avoiding
  dependency on a checked-in asset file.

### Advanced / Mixed

- `eval-011-label-drape-osm-buildings-nyc`
  Covers imagery draped on 3D tiles instead of the globe.

- `eval-013-never-discard-policy-iceland`
  Covers discard-policy wiring in a real visible map scene.

- `eval-014-layer-error-events-london`
  Covers `readyEvent` / `errorEvent` wiring while still rendering a normal scene.

- `eval-015-regional-provider-performance-hawaii`
  Converts the performance guidance into a real bounded-provider scenario instead
  of leaving it as prose-only advice.

## Intentional Omissions

### BingMapsImageryProvider

Not included in the active first suite because it normally requires a Bing key.
It is heuristically covered by the analyzer through overlap, but not treated as an
execution target yet.

### MapboxStyleImageryProvider

Also omitted from active execution coverage because it requires a Mapbox access
token. It should be added only when stable credentials are available for the
evaluation environment.

### See Also

Not a real eval target. It is intentionally excluded from coverage decisions.

## What This Suite Is Good At

- Catching wrong provider selection
- Catching missing overlay configuration
- Catching weak visual phrasing around split, cutout, and transparency features
- Catching poor examples for public map service setup

## What This Suite Is Not Yet Good At

- Judging token-gated provider sections end to end
- Measuring subjective map-style quality beyond obvious visual mismatches
- Evaluating every performance tip with real network or GPU telemetry

Those can come in later rounds once the baseline pass/fail behavior is stable.
