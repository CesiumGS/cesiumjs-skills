#!/usr/bin/env python3
"""Capture before/after Cesium scene-state evidence for an evaluation case.

This script belongs to pure evaluation. It accepts a case manifest and a
candidate JavaScript file, materializes a local Cesium harness under
`evaluation/artifacts/`, captures structured scene state before and after the
candidate executes, writes an evidence bundle, and optionally runs the pure
deterministic evaluator against that bundle.

It does not generate candidates, compare against baselines, call judges, update
skills, or write optimization results.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - optional local dependency
    sync_playwright = None


REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_ROOT = REPO_ROOT / "evaluation" / "artifacts"
CESIUM_VERSION = "1.142"

sys.path.insert(0, str(REPO_ROOT))
from evaluation.runner import run_case  # noqa: E402


HARNESS_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CesiumJS Deterministic Evaluation Harness</title>
  <script src="https://cesium.com/downloads/cesiumjs/releases/{cesium_version}/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/{cesium_version}/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
  <style>
    html, body, #cesiumContainer {{
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }}
  </style>
</head>
<body>
  <div id="cesiumContainer"></div>
  <script>
    window.__evalErrors = [];
    window.__evalEvents = {{ click_log: [] }};
    window.__recordEvalClick = function(item) {{
      window.__evalEvents.click_log.push(Object.assign({{ type: "LEFT_CLICK" }}, item || {{}}));
    }};
    window.addEventListener("error", (event) => {{
      window.__evalErrors.push(String(event.error || event.message || "unknown error"));
    }});
    window.addEventListener("unhandledrejection", (event) => {{
      window.__evalErrors.push(String(event.reason || "unhandled rejection"));
    }});

    async function boot() {{
      window.__viewer = new Cesium.Viewer("cesiumContainer", {{
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        terrain: undefined
      }});
      window.__viewerReady = true;
    }}

    window.__applyPreflight = function(preflight) {{
      const entities = (preflight && preflight.entities) || [];
      for (const item of entities) {{
        const carto = item.position_cartographic || {{}};
        const position = Cesium.Cartesian3.fromDegrees(
          Number(carto.longitude_deg),
          Number(carto.latitude_deg),
          Number(carto.altitude_m || 0)
        );
        window.__viewer.entities.add({{
          id: item.id,
          position,
          point: {{ pixelSize: 10, color: Cesium.Color.YELLOW }}
        }});
      }}
    }};

    function captureCamera() {{
      const camera = window.__viewer.camera;
      return {{
        position_ecef: [camera.position.x, camera.position.y, camera.position.z],
        direction_ecef: [camera.direction.x, camera.direction.y, camera.direction.z],
        up_ecef: [camera.up.x, camera.up.y, camera.up.z],
        heading_pitch_roll: {{
          heading: camera.heading,
          pitch: camera.pitch,
          roll: camera.roll
        }}
      }};
    }}

    function captureEntity(id, now) {{
      const entity = window.__viewer.entities.getById(id);
      if (!entity) {{
        return null;
      }}
      const out = {{}};
      const value = entity.position && entity.position.getValue(now);
      if (value) {{
        const carto = Cesium.Cartographic.fromCartesian(value);
        out.position_ecef = [value.x, value.y, value.z];
        out.position_cartographic = {{
          longitude_deg: Cesium.Math.toDegrees(carto.longitude),
          latitude_deg: Cesium.Math.toDegrees(carto.latitude),
          altitude_m: carto.height
        }};
      }}
      if (entity.properties) {{
        out.properties = {{}};
        const names = entity.properties.propertyNames || [];
        for (const name of names) {{
          const property = entity.properties[name];
          out.properties[name] = property && property.getValue ? property.getValue(now) : property;
        }}
      }}
      return out;
    }}

    function captureImageryLayers() {{
      const layers = window.__viewer.imageryLayers;
      const out = [];
      for (let i = 0; i < layers.length; i += 1) {{
        const layer = layers.get(i);
        const provider = layer.imageryProvider;
        out.push({{
          provider: provider && provider.constructor ? provider.constructor.name : String(provider),
          alpha: layer.alpha,
          brightness: layer.brightness,
          contrast: layer.contrast,
          hue: layer.hue,
          saturation: layer.saturation,
          gamma: layer.gamma,
          show: layer.show,
          splitDirection: layer.splitDirection
        }});
      }}
      return out;
    }}

    function primitiveType(primitive) {{
      return primitive && primitive.constructor ? primitive.constructor.name : String(primitive);
    }}

    function primitiveRequiresIon(primitive) {{
      const candidates = [
        primitive && primitive._url,
        primitive && primitive.url,
        primitive && primitive.resource && primitive.resource.url,
        primitive && primitive._resource && primitive._resource.url
      ].filter(Boolean).map(String);
      return candidates.some((value) => value.includes("api.cesium.com") || value.includes("ion.cesium.com"));
    }}

    function capturePrimitives() {{
      const out = [];
      for (let i = 0; i < window.__viewer.scene.primitives.length; i += 1) {{
        const primitive = window.__viewer.scene.primitives.get(i);
        out.push({{
          type: primitiveType(primitive),
          show: primitive && primitive.show,
          ready: primitive && typeof primitive.ready !== "undefined" ? Boolean(primitive.ready) : undefined,
          requiresIonToken: primitiveRequiresIon(primitive)
        }});
      }}
      return out;
    }}

    function captureTilesets() {{
      const out = [];
      for (let i = 0; i < window.__viewer.scene.primitives.length; i += 1) {{
        const primitive = window.__viewer.scene.primitives.get(i);
        if (!primitive || primitiveType(primitive) !== "Cesium3DTileset") {{
          continue;
        }}
        const requiresIon = primitiveRequiresIon(primitive);
        const source = primitive.__evalSource || (requiresIon ? "ion-asset" : "public-url");
        const boundingSphere = primitive.boundingSphere;
        const distance = boundingSphere && window.__viewer.camera
          ? Cesium.Cartesian3.distance(window.__viewer.camera.position, boundingSphere.center)
          : undefined;
        out.push({{
          type: "Cesium3DTileset",
          source,
          ready: typeof primitive.ready !== "undefined" ? Boolean(primitive.ready) : true,
          requiresIonToken: requiresIon,
          distanceToCameraMeters: distance
        }});
      }}
      return out;
    }}

    function captureTerrain() {{
      const provider = window.__viewer.terrainProvider || (window.__viewer.scene && window.__viewer.scene.terrainProvider);
      const name = provider && provider.constructor ? provider.constructor.name : String(provider);
      return {{
        provider: name,
        requiresIonToken: /CesiumTerrainProvider|GoogleEarthEnterpriseTerrainProvider/.test(name)
      }};
    }}

    window.__captureSceneState = function(capturePaths) {{
      const now = Cesium.JulianDate.now();
      const paths = capturePaths || [];
      const out = {{ entities: {{}} }};
      for (const path of paths) {{
        if (path.startsWith("camera.")) {{
          out.camera = captureCamera();
        }}
        const entityMatch = path.match(/^entities\\[([^\\]]+)\\]\\./);
        if (entityMatch) {{
          const id = entityMatch[1];
          const entity = captureEntity(id, now);
          if (entity !== null) {{
            out.entities[id] = Object.assign(out.entities[id] || {{}}, entity);
          }}
        }}
        if (path.startsWith("imagery_layers[*].")) {{
          out.imagery_layers = captureImageryLayers();
        }}
        if (path.startsWith("clock.")) {{
          out.clock = {{
            startTime: window.__viewer.clock.startTime && window.__viewer.clock.startTime.toString(),
            stopTime: window.__viewer.clock.stopTime && window.__viewer.clock.stopTime.toString(),
            currentTime: window.__viewer.clock.currentTime && window.__viewer.clock.currentTime.toString(),
            multiplier: window.__viewer.clock.multiplier,
            shouldAnimate: window.__viewer.clock.shouldAnimate
          }};
        }}
        if (path.startsWith("scene.")) {{
          out.scene = {{
            mode: window.__viewer.scene.mode,
            requestRenderMode: window.__viewer.scene.requestRenderMode,
            maximumRenderTimeChange: window.__viewer.scene.maximumRenderTimeChange,
            primitives_length: window.__viewer.scene.primitives.length
          }};
        }}
        if (path.startsWith("globe.") && window.__viewer.scene.globe) {{
          out.globe = {{
            show: window.__viewer.scene.globe.show,
            enableLighting: window.__viewer.scene.globe.enableLighting,
            depthTestAgainstTerrain: window.__viewer.scene.globe.depthTestAgainstTerrain,
            translucency_enabled: window.__viewer.scene.globe.translucency && window.__viewer.scene.globe.translucency.enabled
          }};
        }}
        if (path.startsWith("terrain.")) {{
          out.terrain = captureTerrain();
        }}
        if (path.startsWith("primitives[*].")) {{
          out.primitives = capturePrimitives();
        }}
        if (path.startsWith("tilesets[*].")) {{
          out.tilesets = captureTilesets();
        }}
        if (path.startsWith("data_sources[*].")) {{
          out.data_sources = [];
          const sources = window.__viewer.dataSources;
          for (let i = 0; i < sources.length; i += 1) {{
            const source = sources.get(i);
            out.data_sources.push({{
              name: source.name,
              type: source && source.constructor ? source.constructor.name : String(source),
              entity_count: source.entities ? source.entities.values.length : 0
            }});
          }}
        }}
        if (path.startsWith("events.")) {{
          out.events = JSON.parse(JSON.stringify(window.__evalEvents || {{}}));
        }}
      }}
      return out;
    }};

    window.__runCandidateSource = async function(source) {{
      const fn = new Function("viewer", "Cesium", source);
      return await fn(window.__viewer, Cesium);
    }};

    boot();
  </script>
</body>
</html>
"""


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def case_slug(case: dict[str, Any]) -> str:
    return f"{case.get('id', 'case')}-{case.get('name', 'unnamed')}"


