---
name: cesiumjs-camera
description: "CesiumJS camera control - Camera, flyTo, lookAt, setView, ScreenSpaceCameraController, CameraEventAggregator, flight animation. Use when positioning the camera, creating flyTo animations, constraining user navigation, tracking entities, or converting between screen and world coordinates."
---
# CesiumJS Camera & Navigation

> **Baseline:** CesiumJS v1.139 -- ES module imports (`import { ... } from "cesium";`)

## Camera Fundamentals

Access via `viewer.camera`. The camera has a `position` (Cartesian3 in world
coords), orientation vectors (`direction`, `up`, `right`), and a frustum.
All angles are **radians**.

Read-only computed properties: `positionWC`, `positionCartographic`,
`directionWC`, `upWC`, `rightWC`, `heading` (0 = north, clockwise), `pitch`
(negative = down), `roll`, `transform`, `viewMatrix`, `inverseViewMatrix`.

Events: `moveStart` / `moveEnd` fire when movement begins/ends. `changed`
fires when the camera moves by more than `percentageChanged` (default 0.5).

### Altitude & Orientation Guidelines

Choose altitude and pitch to match the **scale of the feature** you want to show:

| View type | Altitude (m) | Pitch (deg) | Notes |
|---|---|---|---|
| **Landmark close-up** | 500 -- 1,500 | -25 to -35 | Individual buildings/structures fill the frame. Use `lookAt` with appropriate range. |
| **City panoramic / skyline** | 800 -- 1,500 | -10 to -20 | For viewing a skyline from across a river or bay. Position camera to the side, face the city. Suggest loading OSM Buildings for 3D effect. |
| **City overview** | 2,000 -- 5,000 | -35 to -50 | Urban grid, rivers, and parks clearly visible |
| **Metro / regional** | 8,000 -- 20,000 | -60 to -90 | Entire metro area or geographic feature |
| **Canyon / cliff rim** | 50 -- 300 above rim | -15 to -25 | Use steeper pitch to reveal depth below. Near-horizontal (-5) looks flat across terrain. |
| **Country / continent** | 500,000 -- 5,000,000 | -90 | Political boundaries, coastlines |

**When the prompt says "looking at [city]" or "start at [city]"**, default to **city overview** range (2,000-5,000 m) with pitch around **-45** to **-60** degrees and heading **0** (north). This produces a clear, recognizable view where the urban layout, rivers, and landmarks are identifiable.

**Top-down views** (`pitch: -90`) are best for geographic features (canyons, coastlines, rivers) where overhead perspective reveals the distinctive shape. For cities, prefer an angled view that shows the 3D skyline.

> **Ground-level views (altitude < 200 m, near-horizontal pitch) require 3D Tiles.**
> Without OSM Buildings or Google Photorealistic 3D Tiles, CesiumJS renders only flat
> terrain imagery -- a camera at 25 m looking horizontally sees sky and a flat ground
> plane with no buildings or structures. If the user requests a ground-level view,
> **add a code comment** that 3D Tiles must be loaded, and suggest a higher-altitude
> fallback.

> **Skyline panoramics** (across a river/bay): use 800-1,500 m altitude, pitch -10
> to -20. Pitch too horizontal (-5) at moderate altitude shows a flat grid, not a
> dramatic skyline. Suggest `Cesium.createOsmBuildingsAsync()` for 3D silhouette.

> **Canyon / cliff rim views**: pitch -15 to -25 to reveal depth. Near-horizontal
> pitch (-5 to -8) looks flat across terrain and misses the vertical drop.

---

## setView -- Instant Placement

Teleports the camera in a single frame -- no animation, no tween overhead.
Use `setView` when you need the camera in position before the user sees
anything (initial view, resetting after a mode change, constraint setup).

`destination` is a `Cartesian3` or `Rectangle`.
`orientation` accepts `{ heading, pitch, roll }` or `{ direction, up }`.

```js
import { Cartesian3, Math as CesiumMath } from "cesium";

// City overview: 3000 m altitude, angled view facing north
viewer.camera.setView({
  destination: Cartesian3.fromDegrees(-0.1276, 51.5074, 3000.0),
  orientation: {
    heading: CesiumMath.toRadians(0.0),   // north
    pitch: CesiumMath.toRadians(-50.0),    // angled down -- shows city layout clearly
    roll: 0.0,
  },
});
```

