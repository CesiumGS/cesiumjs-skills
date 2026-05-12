# CesiumJS Camera API Research Notes

**Date:** 2026-04-08
**Purpose:** Identify authoritative best practices, gotchas, and conventions to improve the CesiumJS camera skill.

---

## 1. camera.lookAt + HeadingPitchRange: Heading Convention

### Authoritative Sources
- [Camera API Reference](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html)
- [HeadingPitchRange API Reference](https://cesium.com/learn/cesiumjs/ref-doc/HeadingPitchRange.html)
- [HeadingPitchRange Source Code (1.131)](https://github.com/CesiumGS/cesium/blob/1.131/packages/engine/Source/Core/HeadingPitchRange.js)
- [Control the Camera Tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-camera/)
- [Community: Heading, Pitch, Roll](https://community.cesium.com/t/heading-pitch-roll/1873)

### Key Findings

**There are conflicting descriptions in the official docs, which is a major source of confusion:**

| Source | Heading Definition |
|---|---|
| **Camera.lookAt JSDoc** | "The heading is the angle from y axis and increasing towards the x axis." |
| **HeadingPitchRange.js source** | "Heading is the rotation from the local east direction where a positive angle is increasing southward." |
| **General HPR convention (community-confirmed)** | "Heading is the rotation from the local north direction where a positive angle is increasing eastward." |

**Resolution:** The general HPR convention is the one that matches actual behavior. In the local East-North-Up (ENU) reference frame:
- **heading = 0** means the camera **faces north** (the camera's look direction points north)
- **Positive heading** rotates **clockwise** when viewed from above (north -> east -> south -> west)
- This is compass-convention heading, matching Google Earth

**For `lookAt` specifically:** When you call `camera.lookAt(target, new HeadingPitchRange(0, pitch, range))`:
- heading=0: The camera looks toward the target from the **south** (the camera faces north, so it must be positioned south of the target)
- heading=PI/2 (90 deg): Camera looks toward target from the **west** (camera faces east)
- heading=PI (180 deg): Camera looks toward target from the **north** (camera faces south)

**The Camera.js source code applies a `- CesiumMath.PI_OVER_TWO` adjustment** when converting heading to internal quaternion rotations, which confirms heading=0 is north-facing in user-facing API terms despite the y-axis description in some docs.

### Pitch Convention (Critical Discrepancy!)

| Context | Positive Pitch |
|---|---|
| **HeadingPitchRange source JSDoc** | "Positive pitch angles are **above** the plane." |
| **Camera.lookAt JSDoc** | "Positive pitch angles are **below** the plane." |
| **General camera HPR** | "Negative pitch angles are below the plane" (i.e., looking down) |

**For `lookAt` with HeadingPitchRange:** In practice, a **negative pitch** (e.g., `-Math.PI/4`) angles the camera **downward** toward the target, which is the most common use case. The Camera tutorial example uses `pitch: -Math.PI / 4` for a 45-degree downward look.

### Skill Improvement Opportunities
- **Must teach:** heading=0 means the camera faces north. For lookAt, this positions the camera to the south of the target looking north toward it.
- **Must warn:** The official docs have inconsistent descriptions of heading and pitch conventions. The skill should provide a clear, unambiguous explanation with examples.
- **Must provide:** A reference table mapping heading values to compass directions for lookAt positioning.
- **Must note:** The `- PI/2` internal adjustment means the "angle from y-axis" description in some docs refers to the internal math, not the user-facing API.

---

## 2. camera.flyTo Orientation Best Practices

### Authoritative Sources
- [Camera API Reference](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html)
- [Control the Camera Tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-camera/)
- [Community: How to set camera orientation in flyTo](https://community.cesium.com/t/how-to-set-camera-orientation-in-flyto/7187)
- [GitHub Issue: flyTo pitch -90 causes crazy flights](https://github.com/CesiumGS/cesium/issues/2468)
- [Community: flyTo pitch + roll interaction](https://community.cesium.com/t/viewer-camera-flyto-if-there-is-no-pitch-90-and-you-set-the-roll-the-heading-changes/4517)

### Key Findings

**Two orientation formats for flyTo:**
1. **Heading/Pitch/Roll** (most common):
   ```javascript
   viewer.camera.flyTo({
     destination: Cesium.Cartesian3.fromDegrees(-117.16, 32.71, 15000.0),
     orientation: {
       heading: Cesium.Math.toRadians(20.0),
       pitch: Cesium.Math.toRadians(-35.0),
       roll: 0.0,
     }
   });
   ```
2. **Direction/Up vectors** (unit vectors - for advanced use):
   ```javascript
   orientation: {
     direction: new Cesium.Cartesian3(...),
     up: new Cesium.Cartesian3(...)
   }
   ```

**Default orientation for flyTo:** If no orientation is specified, "the direction will point towards the center of the frame in 3D and in the negative z direction in Columbus view. The up direction will point towards local north in 3D."

**Recommended values by view type:**
| View Type | Heading | Pitch | Roll | Notes |
|---|---|---|---|---|
| Top-down/nadir | 0 | -90 deg (-PI/2) | 0 | Straight down; avoid exact -90, use -89.99 |
| City overview (45 deg) | 0-360 | -35 to -45 deg | 0 | Good for landmarks |
| Street-level oblique | varies | -10 to -20 deg | 0 | Near-horizontal |
| Orbit/panoramic | varies | -15 to -30 deg | 0 | Good for rotation views |

### Gotchas

1. **Gimbal lock at pitch = -90 degrees (exactly):** Using `pitch: -Math.PI/2` exactly can cause erratic camera flights. The camera direction has no horizontal component, so heading becomes undefined. **Workaround:** Use `-Math.PI/2 + 0.0001` instead. This was fixed in PR #2825 for flyTo, but the underlying singularity remains for heading calculations.

2. **Roll is usually 0:** Setting roll to non-zero while pitch is near -90 degrees causes heading to change unexpectedly. "If there is no pitch (-90), and you set the roll, the heading changes." Keep roll at 0 unless you have a specific reason.

3. **flyTo vs setView:** `flyTo` animates the transition; `setView` is instant. `setView` can zoom to greater distances than `flyTo` in 2D mode.

4. **maximumHeight parameter:** Controls the peak altitude during the flight arc. Useful for preventing the camera from going too high during long-distance flights.

### Skill Improvement Opportunities
- **Must warn:** About the pitch = -90 gimbal lock issue and provide the workaround.
- **Should provide:** Recommended pitch values for common view types (overview, street-level, oblique).
- **Should teach:** Keep roll at 0 unless intentionally tilting the horizon.
- **Should explain:** The difference between flyTo (animated) and setView (instant) and when to use each.

---

## 3. ScreenSpaceCameraController Constraining Examples

### Authoritative Sources
- [ScreenSpaceCameraController API Reference](https://cesium.com/learn/ion-sdk/ref-doc/ScreenSpaceCameraController.html)
- [ScreenSpaceCameraController Source (1.136)](https://github.com/CesiumGS/cesium/blob/1.136/packages/engine/Source/Scene/ScreenSpaceCameraController.js)
- [Community: maximumZoomDistance not working](https://community.cesium.com/t/screenspacecameracontroller-maximumzoomdistance-not-work/18076)
- [GitHub Issue: maximumZoomDistance + collision detection](https://github.com/CesiumGS/cesium/issues/10303)
- [Community: How to prevent camera tilt/rotation](https://community.cesium.com/t/how-to-prevent-camera-tilt-rotation/8577)
- [GitHub PR: Added maximumTiltAngle](https://github.com/CesiumGS/cesium/pull/12169)

### Complete Property Reference

**Enable/Disable flags:**
| Property | Default | Effect |
|---|---|---|
| `enableInputs` | `true` | Master switch for all inputs |
| `enableZoom` | `true` | Zoom in/out |
| `enableRotate` | `true` | Rotation (3D only) |
| `enableTilt` | `true` | Camera tilt (3D/Columbus) |
| `enableTranslate` | `true` | Panning (2D/Columbus) |
| `enableLook` | `true` | Free-look (3D/Columbus) |

**Distance constraints:**
| Property | Default | Notes |
|---|---|---|
| `minimumZoomDistance` | `1.0` meters | Closest zoom |
| `maximumZoomDistance` | `Infinity` | Farthest zoom |

**Angle constraints:**
| Property | Default | Notes |
|---|---|---|
| `maximumTiltAngle` | `undefined` | In radians; `undefined` = unrestricted. Added Oct 2024. |

**Collision detection:**
| Property | Default | Notes |
|---|---|---|
| `enableCollisionDetection` | `true` | Prevents camera going underground |
| `minimumCollisionTerrainHeight` | `15000.0` m | Below this height, terrain collision is checked |

**Inertia (0 = no inertia, closer to 1 = more inertia):**
| Property | Default |
|---|---|
| `inertiaSpin` | `0.9` |
| `inertiaTranslate` | `0.9` |
| `inertiaZoom` | `0.8` |

**Other:**
| Property | Default | Notes |
|---|---|---|
| `maximumMovementRatio` | `0.1` | Limits input to percentage of window |
| `bounceAnimationTime` | `3.0` sec | Duration of bounce-back animation |
| `zoomFactor` | `5.0` | Zoom speed multiplier |

### Gotchas

1. **CRITICAL: `maximumZoomDistance` is ignored when `enableCollisionDetection` is `false`.** The source code explicitly checks `enableCollisionDetection` before enforcing zoom distance limits. If you disable collision detection (e.g., to allow underground views), zoom distance constraints stop working. This is filed as [issue #10303](https://github.com/CesiumGS/cesium/issues/10303).

2. **Property name confusion:** `enableRotate` actually controls **translation/panning** in some contexts, while `enableTilt` controls both **rotation AND tilt**. The names are misleading. Setting `enableTilt = false` prevents the user from rotating the camera around the current view center.

3. **`maximumTiltAngle` is relatively new** (merged Oct 2024, PR #12169). The value is in **radians**. Setting it to `Math.PI / 2` prevents the camera from going underground. Default is `undefined` (unrestricted).

4. **`minimumCollisionTerrainHeight` matters for performance:** Collision detection is only active below this altitude (default 15km). Above it, collision checks are skipped.

### Skill Improvement Opportunities
- **Must warn:** About the `maximumZoomDistance` + `enableCollisionDetection` interaction.
- **Must clarify:** The confusing `enableRotate` vs `enableTilt` naming.
- **Should teach:** `maximumTiltAngle` as the modern way to prevent underground camera views.
- **Should note:** Inertia values range from 0 to <1, and can be set to 0 to disable momentum/inertia.

---

## 4. CameraEventType Remapping

### Authoritative Sources
- [ScreenSpaceCameraController API Reference](https://cesium.com/learn/ion-sdk/ref-doc/ScreenSpaceCameraController.html)
- [CameraEventType API Reference](https://cesium.com/downloads/cesiumjs/releases/1.16/Build/Documentation/CameraEventType.html)
- [KeyboardEventModifier API Reference](https://cesium.com/downloads/cesiumjs/releases/b25/Documentation/KeyboardEventModifier.html)
- [Community: Switching shift/control+mouse camera behavior](https://community.cesium.com/t/switching-shift-control-mouse-camera-behavior/4056)

### CameraEventType Enum Values
| Value | Description |
|---|---|
| `LEFT_DRAG` | Left mouse button drag |
| `MIDDLE_DRAG` | Middle mouse button drag |
| `RIGHT_DRAG` | Right mouse button drag |
| `WHEEL` | Mouse wheel scroll |
| `PINCH` | Two-finger touch pinch |

### KeyboardEventModifier Enum Values
| Value | Numeric | Description |
|---|---|---|
| `SHIFT` | 0 | Shift key held |
| `CTRL` | 1 | Control key held |
| `ALT` | 2 | Alt key held |

### Event Type Properties and Defaults
Each property accepts: a `CameraEventType`, `undefined`, an object `{ eventType, modifier }`, or an **array** of any of the preceding.

| Property | Default Value |
|---|---|
| `rotateEventTypes` | `CameraEventType.LEFT_DRAG` |
| `translateEventTypes` | `CameraEventType.LEFT_DRAG` |
| `zoomEventTypes` | `[RIGHT_DRAG, WHEEL, PINCH]` |
| `tiltEventTypes` | `[MIDDLE_DRAG, PINCH, { eventType: LEFT_DRAG, modifier: CTRL }, { eventType: RIGHT_DRAG, modifier: CTRL }]` |
| `lookEventTypes` | `{ eventType: LEFT_DRAG, modifier: SHIFT }` |

### Remapping Examples

**Swap shift/ctrl for tilt and look:**
```javascript
const controller = viewer.scene.screenSpaceCameraController;

// Change look from Shift+LeftDrag to Ctrl+LeftDrag
controller.lookEventTypes = {
  eventType: Cesium.CameraEventType.LEFT_DRAG,
  modifier: Cesium.KeyboardEventModifier.CTRL
};

// Change tilt modifier from Ctrl to Shift
controller.tiltEventTypes[2].modifier = Cesium.KeyboardEventModifier.SHIFT;
controller.tiltEventTypes[3].modifier = Cesium.KeyboardEventModifier.SHIFT;
```

**Disable all zoom except mouse wheel:**
```javascript
controller.zoomEventTypes = Cesium.CameraEventType.WHEEL;
```

**Assign multiple events to an action:**
```javascript
controller.zoomEventTypes = [
  Cesium.CameraEventType.WHEEL,
  Cesium.CameraEventType.PINCH,
  { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT }
];
```

### Gotchas

1. **`rotateEventTypes` and `translateEventTypes` both default to `LEFT_DRAG`:** The controller disambiguates based on scene mode (rotate in 3D, translate in 2D/Columbus).

2. **Modifying array elements in-place works:** You can directly modify `tiltEventTypes[2].modifier` without reassigning the whole array.

3. **Setting to `undefined` disables that action:** `controller.tiltEventTypes = undefined` disables all tilt input.

### Skill Improvement Opportunities
- **Should teach:** The full set of event type properties, their defaults, and the three formats they accept (single, object, array).
- **Should provide:** Example remapping patterns for common needs.
- **Should note:** The rotate/translate disambiguation based on scene mode.

---

## 5. Ground-Level Views and 3D Tiles

### Authoritative Sources
- [Photorealistic 3D Tiles Tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/)
- [Cesium3DTileset API Reference](https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html)
- [Community: Cesium3DTileset and Camera collision](https://community.cesium.com/t/cesium3dtileset-and-camera-collision/24007)
- [Community: Camera position below ground level](https://community.cesium.com/t/camera-position-below-the-ground-level/8213)
- [GitHub Issue: Camera underground when 3D tiles load](https://github.com/CesiumGS/cesium/issues/11824)
- [Visualize a Proposed Building Tutorial](https://cesium.com/learn/cesiumjs-learn/cesiumjs-interactive-building/)

### Key Findings

**Without 3D Tiles, ground-level views are limited:**
- CesiumJS terrain (even Cesium World Terrain) only provides elevation data and draped imagery
- At street level, you see a flat textured surface with no buildings, trees, or structures
- There is no official guidance saying "you need 3D Tiles for street-level views," but the tutorials implicitly demonstrate this by always using 3D Tiles for close-up city views

**With Photorealistic 3D Tiles (Google Maps Platform):**
```javascript
const viewer = new Cesium.Viewer("cesiumContainer", {
  globe: false,  // Critical: turn off globe when using photorealistic tiles
  geocoder: Cesium.IonGeocodeProviderType.GOOGLE,
});
const tileset = await Cesium.createGooglePhotorealistic3DTileset();
viewer.scene.primitives.add(tileset);
```

**Camera collision with 3D Tiles:**
```javascript
// Prevent camera from going through/under tileset surface
const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
  enableCollision: true  // Enables camera collision with tileset
});
// Also requires:
viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
```

**`Cesium3DTileset.enableCollision`:**
- When `true`, enables collision detection for camera and picking
- Works in conjunction with `ScreenSpaceCameraController.enableCollisionDetection`
- **Performance warning:** Can impact performance with tiles containing large vertex counts
- `disableCollision` was deprecated; use `enableCollision` instead (since ~v1.116)

### Gotchas

1. **`globe: false` is essential with Google Photorealistic 3D Tiles:** The tiles cover the full globe, so the default globe/terrain creates z-fighting and visual artifacts.

2. **Camera can get stuck underground during initial tile loading:** If you set a low-altitude view immediately, the camera may be positioned underground before higher-resolution tiles load in. The camera should recover once it moves, but the initial view can be wrong.

3. **No official "street view" mode:** CesiumJS provides the building blocks (low camera, 3D tiles, collision detection) but there is no dedicated street-view API. You assemble it yourself.

4. **Collision detection + 3D Tiles = performance cost:** Enabling collision on 3D tilesets adds overhead, especially with complex geometry.

### Skill Improvement Opportunities
- **Should teach:** That meaningful ground-level views require 3D Tiles (photorealistic or otherwise); terrain alone is not enough.
- **Must explain:** The `globe: false` requirement when using Google Photorealistic 3D Tiles.
- **Should teach:** `enableCollision` on Cesium3DTileset to prevent camera from going through buildings.
- **Should warn:** About the camera-underground-during-loading edge case.

---

## 6. camera.flyHome and DEFAULT_VIEW_RECTANGLE

### Authoritative Sources
- [Camera API Reference](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html)
- [GitHub Issue: Make home position more powerful (#6134)](https://github.com/CesiumGS/cesium/issues/6134)
- [GitHub Issue: Control camera home angles (#7450)](https://github.com/CesiumGS/cesium/issues/7450)
- [Community: Default Home Location vs flyHome](https://community.cesium.com/t/default-home-location-different-to-flyhome-location/18083)
- [Community: Add Pitch to DEFAULT_VIEW_RECTANGLE](https://community.cesium.com/t/add-pitch-to-default-view-rectangle/7846)

### Key Findings

**Setting the home view:**
```javascript
// Set the default rectangle (west, south, east, north in degrees)
Cesium.Camera.DEFAULT_VIEW_RECTANGLE = Cesium.Rectangle.fromDegrees(
  -122.5, 37.5, -122.0, 37.9  // San Francisco area
);
Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;  // 0 = fit rectangle exactly
```

**`DEFAULT_VIEW_FACTOR` behavior:**
- `0` = camera views the entire rectangle exactly
- `> 0` = camera moves **further away** from the extent
- `< 0` = camera moves **closer** to the extent

**`flyHome(duration)` behavior:**
- Flies to `DEFAULT_VIEW_RECTANGLE` with the specified `DEFAULT_VIEW_FACTOR`
- Optional `duration` parameter in seconds
- Results in a top-down (orthographic) view with north up

### Gotchas

1. **No heading/pitch/roll control on flyHome:** `flyHome()` always results in a north-up, top-down view. There is no way to specify a tilted or rotated home view through the built-in API. This is a long-standing limitation (issue #6134, still open).

2. **Workaround for custom home orientation:**
   ```javascript
   // Override the HomeButton behavior
   viewer.homeButton.viewModel.command.beforeExecute.addEventListener(function(e) {
     e.cancel = true;  // Cancel default flyHome
     viewer.camera.flyTo({
       destination: Cesium.Cartesian3.fromDegrees(-122.4, 37.8, 15000),
       orientation: {
         heading: Cesium.Math.toRadians(0),
         pitch: Cesium.Math.toRadians(-45),
         roll: 0
       }
     });
   });
   ```

3. **`DEFAULT_VIEW_RECTANGLE` must be set before creating the Viewer** for it to affect the initial view. Setting it after construction only affects subsequent `flyHome()` calls.

4. **StoredView pattern for save/restore:**
   ```javascript
   // Save current view
   const savedView = {
     position: viewer.camera.position.clone(),
     heading: viewer.camera.heading,
     pitch: viewer.camera.pitch,
     roll: viewer.camera.roll
   };
   // Restore later
   viewer.camera.setView({
     destination: savedView.position,
     orientation: {
       heading: savedView.heading,
       pitch: savedView.pitch,
       roll: savedView.roll
     }
   });
   ```

### Skill Improvement Opportunities
- **Must teach:** How to set `DEFAULT_VIEW_RECTANGLE` and `DEFAULT_VIEW_FACTOR`.
- **Must warn:** That `flyHome()` always produces a top-down north-up view -- no orientation control.
- **Should teach:** The HomeButton override pattern for custom orientations.
- **Should note:** `DEFAULT_VIEW_RECTANGLE` should be set before Viewer construction for initial view effect.

---

## Cross-Cutting Findings

### Major Gotchas the Skill Should Address

1. **`lookAt` locks the camera into orbit mode.** After calling `camera.lookAt()`, the user can only orbit the target -- no free panning. To restore free camera, call `camera.lookAtTransform(Cesium.Matrix4.IDENTITY)`. This is one of the most common CesiumJS camera complaints.

2. **Heading convention confusion is real.** Three different phrasings exist in official docs. The skill must be authoritative: heading=0 means facing north, positive heading rotates clockwise (toward east).

3. **`enableCollisionDetection: false` breaks `maximumZoomDistance`.** These should be independent but are not. If you disable collision detection, zoom limits are also disabled.

4. **`enableRotate` vs `enableTilt` naming is misleading.** `enableTilt` controls rotation+tilt, `enableRotate` controls translation in some contexts.

5. **Pitch = -90 degrees (exact) causes gimbal lock.** Always use `-Math.PI/2 + epsilon` for straight-down views.

6. **`globe: false` is required for Google Photorealistic 3D Tiles** to avoid z-fighting with the default globe.

### API Method Selection Guide

| Goal | Method | Notes |
|---|---|---|
| Animate to position | `camera.flyTo()` | Smooth transition; supports orientation |
| Instant position change | `camera.setView()` | No animation; same orientation options as flyTo |
| Orbit a target | `camera.lookAt()` | **Locks camera** -- must call `lookAtTransform(IDENTITY)` to unlock |
| Orbit with animation | `camera.flyToBoundingSphere()` | Like flyTo but takes a BoundingSphere + offset |
| Return to home | `camera.flyHome()` | Uses DEFAULT_VIEW_RECTANGLE; no orientation control |
| Track an entity | `viewer.trackedEntity` | Auto-follows; sets orbit mode on entity |

### HeadingPitchRange vs Orientation Cheat Sheet

| Parameter | HeadingPitchRange (lookAt) | Orientation (flyTo/setView) |
|---|---|---|
| heading=0 | Camera faces north (positioned south of target) | Camera faces north |
| pitch=-45deg | Camera looks 45 degrees down toward target | Camera looks 45 degrees down |
| pitch=0 | Camera looks horizontally at target | Camera looks horizontally |
| range/height | Distance from target in meters | Height above ellipsoid (in destination) |
