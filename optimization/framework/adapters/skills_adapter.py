#!/usr/bin/env python3
"""
Skills adapter implementation for evaluating Claude (via the CLI) with CesiumJS skills.

This adapter invokes the local `claude` CLI with a candidate skill file and
scenario prompt, generates JavaScript code output, and provides safety scanning
to prevent leaking credentials or absolute paths in generated artifacts.
The CLI handles authentication itself — no personal API key is required.
"""

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from optimization.framework.adapters.base import Adapter
from optimization.framework.adapters.claude_cli import (
    ClaudeCLIError,
    ClaudeCLINotFoundError,
    ensure_cli_available,
    invoke_claude,
)


_WRAP_FENCE_RE = re.compile(r"^```(?:javascript|js|ts|typescript)?\s*\n(.*?)\n```\s*$", re.DOTALL)
_INLINE_FENCE_RE = re.compile(r"```(?:javascript|js|ts|typescript)\s*\n(.*?)\n```", re.DOTALL)


def _strip_code_fences(text: str) -> str:
    """Extract the JavaScript body from the model's response.

    Handles three layouts the model returns despite instructions:
    1. Pure code (no fences) — returned as-is.
    2. A single wrapping ```js fence``` — fences stripped.
    3. Prose + ```js code``` + prose — first js code block extracted.
    """
    stripped = text.strip()

    match = _WRAP_FENCE_RE.match(stripped)
    if match:
        return match.group(1).strip()

    inline = _INLINE_FENCE_RE.search(stripped)
    if inline:
        return inline.group(1).strip()

    return stripped