```js
import { Cartesian3, Math as CesiumMath } from "cesium";

// Canyon rim perspective: slightly above rim, looking down into the canyon
// Pitch of -20 reveals depth; near-horizontal (-5) would look flat across
viewer.camera.setView({
  destination: Cartesian3.fromDegrees(-112.14, 36.06, 2400.0),
  orientation: {
    heading: CesiumMath.toRadians(0.0),
    pitch: CesiumMath.toRadians(-20.0),    // steeper pitch to show canyon depth
    roll: 0.0,
  },
});
```

```js
import { Rectangle } from "cesium";

// View a geographic rectangle (top-down, orientation defaults to north/down)
viewer.camera.setView({
  destination: Rectangle.fromDegrees(-77.0, 38.0, -72.0, 42.0),
});
```

---

## flyTo -- Animated Flight

Smoothly animates the camera. Returns nothing (not a Promise); use the
`complete` callback to know when the flight lands. Key options: `destination`,
`orientation`, `duration` (seconds), `complete`/`cancel` callbacks,
`maximumHeight`, `pitchAdjustHeight`, `flyOverLongitude`, `easingFunction`.

```js
import { Cartesian3, Math as CesiumMath } from "cesium";

// Fly to a landmark: 1500 m gives a clear view of the surrounding area
viewer.camera.flyTo({
  destination: Cartesian3.fromDegrees(2.2945, 48.8584, 1500.0),
  orientation: {
    heading: CesiumMath.toRadians(0.0),
    pitch: CesiumMath.toRadians(-35.0),
    roll: 0.0,
  },
  duration: 3,
});
```

```js
import { Cartesian3, Math as CesiumMath } from "cesium";

// Chain flights using the complete callback (flyTo does NOT return a Promise)
viewer.camera.flyTo({
  destination: Cartesian3.fromDegrees(-74.0445, 40.6892, 800.0),
  orientation: {
    heading: CesiumMath.toRadians(0.0),
    pitch: CesiumMath.toRadians(-35.0),
    roll: 0.0,
  },
  duration: 3,
  complete() {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(-73.9857, 40.758, 600.0),
      orientation: {
        heading: CesiumMath.toRadians(0.0),
        pitch: CesiumMath.toRadians(-40.0),
        roll: 0.0,
      },
      duration: 2,
    });
  },
});
```

> **Altitude tip for chained flights / tours**: keep each stop at **600 m+** to
> ensure 3D tiles and imagery have time to load. Very low altitudes (< 400 m) may
> show blurry tiles or incomplete building geometry, especially on fast
> successive flights.

```js
// Long-distance flight: LA to Tokyo via Europe
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(139.815, 35.714, 20000.0),
  duration: 20,
  flyOverLongitude: Cesium.Math.toRadians(60.0), // eastward via Europe
  pitchAdjustHeight: 1000, // look down at high altitude
});
```

Control in-progress flights with `completeFlight()` (jumps to end state) and
`cancelFlight()` (stays at current position).

---

## flyHome

Fly to the default view. Override with `Camera.DEFAULT_VIEW_RECTANGLE`.

```js
import { Camera, Rectangle } from "cesium";

Camera.DEFAULT_VIEW_RECTANGLE = Rectangle.fromDegrees(-10.0, 35.0, 40.0, 60.0);
viewer.camera.flyHome(2.0); // duration in seconds; omit for auto
```

---

## lookAt -- Lock Camera to Target

Positions the camera to look at a world-coordinate target from an offset
(`HeadingPitchRange` or `Cartesian3` in the local ENU frame). **The camera is
locked until you call `lookAtTransform(Matrix4.IDENTITY)`.** Forgetting to
release locks the user out of navigation permanently.

