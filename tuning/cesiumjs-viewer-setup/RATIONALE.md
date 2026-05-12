# Eval Rationale: cesiumjs-viewer-setup

This document explains the design thinking behind each eval scenario — what it tests,
why it matters, and what failure modes it's designed to catch.

---

## Eval 001: Basic Globe with Terrain

**The simplest possible CesiumJS app.** We ask the LLM: "make a viewer with terrain."

If the skill is doing its job, the LLM should produce code that:

1. Sets the Ion access token **before** creating the Viewer (order matters — if you
   create the Viewer first, it tries to fetch tiles without auth and fails)
2. Creates a `new Viewer("cesiumContainer")`
3. Passes `terrain: Terrain.fromWorldTerrain()` to get elevation data
4. Includes the CSS import and HTML div

This is our **sanity check**. If this breaks, nothing else matters. The screenshot
should show a globe with mountains and valleys.

**Difficulty:** Easy
**Regression critical:** Yes

---

## Eval 002: Minimal Viewer, No Widgets

**We ask: "give me a clean globe with zero UI."**

CesiumJS ships with **11 widget toggles** that default to `true`:
- animation, baseLayerPicker, fullscreenButton, geocoder, homeButton, infoBox,
  sceneModePicker, selectionIndicator, timeline, navigationHelpButton
- (plus projectionPicker and vrButton which default to false)

The LLM has to disable **all** of them. The common failure here is forgetting one or
two — `selectionIndicator` and `navigationHelpButton` are the ones that slip through
most often because they're less well-known.

**Why this matters for optimization:** The skill's widget toggle table must be clear
and complete enough that the LLM doesn't miss any options. A screenshot judge can catch
stray UI elements that a code-only check would miss.

**Difficulty:** Medium
**Regression critical:** Yes

---

## Eval 003: Production NYC with OSM Buildings

**The "real world" scenario.** A production-ready viewer with world terrain, OSM 3D
buildings, and camera positioned over lower Manhattan.

The tricky parts:

1. `createOsmBuildingsAsync()` is async — you must `await` it, then call
   `viewer.scene.primitives.add(tileset)` to put it in the scene
2. NYC coordinates: longitude must be **negative** (-74.01) because it's west of the
   prime meridian. Getting the sign wrong puts you in Central Asia.
3. Camera altitude needs to be reasonable — 750-2000m for a city view, not 100km
   (which shows a tiny dot) or 10m (which is inside buildings)

**Why screenshots are powerful here:** We can see whether buildings actually rendered,
whether the location looks like Manhattan, whether the altitude is sensible. A
code-only check can verify the longitude is negative, but can't tell if the scene
*looks right*.

**Difficulty:** Medium
**Regression critical:** Yes

---

## Eval 004: Google Photorealistic 3D Tiles (Trap Scenario)

**This is the hardest eval for this skill.**

Google provides photorealistic 3D tiles (actual photogrammetry with textured buildings,
trees, etc.) through CesiumJS. But Google's Terms of Service require that if you use
their 3D tiles, you **must** use Google's geocoder (search bar), not Bing's or Cesium
Ion's default. This is a legal requirement, not a technical one — the code works fine
without it, but you'd be violating Google's ToS.

In CesiumJS, this translates to two specific code requirements:

```js
// 1. Must set geocoder to Google type
const viewer = new Viewer("cesiumContainer", {
  geocoder: IonGeocodeProviderType.GOOGLE
});

// 2. Must acknowledge compliance
const tileset = await createGooglePhotorealistic3DTileset({
  onlyUsingWithGoogleGeocoder: true
});
```

The `onlyUsingWithGoogleGeocoder: true` parameter is literally an acknowledgment
flag — it exists so developers consciously confirm they're using the Google geocoder.

**Why this is a trap:** If the skill doesn't communicate this clearly, the LLM will
produce code that **works** but **violates ToS**. That's worse than a crash because
it's a silent legal issue. This eval tests whether the skill's wording around Google
3D Tiles is strong enough to make the LLM include both flags.

**Difficulty:** Hard
**Regression critical:** No (the app still works without the flags, just violates ToS)

