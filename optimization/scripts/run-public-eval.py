#!/usr/bin/env python3
"""Run public CesiumJS skill scenarios against generated JavaScript snippets.

This is the public v1 local runner. It intentionally writes raw generated HTML,
console logs, and screenshots under gitignored output directories.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - optional local dependency
    sync_playwright = None


REPO_ROOT = Path(__file__).resolve().parents[2]
CESIUM_VERSION = "1.143"

# Make sibling modules importable when run as a script.
sys.path.insert(0, str(REPO_ROOT))
from optimization.framework.checks.engine import run_checks as _run_checks_canonical  # noqa: E402


@dataclass
class ScenarioRun:
    scenario: dict[str, Any]
    code_path: Path
    run_dir: Path


class LocalHTTPServer:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.httpd: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.port: int | None = None

    def __enter__(self) -> "LocalHTTPServer":
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()

        handler = partial(SimpleHTTPRequestHandler, directory=str(self.root))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.httpd is not None:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self.thread is not None:
            self.thread.join(timeout=2)

    @property
    def base_url(self) -> str:
        if self.port is None:
            raise RuntimeError("server was not started")
        return f"http://127.0.0.1:{self.port}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill", help="Skill id, for example cesiumjs-camera")
    parser.add_argument(
        "--generated-root",
        default="optimization/generated",
        help="Directory containing generated JS snippets grouped by skill/iteration",
    )
    parser.add_argument(
        "--iteration",
        default="candidate",
        help="Generated-code iteration under generated-root/<skill>/",
    )
    parser.add_argument(
        "--output-root",
        default="optimization/runs",
        help="Gitignored directory for raw run outputs",
    )
    parser.add_argument(
        "--generated-dir",
        default=None,
        help="Full path to the directory containing generated JS files (overrides --generated-root/<skill>/<iteration>)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Full path to write run outputs (overrides --output-root/<skill>/<iteration>)",
    )
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated scenario ids to run, for example eval-001,eval-002",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=60000,
        help="Page navigation timeout in milliseconds",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def compute_file_hash(path: Path) -> str:
    """Compute SHA-256 hash of a file."""
    sha256 = hashlib.sha256()
    sha256.update(path.read_bytes())
    return sha256.hexdigest()


def compute_content_hash(content: str | bytes) -> str:
    """Compute SHA-256 hash of content."""
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()


def sanitize_url(value: str) -> str:
    """Redact sensitive query parameters before writing network diagnostics."""
    return re.sub(
        r"([?&](?:access_token|token|key|api_key|apiKey)=)[^&#]+",
        r"\1[REDACTED]",
        value,
        flags=re.IGNORECASE,
    )


def _paeth_predictor(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    chunks: list[tuple[bytes, bytes]] = []
    offset = 8
    while offset + 8 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], "big")
        chunk_type = data[offset + 4:offset + 8]
        chunk_data = data[offset + 8:offset + 8 + length]
        chunks.append((chunk_type, chunk_data))
        offset += 12 + length
        if chunk_type == b"IEND":
            break
    return chunks


def analyze_screenshot(path: Path, expected_width: int, expected_height: int) -> dict[str, Any]:
    """Return lightweight quality signals for a captured PNG screenshot."""
    data = path.read_bytes()
    report: dict[str, Any] = {
        "filename": path.name,
        "file_size_bytes": len(data),
        "expected_width": expected_width,
        "expected_height": expected_height,
        "warnings": [],
    }

    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        report.update({"passed": False, "detail": "not a PNG file"})
        return report

    chunks = _png_chunks(data)
    ihdr = next((chunk_data for chunk_type, chunk_data in chunks if chunk_type == b"IHDR"), None)
    if ihdr is None or len(ihdr) < 13:
        report.update({"passed": False, "detail": "missing PNG IHDR chunk"})
        return report

    width = int.from_bytes(ihdr[0:4], "big")
    height = int.from_bytes(ihdr[4:8], "big")
    bit_depth = ihdr[8]
    color_type = ihdr[9]
    interlace = ihdr[12]
    report.update({
        "width": width,
        "height": height,
        "bit_depth": bit_depth,
        "color_type": color_type,
        "interlace": interlace,
    })

    if width != expected_width or height != expected_height:
        report["warnings"].append(
            f"unexpected dimensions {width}x{height}; expected {expected_width}x{expected_height}"
        )
    if expected_width * expected_height >= 10_000 and len(data) < 1024:
        report["warnings"].append("screenshot file is suspiciously small")

    bytes_per_pixel_by_color_type = {
        0: 1,  # grayscale
        2: 3,  # RGB
        3: 1,  # indexed
        4: 2,  # grayscale + alpha
        6: 4,  # RGBA
    }
    bytes_per_pixel = bytes_per_pixel_by_color_type.get(color_type)
    if bit_depth == 8 and interlace == 0 and bytes_per_pixel is not None:
        idat = b"".join(chunk_data for chunk_type, chunk_data in chunks if chunk_type == b"IDAT")
        try:
            raw = zlib.decompress(idat)
            stride = width * bytes_per_pixel
            previous = bytearray(stride)
            pixels = bytearray()
            offset = 0
            for _row in range(height):
                filter_type = raw[offset]
                offset += 1
                row = bytearray(raw[offset:offset + stride])
                offset += stride
                for i in range(stride):
                    left = row[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
                    up = previous[i]
                    up_left = previous[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
                    if filter_type == 1:
                        row[i] = (row[i] + left) & 0xFF
                    elif filter_type == 2:
                        row[i] = (row[i] + up) & 0xFF
                    elif filter_type == 3:
                        row[i] = (row[i] + ((left + up) // 2)) & 0xFF
                    elif filter_type == 4:
                        row[i] = (row[i] + _paeth_predictor(left, up, up_left)) & 0xFF
                    elif filter_type != 0:
                        raise ValueError(f"unsupported PNG filter type {filter_type}")
                pixels.extend(row)
                previous = row

            sample_stride = max(bytes_per_pixel, (len(pixels) // 10000) // bytes_per_pixel * bytes_per_pixel)
            sampled_colors = set()
            luminance_values = []
            for i in range(0, len(pixels), sample_stride):
                sample = tuple(pixels[i:i + bytes_per_pixel])
                if len(sample) < bytes_per_pixel:
                    continue
                sampled_colors.add(sample)
                if color_type in {2, 6}:
                    r, g, b = sample[:3]
                    luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
                else:
                    luminance = sample[0]
                luminance_values.append(luminance)

            if luminance_values:
                luminance_span = max(luminance_values) - min(luminance_values)
                report.update({
                    "distinct_sampled_colors": len(sampled_colors),
                    "luminance_span": round(luminance_span, 2),
                })
                if len(sampled_colors) < 8:
                    report["warnings"].append("screenshot has too few distinct sampled colors")
                if luminance_span < 10:
                    report["warnings"].append("screenshot has very low luminance variation")
        except Exception as exc:
            report["warnings"].append(f"could not compute pixel variation: {exc}")
    else:
        report["warnings"].append("pixel variation check skipped for this PNG encoding")

    report["passed"] = not report["warnings"]
    report["detail"] = "ok" if report["passed"] else "; ".join(report["warnings"])
    return report


def add_screenshot_quality_checks(checks_result: dict[str, Any], quality_report: dict[str, Any]) -> dict[str, Any]:
    """Add screenshot quality results to the canonical checks output."""
    checks = checks_result.setdefault("checks", [])
    for screenshot in quality_report.get("screenshots", []):
        checks.append({
            "check_id": f"screenshot_quality:{screenshot['filename']}",
            "type": "screenshot_quality",
            "description": "Captured screenshot is nonblank and has the expected viewport dimensions",
            "result": "pass" if screenshot.get("passed") else "fail",
            "detail": screenshot.get("detail", ""),
        })
    passed = sum(1 for c in checks if c.get("result") == "pass")
    total = len(checks)
    checks_result["summary"] = {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": (passed / total) if total else 1.0,
    }
    return checks_result


def get_git_commit() -> str:
    """Get current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def get_playwright_version() -> str:
    """Get Playwright version from installed package."""
    try:
        import playwright
        return getattr(playwright, "__version__", "unknown")
    except (ImportError, AttributeError):
        return "unknown"