```js
import { Cartesian3, Math as CesiumMath, HeadingPitchRange } from "cesium";

// View from the south, looking north (heading 0 = facing north = camera is south)
const target = Cartesian3.fromDegrees(2.2945, 48.8584, 300.0);
viewer.camera.lookAt(
  target,
  new HeadingPitchRange(
    CesiumMath.toRadians(0.0),   // heading 0 = north-facing
    CesiumMath.toRadians(-20.0), // pitch -- 20 deg down
    1500.0,                      // range in meters
  ),
);
```

```js
import { Cartesian3, Math as CesiumMath, HeadingPitchRange } from "cesium";

// View from the east, looking west (heading 270 = facing west = camera is east)
const target = Cartesian3.fromDegrees(-73.9857, 40.7484, 200.0);
viewer.camera.lookAt(
  target,
  new HeadingPitchRange(
    CesiumMath.toRadians(270.0), // heading -- west
    CesiumMath.toRadians(-25.0), // pitch -- 25 deg down
    800.0,                       // range in meters
  ),
);
```

```js
import { Matrix4 } from "cesium";

// ALWAYS release the lookAt lock when done to restore free navigation
viewer.camera.lookAtTransform(Matrix4.IDENTITY);
```

> **Trap:** Every `lookAt` call MUST have a matching `lookAtTransform(Matrix4.IDENTITY)`.
> Without the release, mouse/touch/keyboard navigation is permanently disabled.
> Use `setTimeout`, `complete` callback, or an event to trigger the release.

> **lookAt heading:** heading = direction camera **faces**. 0 = north (camera is
> south of target). 90 = east (camera west). 180 = south (camera north).
> 270 = west (camera east).

---

## lookAtTransform -- Custom Reference Frames

Set camera position relative to an arbitrary transform matrix.

```js
import { Cartesian3, Transforms, HeadingPitchRange, Math as CesiumMath } from "cesium";

// View in an east-north-up frame centered on a point
const center = Cartesian3.fromDegrees(-75.598, 40.039);
const transform = Transforms.eastNorthUpToFixedFrame(center);
viewer.camera.lookAtTransform(
  transform,
  new HeadingPitchRange(0.0, CesiumMath.toRadians(-45.0), 5000.0),
);
```

For ICRF (inertial) frame views where stars stay fixed, use
`Transforms.computeIcrfToFixedMatrix(time)` in a `postUpdate` listener and apply
via `lookAtTransform(Matrix4.fromRotationTranslation(icrfToFixed), offset)`.

---

## flyToBoundingSphere / viewBoundingSphere

Frame the camera around a `BoundingSphere`. Range is auto-computed when 0.

```js
import { BoundingSphere, Cartesian3, HeadingPitchRange, Math as CesiumMath } from "cesium";

const sphere = new BoundingSphere(Cartesian3.fromDegrees(-117.16, 32.71), 1000.0);

// Animated
viewer.camera.flyToBoundingSphere(sphere, {
  offset: new HeadingPitchRange(0.0, CesiumMath.toRadians(-45.0), 0.0),
  duration: 2.0,
});

// Instant
viewer.camera.viewBoundingSphere(sphere);
```

---

## Movement, Rotation, Look, and Zoom Methods

**Movement** (translate position by meters, default `defaultMoveAmount` = 100 km):
`moveForward`, `moveBackward`, `moveUp`, `moveDown`, `moveLeft`, `moveRight`,
`move(direction, amount)`.

**Rotation** (orbit around reference frame center, preserves distance, default
`defaultRotateAmount` = PI/3600 rad): `rotateUp`, `rotateDown`, `rotateLeft`,
`rotateRight`, `rotate(axis, angle)`.

**Look** (first-person rotate-in-place, default `defaultLookAmount` = PI/60 rad):
`lookUp`, `lookDown`, `lookLeft`, `lookRight`, `look(axis, angle)`,
`twistLeft`, `twistRight`.

**Zoom** (along view direction, default `defaultZoomAmount` = 100 km):
`zoomIn(amount)`, `zoomOut(amount)`.

```js
// Scale movement speed to altitude for natural feel
const height = viewer.scene.globe.ellipsoid
  .cartesianToCartographic(viewer.camera.position).height;
const speed = height / 100.0;
viewer.camera.moveForward(speed);
```

---

## ScreenSpaceCameraController

Handles default mouse/touch input. Access via
`viewer.scene.screenSpaceCameraController`.