def entity_ids_from_case(case: dict[str, Any]) -> list[str]:
    ids: set[str] = set()
    for item in (case.get("preflight") or {}).get("entities", []):
        entity_id = item.get("id")
        if isinstance(entity_id, str) and entity_id:
            ids.add(entity_id)
    for check in case.get("checks", []):
        entity_id = check.get("entity_id")
        if isinstance(entity_id, str) and entity_id:
            ids.add(entity_id)
    for capture in (case.get("probe") or {}).get("capture", []):
        match = re.match(r"entities\[([^\]]+)\]", str(capture))
        if match:
            ids.add(match.group(1))
    return sorted(ids)


def capture_paths_from_case(case: dict[str, Any]) -> list[str]:
    paths = set(str(item) for item in (case.get("probe") or {}).get("capture", []))
    for entity_id in entity_ids_from_case(case):
        paths.add(f"entities[{entity_id}].position_ecef")
        paths.add(f"entities[{entity_id}].position_cartographic")
    return sorted(paths)


def write_harness(run_dir: Path) -> Path:
    run_dir.mkdir(parents=True, exist_ok=True)
    html_path = run_dir / "harness.html"
    html_path.write_text(HARNESS_HTML.format(cesium_version=CESIUM_VERSION))
    return html_path


def default_output_path(case: dict[str, Any]) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    return ARTIFACTS_ROOT / case.get("skill", "unknown-skill") / f"{case_slug(case)}-{stamp}.evidence.json"


