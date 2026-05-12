# `demo/viewer/` — Local CesiumJS viewer for browser-driven iteration

A minimal, single-page CesiumJS viewer designed to be driven by browser automation (Chrome DevTools MCP, already wired into this plugin's `.mcp.json`, or Playwright MCP) from a Claude Code session.

The page loads once. After that, drivers inject code, take screenshots, and read state without reloading. This is intentionally separate from `demo/index.html`, which is the interactive showcase: the showcase is meant for humans to click around in, this page is meant for agents to drive.

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
mcp__chrome-devtools__navigate url="http://localhost:3000/demo/viewer/?ionToken=YOUR_TOKEN"
```

Substitute your own [Ion token](https://ion.cesium.com/tokens). Without a token, base imagery and terrain providers will not load, but other CesiumJS APIs still work.

### 3. Confirm it loaded

```
mcp__chrome-devtools__evaluate script="window.__viewerReady === true && window.__viewerState()"
```

You should get back something like:

```json
{
  "errors": [],
  "warnings": [],
  "hasViewer": false,
  "cesiumLoaded": true,
  "cesiumVersion": "1.139.0",
  "ionTokenSet": true
}
```

### 4. Inject CesiumJS code

```
mcp__chrome-devtools__evaluate script="(() => {
  const viewer = new Cesium.Viewer('cesiumContainer');
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-74.006, 40.7128, 10000),
    duration: 0,
  });
  window.__viewer = viewer;
})()"
```

By convention, store the active `Viewer` instance on `window.__viewer`. The reset helper uses this to clean up between iterations.

### 5. Wait for tiles, then screenshot

```
mcp__chrome-devtools__evaluate script="new Promise(r => setTimeout(r, 2000))"
mcp__chrome-devtools__screenshot
```

### 6. Read errors and warnings

```
mcp__chrome-devtools__evaluate script="window.__viewerState()"
```

### 7. Reset between iterations

```
mcp__chrome-devtools__evaluate script="window.__resetViewer()"
```

This destroys the prior viewer, clears captured errors and warnings, and gets the page ready for the next code injection. The page stays loaded; only the viewer state resets.

## What the page exposes on `window`

| Name | Purpose |
|---|---|
| `Cesium` | Full CesiumJS namespace, loaded from CDN |
| `__viewerReady` | `true` once the page has finished initialising |
| `__viewerState()` | Snapshot of errors, warnings, viewer presence, Ion token status |
| `__resetViewer()` | Destroy the active viewer and clear captured state |
| `__viewer` | Convention slot for the active Viewer instance |
| `__evalErrors` | Array of error objects from `window.error`, `console.error`, and unhandled promise rejections |
| `__evalWarnings` | Array of warning objects from `console.warn` |

## Why a persistent page

Materialising a fresh HTML file per eval scenario (the older pattern still used by the runner under `tuning/tools/`) is slower, leaks run-time artifacts to disk, and is harder to reason about across iterations. A single persistent page driven by `evaluate` keeps the dev loop tight: navigate once, iterate many times.

The two patterns can coexist. `tuning/tools/run_eval_suite.py` keeps working for batch eval runs; this page is for interactive iteration during skill development.

## Token handling

The Cesium Ion token is read from the `?ionToken=` URL parameter at page load time. It is never baked into the page. If you want to change tokens, navigate to the page again with a different `ionToken` value.

## Notes

- The page uses CesiumJS 1.139 from the CDN. Bump the version string in `index.html` when the skills move to a newer Cesium release.
- The status badge in the upper-left shows whether Cesium loaded and whether an Ion token was set. Useful for at-a-glance verification.
- The page has no opinion about what code gets injected. It just provides a clean Cesium environment, error capture, and reset machinery.