### Constraining Navigation

When setting up constraints, **also position the camera with `setView`** so the
initial view respects the constraints and clearly shows the target area.

```js
import { Cartesian3, Math as CesiumMath } from "cesium";

const ctrl = viewer.scene.screenSpaceCameraController;

ctrl.minimumZoomDistance = 500;       // meters from surface
ctrl.maximumZoomDistance = 50000;
ctrl.maximumTiltAngle = Math.PI / 2; // prevent going below horizon

// Disable specific interactions
ctrl.enableRotate = false;
ctrl.enableTilt = false;
ctrl.enableZoom = false;
ctrl.enableTranslate = false; // 2D / Columbus only
ctrl.enableLook = false;
ctrl.enableInputs = false;    // disable everything at once

// Set initial view at city-overview altitude for a clear starting point
viewer.camera.setView({
  destination: Cartesian3.fromDegrees(-0.1276, 51.5074, 3000.0),
  orientation: {
    heading: CesiumMath.toRadians(0.0),
    pitch: CesiumMath.toRadians(-50.0),
    roll: 0.0,
  },
});
```

Other properties: `inertiaSpin`, `inertiaZoom`, `inertiaTranslate` (0 = none,
0.9 = default), `enableCollisionDetection` (set `false` to allow camera underground).

### Remapping Input Events

```js
import { CameraEventType, KeyboardEventModifier } from "cesium";

const ctrl = viewer.scene.screenSpaceCameraController;
ctrl.rotateEventTypes = CameraEventType.RIGHT_DRAG;
ctrl.tiltEventTypes = {
  eventType: CameraEventType.LEFT_DRAG,
  modifier: KeyboardEventModifier.CTRL,
};
ctrl.zoomEventTypes = CameraEventType.WHEEL;
```

`CameraEventType` values: `LEFT_DRAG`, `RIGHT_DRAG`, `MIDDLE_DRAG`, `WHEEL`,
`PINCH`. Combine with `KeyboardEventModifier`: `SHIFT`, `CTRL`, `ALT`.

---

## Custom First-Person Controls

Disable default camera controller, then use `ScreenSpaceEventHandler` for
mouse-look and `keydown`/`keyup` for WASD movement. In a `clock.onTick`
listener, call `cam.lookRight`/`lookUp` for mouse delta and
`cam.moveForward`/`moveLeft`/etc. for keys. Scale movement speed to altitude
(`cam.positionCartographic.height / 100`) for natural feel.

```js
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Cartesian3 } from "cesium";
const ctrl = viewer.scene.screenSpaceCameraController;
ctrl.enableRotate = ctrl.enableTranslate = ctrl.enableZoom = false;
ctrl.enableTilt = ctrl.enableLook = false;

const canvas = viewer.canvas;
canvas.setAttribute("tabindex", "0");
let looking = false, startPos, mousePos;
const handler = new ScreenSpaceEventHandler(canvas);
handler.setInputAction((m) => { looking = true; startPos = mousePos = Cartesian3.clone(m.position); }, ScreenSpaceEventType.LEFT_DOWN);
handler.setInputAction((m) => { mousePos = m.endPosition; }, ScreenSpaceEventType.MOUSE_MOVE);
handler.setInputAction(() => { looking = false; }, ScreenSpaceEventType.LEFT_UP);

const flags = {};
document.addEventListener("keydown", (e) => { flags[e.code] = true; });
document.addEventListener("keyup", (e) => { flags[e.code] = false; });
viewer.clock.onTick.addEventListener(() => {
  const cam = viewer.camera;
  if (looking) {
    cam.lookRight((mousePos.x - startPos.x) / canvas.clientWidth * 0.05);
    cam.lookUp(-(mousePos.y - startPos.y) / canvas.clientHeight * 0.05);
  }
  const spd = viewer.scene.globe.ellipsoid.cartesianToCartographic(cam.position).height / 100;
  if (flags.KeyW) cam.moveForward(spd);  if (flags.KeyS) cam.moveBackward(spd);
  if (flags.KeyA) cam.moveLeft(spd);     if (flags.KeyD) cam.moveRight(spd);
  if (flags.KeyQ) cam.moveUp(spd);       if (flags.KeyE) cam.moveDown(spd);
});
```