class SkillsAdapter(Adapter):
    """
    Adapter for evaluating Claude API with CesiumJS skill files.

    This adapter:
    1. Reads a skill file from the filesystem
    2. Combines it with a scenario prompt
    3. Calls the Claude API to generate JavaScript code
    4. Writes the generated code to optimization/generated/<skill>/<iteration>/<eval-id>.js
    5. Writes metadata sidecar to optimization/generated/<skill>/<iteration>/<eval-id>.meta.json
    6. Performs safety scanning on the generated output
    """

    ADAPTER_VERSION = "1.0.0"

    # Safety scan patterns - matches patterns from optimization/scripts/check-public-artifacts.py
    ION_TOKEN_PATTERN = re.compile(
        r'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',
        re.IGNORECASE
    )
    ABSOLUTE_PATH_PATTERN = re.compile(
        r'(?:/Users/|/home/|C:\\Users\\)',
        re.IGNORECASE
    )

    def __init__(self, skill: str, iteration, model_id: str = "claude-opus-4-7",
                 temperature: float = 1.0):
        """
        Initialize the skills adapter.

        Args:
            skill: Skill name (e.g., "cesiumjs-camera")
            iteration: Iteration identifier for output organization. Accepts
                either an int (legacy callers) or a string (preferred — preserves
                zero-padding like "001" so directory paths line up with the
                runner's expectations).
            model_id: Claude model identifier or alias passed to `claude --model`
            temperature: Recorded in metadata for reproducibility. The CLI does
                not expose a temperature flag; this is informational only.

        Raises:
            ClaudeCLINotFoundError: If `claude` is not on PATH.
        """
        ensure_cli_available()

        self.skill = skill
        self.iteration = iteration
        self.model_id = model_id
        self.temperature = temperature

        # State tracking
        self._scenario: Optional[Dict[str, Any]] = None
        self._candidate: Optional[Dict[str, Any]] = None
        self._skill_content: Optional[str] = None
        self._skill_content_hash: Optional[str] = None
        self._generated_code: Optional[str] = None
        self._output_path: Optional[str] = None
        self._timestamp: Optional[str] = None
        self._invoked = False

    def prepare(self, scenario: Dict[str, Any], candidate: Dict[str, Any]) -> None:
        """
        Prepare the adapter with scenario and candidate skill configuration.

        Args:
            scenario: Scenario manifest dict with fields like id, prompt, etc.
            candidate: Candidate configuration dict with "skill_path" field

        Raises:
            ValueError: If scenario or candidate is invalid or skill file not found
        """
        # Validate scenario
        if not isinstance(scenario, dict):
            raise ValueError("scenario must be a dict")
        if "id" not in scenario:
            raise ValueError("scenario must have 'id' field")
        if "prompt" not in scenario:
            raise ValueError("scenario must have 'prompt' field")

        # Validate candidate
        if not isinstance(candidate, dict):
            raise ValueError("candidate must be a dict")
        if "skill_path" not in candidate:
            raise ValueError("candidate must have 'skill_path' field")

        skill_path = Path(candidate["skill_path"])
        if not skill_path.exists():
            raise ValueError(f"Skill file not found: {skill_path}")

        # Read and hash skill content
        self._skill_content = skill_path.read_text(encoding="utf-8")
        self._skill_content_hash = hashlib.sha256(
            self._skill_content.encode("utf-8")
        ).hexdigest()

        self._scenario = scenario
        self._candidate = candidate

    def invoke(self) -> str:
        """
        Invoke the `claude` CLI to generate JavaScript code.

        Returns:
            str: Path to the generated JavaScript file

        Raises:
            RuntimeError: If prepare() was not called or the CLI fails.
        """
        if self._scenario is None or self._candidate is None:
            raise RuntimeError("prepare() must be called before invoke()")

        # Construct prompt combining skill content and scenario prompt.
        # Runtime contract: the generated code is dropped inside an async IIFE
        # in eval.html where a global `Cesium` namespace exists and
        # `cesiumContainer` is the host element. The code itself must create
        # the viewer (e.g. `const viewer = new Cesium.Viewer('cesiumContainer', ...);`)
        # so that scene-state extraction (which probes `typeof viewer`) works.
        system_prompt = f"""You are an expert CesiumJS developer. Use the following skill documentation to help you generate code:

{self._skill_content}

Runtime contract for your output:
- The code runs inside an async IIFE in a browser page that has already loaded the global CesiumJS UMD bundle (the `Cesium` namespace is available; do NOT use ES module `import` statements).
- A div with id `cesiumContainer` exists. Your code MUST create the viewer and assign it to BOTH a local `viewer` and `window.viewer` so the scene-state probe (which runs in page global scope) can see it. Pattern:
    `const viewer = (window.viewer = new Cesium.Viewer('cesiumContainer', {{ /* options */ }}));`
  If you forget the `window.viewer` assignment, scene-state will silently report `available: false`.
- `Cesium.Ion.defaultAccessToken` is already configured — do not set it or hardcode any token.
- Top-level `await` is allowed (you are inside an async function).
- Async asset loads (3D Tiles, glTF models, terrain, imagery layers) must be awaited before camera setView/zoomTo/flyTo so the framing references resolved content. For Cesium3DTileset and Model, also await tileset.readyEvent / model.readyEvent (or readyPromise) when sizing the camera to the tileset's boundingSphere.
- For framing Cesium3DTileset targets, prefer `viewer.flyTo(tileset, {{ duration: 0 }})` (or zoomTo) so the camera lands on the tileset's bounding sphere.
- For framing Model targets, do NOT rely on `viewer.flyTo(model, ...)`, `model.boundingSphere`, or `viewer.camera.flyToBoundingSphere(model.boundingSphere, ...)` — these are unreliable across Cesium versions and often fail in the eval runtime. Compute explicit camera coordinates from the model's known position and call `viewer.camera.setView({{ destination: Cesium.Cartesian3.fromDegrees(camLng, camLat, camAlt), orientation: {{ heading, pitch, roll }} }})`, or use `viewer.camera.lookAt(targetCartesian, new Cesium.HeadingPitchRange(...))` with a target you compute yourself.
- Polygon hierarchy trap: `Cesium.PolygonHierarchy` has no static `fromDegrees()` or `fromEquatorialCoordinates()` helpers. For entity polygons, use `hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray([lon1, lat1, lon2, lat2, ...]))`.
- Material trap: there is no `Cesium.WaterMaterialProperty` constructor for entity polygons in the global CesiumJS runtime. Use Fabric `Cesium.Material.fromType("Water", ...)` with a `Primitive`/`MaterialAppearance`, or use a supported entity `MaterialProperty` when Fabric water is not required.
- Imagery readiness trap: do not block simple imagery scenes on `layer.readyEvent` unless the scenario explicitly asks for ready/error event wiring. If you do use readiness events, guard the property before calling `.addEventListener` so unavailable events do not throw.
- Public eval asset trap: the public eval suite must render without relying on private Cesium ion asset entitlements. Unless the scenario explicitly requires testing an ion-specific API, do NOT call token-backed helpers such as `Cesium.createOsmBuildingsAsync()`, `Cesium.createGooglePhotorealistic3DTileset()`, `Cesium.Terrain.fromWorldTerrain()`, `Cesium.CesiumTerrainProvider.fromIonAssetId(...)`, `Cesium.IonImageryProvider.fromAssetId(...)`, or `Cesium.ImageryLayer.fromWorldImagery(...)`. Prefer public URL-backed assets, procedural data, entities/primitives, or an OpenStreetMap base layer.
- Default viewer trap: `new Cesium.Viewer('cesiumContainer')` creates Ion-backed defaults and visible widgets that make eval screenshots noisy or fail when the token lacks asset access. Unless the scenario explicitly requires Ion terrain, Ion imagery, timeline/animation UI, or another base layer, start from an eval-stable viewer:
    `const viewer = (window.viewer = new Cesium.Viewer('cesiumContainer', {{ baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({{ url: 'https://tile.openstreetmap.org/', maximumLevel: 18 }})), baseLayerPicker: false, navigationHelpButton: false, animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false, fullscreenButton: false, infoBox: false, selectionIndicator: false }}));`
  Then set `viewer.scene.globe.enableLighting = false;` unless the scenario is specifically about lighting, atmosphere, terrain, or day/night effects.

Visual-quality requirements (judges score on whether the screenshot matches the scenario):
- The subject (landmark, model, polygon, particles, etc.) MUST be clearly visible in the final framing — not a speck, not off-screen, not behind the camera, not below the horizon.
- For city/landmark scenarios, position the camera so the landmark fills a meaningful portion of the frame (roughly 1/3 to 2/3 of one dimension).
- For altitude/heading values: pitch is in RADIANS via `Cesium.Math.toRadians(deg)`; negative pitch looks down.
- If the prompt suggests a heading, use it — but ensure the resulting framing actually points at the subject. Sanity-check: would a human looking out the camera see the landmark?

Output requirements:
- Return ONLY the JavaScript body — no markdown fences, no prose intro, no commentary, no explanations after the code.
- The body must be valid JS that can be inserted directly into the IIFE.
"""

        user_prompt = self._scenario["prompt"]

        try:
            self._timestamp = datetime.now(timezone.utc).isoformat()

            response_text = invoke_claude(
                prompt=user_prompt,
                system=system_prompt,
                model=self.model_id,
                disable_tools=True,  # Pure code generation; no file access needed.
            )

            if not response_text:
                raise RuntimeError("claude CLI returned empty response")

            self._generated_code = _strip_code_fences(response_text)

            # Safety scan before writing (raises ValueError on violation)
            self._safety_scan(self._generated_code)

            # Write output files
            self._write_output()

            self._invoked = True
            return self._output_path

        except ValueError:
            # Re-raise safety violations without wrapping
            raise
        except (ClaudeCLIError, ClaudeCLINotFoundError) as e:
            raise RuntimeError(f"claude CLI invocation failed: {e}") from e

    def collect_output(self) -> tuple[str, Dict[str, Any]]:
        """
        Collect the generated output and metadata.

        Returns:
            tuple: (output_path, metadata_dict)

        Raises:
            RuntimeError: If invoke() has not been called successfully
        """
        if not self._invoked or self._output_path is None:
            raise RuntimeError("invoke() must be called successfully before collect_output()")

        metadata = {
            "model_id": self.model_id,
            "temperature": self.temperature,
            "skill_content_hash": self._skill_content_hash,
            "timestamp_utc": self._timestamp,
            "scenario_id": self._scenario["id"],
            "skill": self.skill,
            "iteration": self.iteration,
        }

        return (self._output_path, metadata)

    def runtime_metadata(self) -> Dict[str, Any]:
        """
        Return metadata about the runtime environment.

        Returns:
            dict: Runtime metadata including adapter type, version, etc.
        """
        return {
            "adapter_type": "skills",
            "adapter_version": self.ADAPTER_VERSION,
            "runtime_name": "claude-cli",
            "model_id": self.model_id,
            "temperature": self.temperature,
        }

    def _safety_scan(self, code: str) -> None:
        """
        Scan generated code for security issues.

        Args:
            code: Generated JavaScript code

        Raises:
            ValueError: If Ion token or absolute path detected in code
        """
        # Check for Ion tokens
        if self.ION_TOKEN_PATTERN.search(code):
            raise ValueError(
                "SAFETY VIOLATION: Generated code contains Cesium Ion token. "
                "Refusing to write output file."
            )

        # Check for absolute paths
        if self.ABSOLUTE_PATH_PATTERN.search(code):
            raise ValueError(
                "SAFETY VIOLATION: Generated code contains absolute filesystem path. "
                "Refusing to write output file."
            )

    def _write_output(self) -> None:
        """
        Write generated code and metadata to filesystem.

        Creates directory structure and writes:
        - optimization/generated/<skill>/<iteration>/<eval-id>.js
        - optimization/generated/<skill>/<iteration>/<eval-id>.meta.json
        """
        eval_id = self._scenario["id"]

        # Create output directory
        output_dir = Path("optimization") / "generated" / self.skill / str(self.iteration)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Write JavaScript file
        js_path = output_dir / f"{eval_id}.js"
        js_path.write_text(self._generated_code, encoding="utf-8")
        self._output_path = str(js_path)

        # Write metadata sidecar
        metadata = {
            "model_id": self.model_id,
            "temperature": self.temperature,
            "skill_content_hash": self._skill_content_hash,
            "timestamp_utc": self._timestamp,
            "scenario_id": eval_id,
            "skill": self.skill,
            "iteration": self.iteration,
        }

        meta_path = output_dir / f"{eval_id}.meta.json"
        meta_path.write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n",
            encoding="utf-8"
        )