def capture_evidence(case: dict[str, Any], candidate_source: str, html_path: Path, headless: bool) -> dict[str, Any]:
    if sync_playwright is None:
        raise RuntimeError("playwright is not installed; install requirements.txt first")

    capture_paths = capture_paths_from_case(case)
    if not capture_paths:
        raise ValueError("case does not declare any probe.capture paths")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=headless)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        token = os.environ.get("CESIUM_ION_TOKEN")
        if token:
            page.add_init_script(
                "Object.defineProperty(window, '__CESIUM_ION_TOKEN', { value: %s });" % json.dumps(token)
            )
        # "load" not "networkidle": streaming scenes (terrain/imagery/tiles) keep
        # the network busy and never idle. Readiness is gated on __viewerReady and
        # the settle delay below instead.
        page.goto(html_path.as_uri(), wait_until="load")
        page.wait_for_function("window.__viewerReady === true")
        if token:
            page.evaluate("Cesium.Ion.defaultAccessToken = window.__CESIUM_ION_TOKEN")
        page.evaluate("(preflight) => window.__applyPreflight(preflight)", case.get("preflight") or {})
        settle_ms = int((case.get("preflight") or {}).get("settle_ms", 0))
        if settle_ms > 0:
            page.wait_for_timeout(settle_ms)
        before = page.evaluate("(paths) => window.__captureSceneState(paths)", capture_paths)
        page.evaluate("(source) => window.__runCandidateSource(source)", candidate_source)
        page.wait_for_timeout(int(case.get("timeout_ms", 1000)))
        after = page.evaluate("(paths) => window.__captureSceneState(paths)", capture_paths)
        errors = page.evaluate("window.__evalErrors")
        browser.close()

    evidence: dict[str, Any] = {
        "schema_version": 1,
        "case_id": case["id"],
        "case_name": case["name"],
        "skill": case["skill"],
        "source": "browser-capture",
        "generated_code": candidate_source,
        "execution": {"success": not bool(errors)},
        "before": before,
        "after": after,
    }
    if errors:
        evidence["errors"] = errors
    return evidence


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", help="Path to evaluation case JSON")
    parser.add_argument("--candidate-js", required=True, help="Path to candidate JavaScript")
    parser.add_argument("--output", help="Path to write evidence JSON")
    parser.add_argument("--run-checks", action="store_true", help="Run deterministic checks after capture")
    parser.add_argument("--no-headless", action="store_true", help="Show the browser window")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    case_path = Path(args.case)
    candidate_path = Path(args.candidate_js)
    case = load_json(case_path)
    candidate_source = candidate_path.read_text()

    output_path = Path(args.output) if args.output else default_output_path(case)
    if not output_path.is_absolute():
        output_path = REPO_ROOT / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)

    run_dir = output_path.parent / f"{output_path.stem}-harness"
    html_path = write_harness(run_dir)
    evidence = capture_evidence(case, candidate_source, html_path, headless=not args.no_headless)
    output_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    print(f"[capture-scene-state] wrote {output_path.relative_to(REPO_ROOT)}")

    if args.run_checks:
        result = run_case(case, evidence)
        print(json.dumps(result.to_dict(), indent=2, sort_keys=True))
        return 0 if result.passed else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