---

## Camera Events

```js
const off = viewer.camera.moveStart.addEventListener(() => console.log("moving"));
viewer.camera.moveEnd.addEventListener(() => console.log("stopped"));
// off(); // call return value to unsubscribe

viewer.camera.percentageChanged = 0.1; // threshold for change detection
viewer.camera.changed.addEventListener((pct) => console.log(`Changed ${(pct*100).toFixed(1)}%`));
```

---

## pickEllipsoid -- Screen to Globe

```js
import { Cartesian2 } from "cesium";

const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
const worldPos = viewer.camera.pickEllipsoid(center);
if (worldPos) {
  const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(worldPos);
  console.log(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));
}
```

---

## Entity Tracking

```js
// Track an entity (sets camera to follow automatically)
viewer.trackedEntity = viewer.entities.getById("vehicle");

// Customize default tracking offset
import { Camera, HeadingPitchRange, Math as CesiumMath } from "cesium";
Camera.DEFAULT_OFFSET = new HeadingPitchRange(
  CesiumMath.toRadians(90.0), CesiumMath.toRadians(-25.0), 500.0,
);

viewer.trackedEntity = undefined; // stop tracking
```

`EntityView` internally computes VVLH or ENU reference frames depending on entity speed.

Visualize a camera frustum with `DebugCameraPrimitive`:
`viewer.scene.primitives.add(new Cesium.DebugCameraPrimitive({ camera: viewer.camera, color: Cesium.Color.YELLOW, updateOnChange: true }));`

---

## Performance Tips

1. **Prefer `setView` over `flyTo` with `duration: 0`** -- direct assignment
   avoids tween overhead.
2. **Avoid reading `heading`/`pitch`/`roll` every frame** -- each computes an
   ENU transform. Cache or use `direction`/`up` vectors instead.
3. **Throttle `changed` events** -- raise `percentageChanged` (e.g., 0.5) to
   reduce listener frequency.
4. **Always release `lookAt` locks** -- call
   `lookAtTransform(Matrix4.IDENTITY)` or user interaction stays disabled.
5. **Set `maximumHeight` for short flights** -- prevents the camera from
   zooming to space on nearby targets.
6. **Scale movement to altitude** -- divide camera height for natural speed
   in per-frame move loops.
7. **Re-enable collision after underground views** -- set
   `enableCollisionDetection` back to `true` once done.
8. **Use 600 m+ altitude for tour stops** -- very low altitudes cause blurry
   tiles and incomplete 3D building geometry on successive flights.

---

## Common Patterns Quick Reference

| Task | Method | Key detail |
|---|---|---|
| Jump to a city | `setView` | 2,000-5,000 m, pitch -50, heading 0 |
| Animate to a landmark | `flyTo` | 1,000-2,000 m, pitch -30 to -40, set `duration` |
| City skyline / panoramic | `setView` or `flyTo` | 800-1,500 m, pitch -10 to -20. Position camera across river/bay, face the city. |
| Overhead / map view | `setView` or `flyTo` | pitch -90, altitude matches feature size |
| Canyon / cliff rim | `setView` or `flyTo` | 50-300 m above rim, pitch -15 to -25 for depth |
| Lock on a target | `lookAt` | **Must** release with `lookAtTransform(Matrix4.IDENTITY)` |
| Camera tour (multi-stop) | `flyTo` chain | Use `complete` callback, keep altitude 600 m+ |
| Ground-level / street view | `setView` | **Requires 3D Tiles** (OSM Buildings or Google Photorealistic). Without them, only sky and flat ground visible. |
| Constrain user nav | `screenSpaceCameraController` | Set min/max zoom, tilt angle; also call `setView` for initial position |

---

## See Also

- **cesiumjs-spatial-math** -- Cartesian3, Cartographic, Matrix4, Transforms, coordinate conversions
- **cesiumjs-interaction** -- ScreenSpaceEventHandler, Scene.pick, mouse/touch events
- **cesiumjs-entities** -- Entity, trackedEntity, EntityCollection, data sources