def scenario_slug(scenario: dict[str, Any]) -> str:
    return f"{scenario['id']}-{scenario['name']}"


def find_code_path(generated_dir: Path, scenario: dict[str, Any]) -> Path:
    exact = generated_dir / f"{scenario['id']}.js"
    if exact.exists():
        return exact
    slug = generated_dir / f"{scenario_slug(scenario)}.js"
    if slug.exists():
        return slug
    exact_display = exact.relative_to(REPO_ROOT)
    slug_display = slug.relative_to(REPO_ROOT)
    raise FileNotFoundError(
        f"Missing generated code for {scenario['id']}. Expected {exact_display} or {slug_display}"
    )


PLACEHOLDER_TOKEN_MARKERS = ("placeholder", "your-token", "TODO", "example", "xxx")
ION_PREFLIGHT_ASSET = 1  # Cesium World Terrain — public Ion asset every account can read


def resolve_ion_token() -> str:
    """Return the Ion token to use, accepting either CESIUM_ION_TOKEN or
    CESIUM_ACCESS_TOKEN (the framework's historical name vs. the user's
    long-standing .env naming). Refuse obvious placeholders so the runner
    never silently produces 401-poisoned baselines like iteration 001 did."""
    candidates = [
        ("CESIUM_ION_TOKEN", os.environ.get("CESIUM_ION_TOKEN")),
        ("CESIUM_ACCESS_TOKEN", os.environ.get("CESIUM_ACCESS_TOKEN")),
    ]
    for name, value in candidates:
        if not value:
            continue
        if any(m in value.lower() for m in PLACEHOLDER_TOKEN_MARKERS):
            print(
                f"[run-public-eval] {name} looks like a placeholder "
                f"(contains a placeholder marker). Refusing to run.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        if not re.match(r"^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$", value):
            print(
                f"[run-public-eval] {name} is not in JWT format "
                "(expected three base64url segments separated by '.'). Refusing to run.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        return value
    raise SystemExit(
        "Set CESIUM_ION_TOKEN (or CESIUM_ACCESS_TOKEN) before running browser evals. "
        "Get one at https://ion.cesium.com/tokens"
    )


def preflight_ion(ion_token: str, *, allow_skip: bool = False) -> None:
    """Sanity-check the Ion token against the live API before launching any
    scenarios. Without this, a stale/invalid/wrong-scope token silently turns
    every Ion-backed scenario into a 401-loaded starfield, which iteration 001
    discovered the hard way.

    Set EVAL_SKIP_ION_PREFLIGHT=1 only when intentionally evaluating
    Ion-independent scenarios (e.g., scoping CI to OSM-only fixtures)."""
    import urllib.error
    import urllib.request

    if allow_skip:
        print("[run-public-eval] Ion preflight skipped (EVAL_SKIP_ION_PREFLIGHT=1).")
        return

    url = f"https://api.cesium.com/v1/assets/{ION_PREFLIGHT_ASSET}/endpoint"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {ion_token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                print(f"[run-public-eval] Ion preflight OK (asset {ION_PREFLIGHT_ASSET} reachable).")
                return
            raise SystemExit(
                f"[run-public-eval] Ion preflight got HTTP {resp.status}; refusing to run."
            )
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        raise SystemExit(
            f"[run-public-eval] Ion preflight failed: HTTP {e.code}. "
            f"Your token is missing or invalid. Body: {body}. "
            "Get a fresh token at https://ion.cesium.com/tokens, or set "
            "EVAL_SKIP_ION_PREFLIGHT=1 if you know your scenarios don't need Ion."
        )
    except urllib.error.URLError as e:
        raise SystemExit(
            f"[run-public-eval] Ion preflight network error: {e}. "
            "Check internet access, or set EVAL_SKIP_ION_PREFLIGHT=1."
        )


def render_html(ion_token: str, generated_code: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CesiumJS public eval</title>
  <script src="https://cesium.com/downloads/cesiumjs/releases/{CESIUM_VERSION}/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/{CESIUM_VERSION}/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
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
    window.__CESIUM_EVAL_ERRORS__ = [];
    window.addEventListener("error", event => {{
      window.__CESIUM_EVAL_ERRORS__.push({{ message: event.message, source: event.filename, line: event.lineno }});
    }});
    window.addEventListener("unhandledrejection", event => {{
      window.__CESIUM_EVAL_ERRORS__.push({{ message: String(event.reason) }});
    }});
    Cesium.Ion.defaultAccessToken = {json.dumps(ion_token)};
    (async () => {{
      try {{
{generated_code}
      }} catch (error) {{
        window.__CESIUM_EVAL_ERRORS__.push({{ message: error && error.message ? error.message : String(error) }});
        throw error;
      }}
    }})();
  </script>
</body>
</html>
"""


_ION_401_PATTERN = re.compile(r"401|cesium\.com.*?(?:Unauthor|forbidden)", re.IGNORECASE)


def detect_ion_auth_failure(
    console_messages: list[dict[str, Any]],
    network_failures: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Synthesize an ion_auth_failure check when the trial's console/network
    record shows Ion 401s. This complements the up-front preflight: if the
    token rotates mid-run, or a scenario hits an Ion endpoint the token
    doesn't have scope for, we want the bundle clearly marked as
    environment-invalid rather than silently failing no_console_errors and
    triggering a critical-failure REJECT.

    Returns a check dict suitable to append, or None when no Ion 401s seen.
    """
    ion_401s = [
        m for m in (console_messages or [])
        if m.get("type") == "error" and _ION_401_PATTERN.search(m.get("text", ""))
    ]
    for nf in network_failures or []:
        if "401" in str(nf.get("status", "")) and "cesium" in str(nf.get("url", "")).lower():
            ion_401s.append(nf)
    if not ion_401s:
        return None
    return {
        "check_id": "ion_auth_failure",
        "type": "ion_auth_failure",
        "description": "Trial is environment-invalid: Ion auth failed during run.",
        "result": "fail",
        "detail": (
            f"{len(ion_401s)} Ion 401 error(s) observed in console/network log. "
            "This trial's screenshot and downstream judge verdict are not reliable; "
            "re-run after verifying CESIUM_ION_TOKEN scopes."
        ),
        "environment_invalid": True,
    }


def run_programmatic_checks(
    scenario: dict[str, Any],
    generated_code: str,
    errors: list[dict[str, Any]],
    scene_state: dict[str, Any] | None = None,
    console_messages: list[dict[str, Any]] | None = None,
    network_failures: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Delegate to checks.engine for the canonical {check_id, result} shape, then add a summary block.

    Also appends a synthetic ion_auth_failure check when Ion 401s are seen,
    so the decision engine and dashboard can distinguish env-tainted trials
    from real candidate regressions.
    """
    console_data = {"errors": errors}
    result = _run_checks_canonical(scenario, generated_code, console_data, scene_state)
    checks = result.get("checks", [])
    ion_check = detect_ion_auth_failure(console_messages, network_failures)
    if ion_check is not None:
        checks.append(ion_check)
        result["environment_invalid"] = True
    passed = sum(1 for c in checks if c.get("result") == "pass")
    total = len(checks)
    result["summary"] = {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "pass_rate": (passed / total) if total else 1.0,
    }
    return result


CARDINAL_PANORAMA_SHOTS: tuple[dict[str, Any], ...] = (
    {
        "timing": "orbit_0",
        "heading_degrees": 0,
        "description": "Orbit view of the subject from heading 0 deg (subject kept centered)",
    },
    {
        "timing": "orbit_90",
        "heading_degrees": 90,
        "description": "Orbit view of the subject from heading 90 deg (subject kept centered)",
    },
    {
        "timing": "orbit_180",
        "heading_degrees": 180,
        "description": "Orbit view of the subject from heading 180 deg (subject kept centered)",
    },
    {
        "timing": "orbit_270",
        "heading_degrees": 270,
        "description": "Orbit view of the subject from heading 270 deg (subject kept centered)",
    },
)

# Panorama capture: instead of rotating the settled camera IN PLACE toward cardinal
# directions (which points away from the subject for ~3 of 4 shots), we ORBIT the
# camera around the framed subject so it stays centered from every angle. The subject
# is the geometry the candidate added (model / 3D tileset / primitive / entities of any
# type); for a globe/imagery-only scene we orbit the point the settled camera looks at.
# On shot 0 we save the settled camera so scene-state can be restored afterward.
ORBIT_PANORAMA_PITCH_DEG = -30
ORBIT_PANORAMA_JS = """
({ headingDegrees, index }) => {
  const C = Cesium;
  if (typeof viewer === 'undefined' || !viewer || !viewer.scene) return;
  const scene = viewer.scene, camera = scene.camera;
  if (index === 0) {
    const p = camera.positionWC;
    window.__PANO_SETTLED__ = { pos: [p.x, p.y, p.z], heading: camera.heading, pitch: camera.pitch, roll: camera.roll };
    window.__PANO_ORBIT__ = null;
  }
  function subjectSphere() {
    const spheres = [];
    try {
      const prims = scene.primitives;
      for (let i = 0; i < prims.length; i++) {
        const pr = prims.get(i);
        try {
          const bs = pr && pr.boundingSphere;
          if (bs && C.defined(bs.center) && isFinite(bs.radius) && bs.radius > 0 && bs.radius < 2.0e6) spheres.push(bs);
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const dsd = viewer.dataSourceDisplay, scr = new C.BoundingSphere(), now = viewer.clock ? viewer.clock.currentTime : undefined;
      for (const e of viewer.entities.values) {
        let got = false;
        try {
          const st = dsd.getBoundingSphere(e, false, scr);
          if (st === C.BoundingSphereState.DONE && isFinite(scr.radius) && scr.radius >= 0) { spheres.push(C.BoundingSphere.clone(scr)); got = true; }
        } catch (e2) {}
        if (!got) { try { const pos = e.position && e.position.getValue(now); if (C.defined(pos)) spheres.push(new C.BoundingSphere(pos, 10)); } catch (e3) {} }
      }
    } catch (e) {}
    if (!spheres.length) return undefined;
    return spheres.length === 1 ? spheres[0] : C.BoundingSphere.fromBoundingSpheres(spheres);
  }
  if (!window.__PANO_ORBIT__) {
    const bs = subjectSphere();
    if (bs) {
      window.__PANO_ORBIT__ = { mode: 'sphere', c: [bs.center.x, bs.center.y, bs.center.z], radius: bs.radius, range: Math.max(bs.radius * 3.2, bs.radius + 60) };
    } else {
      const px = new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
      let t;
      try { t = scene.pickPosition(px); } catch (e) {}
      if (!C.defined(t) || isNaN(t.x)) { try { t = camera.pickEllipsoid(px, scene.globe.ellipsoid); } catch (e) {} }
      if (!C.defined(t)) t = C.Cartesian3.add(camera.positionWC, C.Cartesian3.multiplyByScalar(camera.directionWC, 1500, new C.Cartesian3()), new C.Cartesian3());
      window.__PANO_ORBIT__ = { mode: 'look', c: [t.x, t.y, t.z], range: Math.max(50, C.Cartesian3.distance(camera.positionWC, t)) };
    }
  }
  const o = window.__PANO_ORBIT__;
  const center = new C.Cartesian3(o.c[0], o.c[1], o.c[2]);
  const hpr = new C.HeadingPitchRange(C.Math.toRadians(headingDegrees), C.Math.toRadians(%PITCH%), o.range);
  if (o.mode === 'sphere') camera.viewBoundingSphere(new C.BoundingSphere(center, o.radius), hpr);
  else camera.lookAt(center, hpr);
  camera.lookAtTransform(C.Matrix4.IDENTITY);
}
""".replace("%PITCH%", str(ORBIT_PANORAMA_PITCH_DEG))

# Restore the settled (generated) camera after the orbit so scene-state.json records
# the candidate's framing, not the orbit position.
ORBIT_RESTORE_JS = """
() => {
  const C = Cesium;
  if (typeof viewer === 'undefined' || !viewer || !viewer.scene) return;
  viewer.scene.camera.lookAtTransform(C.Matrix4.IDENTITY);
  const s = window.__PANO_SETTLED__;
  if (s) {
    viewer.scene.camera.setView({
      destination: new C.Cartesian3(s.pos[0], s.pos[1], s.pos[2]),
      orientation: { heading: s.heading, pitch: s.pitch, roll: s.roll }
    });
  }
}
"""


def screenshot_specs_for(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    specs = scenario.get(
        "screenshots",
        [{"delay_ms": 3000, "timing": "default", "description": "default screenshot"}],
    )
    if scenario.get("screenshot_mode") != "cardinal_panorama":
        return list(specs)

    settle_ms = 3000
    if specs:
        settle_ms = max(int(item.get("delay_ms", settle_ms)) for item in specs)
    panorama_delay_ms = int(scenario.get("panorama_delay_ms", 750))
    expanded: list[dict[str, Any]] = []
    for index, shot in enumerate(CARDINAL_PANORAMA_SHOTS):
        expanded.append({
            **shot,
            "delay_ms": settle_ms + (index * panorama_delay_ms),
            "cardinal_panorama": True,
            "index": index,
        })
    return expanded


def load_runs(args: argparse.Namespace) -> list[ScenarioRun]:
    scenarios_dir = REPO_ROOT / "optimization" / "scenarios" / args.skill
    if not scenarios_dir.is_dir():
        raise SystemExit(f"Unknown skill or missing scenario directory: {args.skill}")

    only = {item.strip() for item in args.only.split(",") if item.strip()}
    if args.generated_dir:
        generated_dir = Path(args.generated_dir)
        if not generated_dir.is_absolute():
            generated_dir = REPO_ROOT / generated_dir
    else:
        generated_dir = REPO_ROOT / args.generated_root / args.skill / args.iteration

    if args.output_dir:
        output_dir = Path(args.output_dir)
        if not output_dir.is_absolute():
            output_dir = REPO_ROOT / args.output_dir
    else:
        output_dir = REPO_ROOT / args.output_root / args.skill / args.iteration

    runs: list[ScenarioRun] = []
    for scenario_path in sorted(scenarios_dir.glob("eval-*.json")):
        scenario = load_json(scenario_path)
        if only and scenario["id"] not in only:
            continue
        if scenario.get("runner_mode", "global-js") == "review-only":
            print(f"[run-public-eval] skipping review-only scenario {scenario['id']}")
            continue
        try:
            code_path = find_code_path(generated_dir, scenario)
        except FileNotFoundError as exc:
            raise SystemExit(str(exc)) from exc
        runs.append(
            ScenarioRun(
                scenario=scenario,
                code_path=code_path,
                run_dir=output_dir / scenario_slug(scenario),
            )
        )
    return runs


def main() -> None:
    args = parse_args()
    runs = load_runs(args)
    if not runs:
        raise SystemExit("No runnable scenarios selected")

    if sync_playwright is None:
        print(
            "Missing dependency: playwright. Install locally with:\n"
            "  python3 -m venv .venv\n"
            "  source .venv/bin/activate\n"
            "  pip install playwright\n"
            "  python -m playwright install chromium",
            file=sys.stderr,
        )
        raise SystemExit(2)

    ion_token = resolve_ion_token()
    preflight_ion(ion_token, allow_skip=os.environ.get("EVAL_SKIP_ION_PREFLIGHT") == "1")

    # Collect environment metadata once
    git_commit = get_git_commit()
    playwright_version = get_playwright_version()
    timestamp_utc = datetime.now(timezone.utc).isoformat()

    with LocalHTTPServer(REPO_ROOT) as server:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            chromium_version = browser.version
            try:
                for run in runs:
                    generated_code = run.code_path.read_text()
                    run.run_dir.mkdir(parents=True, exist_ok=True)
                    html_path = run.run_dir / "eval.html"
                    html_path.write_text(render_html(ion_token, generated_code))

                    console_messages: list[dict[str, Any]] = []
                    network_failures: list[dict[str, Any]] = []
                    page = browser.new_page(viewport={"width": 1280, "height": 720})
                    page.on(
                        "console",
                        lambda msg: console_messages.append(
                            {"type": msg.type, "text": msg.text}
                        ),
                    )
                    page.on(
                        "response",
                        lambda response: (
                            network_failures.append({
                                "url": sanitize_url(response.url),
                                "status": response.status,
                                "status_text": response.status_text,
                            })
                            if response.status >= 400
                            else None
                        ),
                    )
                    page.on(
                        "requestfailed",
                        lambda request: network_failures.append({
                            "url": sanitize_url(request.url),
                            "failure": request.failure,
                        }),
                    )
                    # Use "load" rather than "networkidle": continuously-streaming
                    # scenes (terrain, time-dynamic imagery, 3D Tiles) keep the
                    # network active and never reach idle within the timeout. The
                    # scenario-defined screenshot delays below provide the actual
                    # settle time before capture.
                    page.goto(
                        f"{server.base_url}/{html_path.relative_to(REPO_ROOT)}",
                        wait_until="load",
                        timeout=args.timeout_ms,
                    )

                    # Capture screenshots at scenario-defined timings. Visual
                    # scenarios can opt into a canonical four-shot panorama;
                    # the runner rotates the settled camera so every candidate
                    # is judged from north/east/south/west without requiring
                    # generated code to implement that boilerplate.
                    screenshot_specs = screenshot_specs_for(run.scenario)
                    screenshots_taken = []
                    screenshot_quality = []

                    for i, screenshot_spec in enumerate(screenshot_specs):
                        delay_ms = screenshot_spec.get("delay_ms", 1000)
                        page.wait_for_timeout(delay_ms if i == 0 else delay_ms - screenshot_specs[i-1].get("delay_ms", 0))
                        if screenshot_spec.get("cardinal_panorama"):
                            heading_degrees = float(screenshot_spec.get("heading_degrees", 0))
                            shot_index = int(screenshot_spec.get("index", i))
                            page.evaluate(
                                ORBIT_PANORAMA_JS,
                                {"headingDegrees": heading_degrees, "index": shot_index},
                            )
                            page.wait_for_timeout(250)
                        screenshot_filename = f"screenshot-{i}.png" if len(screenshot_specs) > 1 else "screenshot.png"
                        screenshot_path = run.run_dir / screenshot_filename
                        # Bump screenshot timeout from Playwright default (30s)
                        # to 90s — under parallel-runner contention, font load
                        # and tile fetches can exceed 30s easily.
                        page.screenshot(path=str(screenshot_path), full_page=True, timeout=90000)
                        screenshots_taken.append({
                            "index": i,
                            "timing": screenshot_spec.get("timing", f"screenshot-{i}"),
                            "delay_ms": delay_ms,
                            "description": screenshot_spec.get("description", ""),
                            "filename": screenshot_filename
                        })
                        screenshot_quality.append(
                            analyze_screenshot(screenshot_path, expected_width=1280, expected_height=720)
                        )

                    # If we orbited for the panorama, restore the candidate's settled
                    # camera so scene-state.json reflects the generated framing.
                    if any(spec.get("cardinal_panorama") for spec in screenshot_specs):
                        try:
                            page.evaluate(ORBIT_RESTORE_JS)
                            page.wait_for_timeout(100)
                        except Exception:
                            pass

                    errors = page.evaluate("window.__CESIUM_EVAL_ERRORS__ || []")
                    cesium_render_error = page.evaluate("""
                        (() => {
                            const panel = document.querySelector('.cesium-widget-errorPanel');
                            const bodyText = document.body ? document.body.innerText || '' : '';
                            if (panel || bodyText.includes('An error occurred while rendering. Rendering has stopped')) {
                                return {
                                    message: bodyText.includes('An error occurred while rendering. Rendering has stopped')
                                        ? 'Cesium render error panel detected'
                                        : 'Cesium render error panel detected without body text',
                                    source: 'cesium-widget-errorPanel'
                                };
                            }
                            return null;
                        })()
                    """)
                    if cesium_render_error:
                        errors.append(cesium_render_error)

                    # Capture scene state
                    scene_state = {}
                    try:
                        scene_state = page.evaluate("""
                            (() => {
                                if (typeof viewer === 'undefined' || !viewer || !viewer.scene) {
                                    return { available: false };
                                }
                                const scene = viewer.scene;
                                const camera = viewer.camera;
                                return {
                                    available: true,
                                    camera: {
                                        position: {
                                            x: camera.position.x,
                                            y: camera.position.y,
                                            z: camera.position.z
                                        },
                                        heading: camera.heading,
                                        pitch: camera.pitch,
                                        roll: camera.roll
                                    },
                                    entity_count: viewer.entities ? viewer.entities.values.length : 0,
                                    imagery_layer_count: viewer.imageryLayers ? viewer.imageryLayers.length : 0,
                                    primitive_count: scene.primitives ? scene.primitives.length : 0
                                };
                            })()
                        """)
                    except Exception:
                        scene_state = {"available": False, "error": "Failed to extract scene state"}

                    page.close()

                    # Write console.json
                    console_json_path = run.run_dir / "console.json"
                    write_json(
                        console_json_path,
                        {
                            "scenario_id": run.scenario["id"],
                            "console_messages": console_messages,
                            "errors": errors,
                            "network_failures": network_failures,
                            "screenshots": screenshots_taken,
                        },
                    )

                    # Write scene-state.json (needed for schema_match checks)
                    scene_state_json_path = run.run_dir / "scene-state.json"
                    write_json(scene_state_json_path, scene_state)

                    screenshot_quality_path = run.run_dir / "screenshot-quality.json"
                    screenshot_quality_report = {
                        "scenario_id": run.scenario["id"],
                        "screenshots": screenshot_quality,
                        "all_passed": all(item.get("passed") for item in screenshot_quality),
                    }
                    write_json(screenshot_quality_path, screenshot_quality_report)

                    # Write programmatic-checks.json (canonical shape from optimization.framework.checks.engine)
                    checks_json_path = run.run_dir / "programmatic-checks.json"
                    write_json(
                        checks_json_path,
                        add_screenshot_quality_checks(
                            run_programmatic_checks(
                                run.scenario,
                                generated_code,
                                errors,
                                scene_state,
                                console_messages=console_messages,
                                network_failures=network_failures,
                            ),
                            screenshot_quality_report,
                        ),
                    )

                    # Load generation metadata (from skills adapter output)
                    meta_path = run.code_path.with_suffix(".meta.json")
                    generation_meta = load_json(meta_path) if meta_path.exists() else {}

                    # Compute scenario hash (same method as validate-evals.py)
                    scenario_content = json.dumps(run.scenario, sort_keys=True, separators=(',', ':'))
                    scenario_hash = compute_content_hash(scenario_content)

                    # Compute artifact hashes
                    artifact_hashes = {
                        "console": compute_file_hash(console_json_path),
                        "programmatic_checks": compute_file_hash(checks_json_path),
                        "scene_state": compute_file_hash(scene_state_json_path),
                        "screenshot_quality": compute_file_hash(screenshot_quality_path),
                    }

                    # Compute screenshot hashes
                    screenshot_hashes = []
                    for screenshot_info in screenshots_taken:
                        screenshot_path = run.run_dir / screenshot_info["filename"]
                        if screenshot_path.exists():
                            screenshot_hashes.append({
                                "filename": screenshot_info["filename"],
                                "hash": compute_file_hash(screenshot_path),
                            })
                    if screenshot_hashes:
                        artifact_hashes["screenshots"] = screenshot_hashes

                    # Build metadata.json
                    metadata = {
                        "scenario_version_hash": scenario_hash,
                        "candidate_skill_hash": generation_meta.get(
                            "skill_content_hash",
                            compute_content_hash(generated_code),
                        ),
                        "runner_git_commit": git_commit,
                        "model_id": generation_meta.get("model_id", "unknown"),
                        "temperature": generation_meta.get("temperature", 1.0),
                        "judge_protocol_version": "pairwise-v1",
                        "browser_viewport": {"width": 1280, "height": 720},
                        "playwright_version": playwright_version,
                        "chromium_version": chromium_version,
                        "timestamp_utc": timestamp_utc,
                        "artifact_hashes": artifact_hashes,
                    }

                    # Add optional seed if present
                    if "seed" in generation_meta:
                        metadata["seed"] = generation_meta["seed"]

                    # Write metadata.json
                    write_json(run.run_dir / "metadata.json", metadata)

                    print(f"[run-public-eval] wrote {run.run_dir.relative_to(REPO_ROOT)}")
            finally:
                browser.close()


if __name__ == "__main__":
    main()