---

## Eval 005: 2D Map with OSM Base Layer (Dependency Trap)

**Tests a hidden dependency between two constructor options.**

If you provide a custom `baseLayer` but leave `baseLayerPicker` at its default
(`true`), CesiumJS throws a runtime error. The base layer picker widget tries to
manage the imagery layers itself, and it conflicts with the explicitly-set base layer:

```js
const viewer = new Viewer("cesiumContainer", {
  sceneMode: SceneMode.SCENE2D,
  baseLayerPicker: false,  // MUST be false when using custom baseLayer
  baseLayer: new ImageryLayer(new OpenStreetMapImageryProvider({
    url: "https://tile.openstreetmap.org/"
  }))
});
```

**Why this matters for optimization:** This is a common "why is my app crashing?"
issue. The skill needs to communicate this dependency clearly — either in the table
of constructor options or in the code examples. If the dependency is buried or
unclear, the LLM will omit `baseLayerPicker: false` and produce crashing code.

The screenshot should show OSM's distinctive cartographic style (road labels, pastel
building outlines) in a flat 2D projection, not a 3D globe.

**Difficulty:** Medium
**Regression critical:** No

---

## Eval 006: Space Scene, No Globe (Cascading Options)

**Tests understanding of cascading disabled options.**

The key setting is `globe: false`, which removes the Earth entirely. But there's a
cascading effect:

```js
const viewer = new Viewer("cesiumContainer", {
  globe: false,           // Remove Earth surface
  skyAtmosphere: false,   // Remove the blue atmospheric glow
  baseLayerPicker: false, // No imagery layers without a globe
});
```

**The visual bug:** If you set `globe: false` but forget `skyAtmosphere: false`, you
get a weird floating blue ring in space — the atmospheric limb glow rendering with no
planet inside it. It looks broken.

Similarly, trying to add terrain when there's no globe is nonsensical but not always
caught as an error.

**Why screenshots matter:** The floating blue ring is a visual-only bug. The code
doesn't error. Only a screenshot judge would catch it.

**Difficulty:** Medium
**Regression critical:** No

---

## Eval 007: Low-Power Dashboard (Performance + Cross-Domain)

**Tests the performance tips section and cross-skill interaction.**

The key technique is `requestRenderMode`, which stops CesiumJS from rendering 60fps
continuously:

```js
const viewer = new Viewer("cesiumContainer", {
  requestRenderMode: true,           // Don't render every frame
  maximumRenderTimeChange: Infinity, // Only render when explicitly asked
  scene3DOnly: true,                 // Skip 2D/CV geometry
});
```

Normally CesiumJS renders continuously even if nothing changes on screen. With
`requestRenderMode: true`, it only renders on change — camera moves, data updates,
or explicit `scene.requestRender()` calls. This cuts battery usage dramatically.

**The cross-domain twist:** The prompt also asks to add a point entity, which crosses
into the `cesiumjs-entities` skill's domain. This tests:
- Whether the viewer-setup skill plays well with other skills
- Whether the LLM understands that the Entity API auto-triggers render requests
  (so you don't need to manually call `requestRender()` after adding entities)

**Difficulty:** Hard
**Regression critical:** No

---

## Overall Design Principles

1. **Easy → Hard progression:** Scenarios 001-003 are fundamentals, 004-007 are
   traps and edge cases. Optimization should first ensure fundamentals are solid,
   then improve performance on trap scenarios.

2. **Trap scenarios test wording precision:** The hard evals are specifically designed
   around non-obvious dependencies and subtle requirements that are only communicated
   well if the skill's wording is precise. These are where optimization will have the
   most measurable impact.

3. **Screenshots catch what code checks can't:** The floating blue ring (eval 006),
   wrong camera altitude (eval 003), and stray UI widgets (eval 002) are all visual
   bugs that produce no errors. The multimodal judge is essential for these.

4. **Regression-critical vs non-critical:** Evals 001-003 are marked critical because
   they test the fundamental purpose of the skill. Evals 004-007 test advanced
   patterns where regression is acceptable if the overall skill improves.
