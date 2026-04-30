# `harness/` — In-browser CesiumJS evaluation harness

A persistent, single-page harness for executing CesiumJS code locally and inspecting the result via browser automation. Designed to be driven by Chrome DevTools MCP (already wired into this plugin's `.mcp.json`) or Playwright MCP from a Claude Code session.

The harness loads once. After that, drivers inject code, take screenshots, and read state without reloading the page. This is the persistent counterpart to the per-eval HTML materialization pattern under `tuning/` (which lives on the [`eval-and-optimization`](https://github.com/CesiumGS/cesiumjs-skills/tree/eval-and-optimization) branch).

## Usage

### 1. Serve the page

From the repo root:

```bash
python3 -m http.server 3000
```

Or any other static HTTP server. The page must be served over HTTP, not opened as a `file://` URL, because Cesium tile providers require it.

### 2. Navigate to it (with your Ion token)

In your Claude Code session, with `chrome-devtools` MCP available:

```
mcp__chrome-devtools__navigate_page url="http://localhost:3000/harness/?ionToken=YOUR_TOKEN"
```

Substitute your own [Ion token](https://ion.cesium.com/tokens). Without a token, base imagery and terrain providers will not load, but other CesiumJS APIs still work.

### 3. Confirm it loaded

```
mcp__chrome-devtools__evaluate_script function="() => window.__harnessReady === true && window.__harnessState()"
```

You should get back something like:

```json
{
  "errors": [],
  "warnings": [],
  "hasViewer": false,
  "cesiumLoaded": true,
  "cesiumVersion": "1.139.1",
  "ionTokenSet": true
}
```

### 4. Inject CesiumJS code

```
mcp__chrome-devtools__evaluate_script function="() => {
  const viewer = new Cesium.Viewer('cesiumContainer');
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-74.006, 40.7128, 10000),
    duration: 0,
  });
  window.__viewer = viewer;
}"
```

By convention, store the active `Viewer` instance on `window.__viewer`. The reset helper uses this to clean up between iterations.

### 5. Wait for tiles, then screenshot

```
mcp__chrome-devtools__evaluate_script function="() => new Promise(r => setTimeout(r, 2000))"
mcp__chrome-devtools__take_screenshot
```

### 6. Read errors and warnings

```
mcp__chrome-devtools__evaluate_script function="() => window.__harnessState()"
```

### 7. Reset between iterations

```
mcp__chrome-devtools__evaluate_script function="() => window.__resetHarness()"
```

This destroys the prior viewer, clears captured errors and warnings, and gets the page ready for the next code injection. The page stays loaded; only the viewer state resets.

## What the harness exposes on `window`

| Name | Purpose |
|---|---|
| `Cesium` | Full CesiumJS namespace, loaded from CDN |
| `__harnessReady` | `true` once the harness has finished initialising |
| `__harnessState()` | Snapshot of errors, warnings, viewer presence, Ion token status |
| `__resetHarness()` | Destroy the active viewer and clear captured state |
| `__viewer` | Convention slot for the active Viewer instance |
| `__evalErrors` | Array of error objects from `window.error`, `console.error`, and unhandled promise rejections |
| `__evalWarnings` | Array of warning objects from `console.warn` |

## Why a persistent page

Materialising a fresh HTML file per eval scenario (the older pattern still used by the runner under `tuning/tools/`) is slower, leaks run-time artifacts to disk, and is harder to reason about across iterations. A single persistent page driven by `evaluate_script()` keeps the dev loop tight: navigate once, iterate many times.

The two patterns can coexist. `tuning/tools/run_eval_suite.py` will keep working for batch eval runs; this harness is for interactive iteration during skill development.

## Token handling

The Cesium Ion token is read from the `?ionToken=` URL parameter at page load time. It is never baked into the harness file. If you want to change tokens, navigate to the page again with a different `ionToken` value.

## Notes

- The page uses CesiumJS 1.139 from the CDN. Bump the version string in `index.html` when the skills move to a newer Cesium release.
- The status badge in the upper-left shows whether Cesium loaded and whether an Ion token was set. Useful for at-a-glance verification.
- The harness has no opinion about what code gets injected. It just provides a clean Cesium environment, error capture, and reset machinery.
