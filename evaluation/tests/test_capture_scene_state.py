from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "capture-scene-state.py"


def load_capture_module():
    spec = importlib.util.spec_from_file_location("capture_scene_state", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["capture_scene_state"] = module
    spec.loader.exec_module(module)
    return module


def test_entity_ids_from_case_uses_preflight_checks_and_probe() -> None:
    capture = load_capture_module()
    case = {
        "preflight": {"entities": [{"id": "preflight-marker"}]},
        "probe": {"capture": ["entities[probe-marker].position_ecef"]},
        "checks": [{"entity_id": "check-marker"}],
    }

    assert capture.entity_ids_from_case(case) == [
        "check-marker",
        "preflight-marker",
        "probe-marker",
    ]


def test_capture_paths_include_declared_probe_and_entity_dependencies() -> None:
    capture = load_capture_module()
    case = {
        "preflight": {"entities": [{"id": "preflight-marker"}]},
        "probe": {"capture": ["imagery_layers[*].provider", "clock.multiplier"]},
        "checks": [{"entity_id": "check-marker"}],
    }

    assert capture.capture_paths_from_case(case) == [
        "clock.multiplier",
        "entities[check-marker].position_cartographic",
        "entities[check-marker].position_ecef",
        "entities[preflight-marker].position_cartographic",
        "entities[preflight-marker].position_ecef",
        "imagery_layers[*].provider",
    ]


def test_harness_html_does_not_embed_runtime_token(tmp_path: Path) -> None:
    capture = load_capture_module()

    html_path = capture.write_harness(tmp_path)
    html = html_path.read_text()

    assert "CESIUM_ION_TOKEN" not in html
    assert "Cesium.Viewer" in html
    assert "__captureSceneState" in html


def test_harness_supports_domain_specific_capture_fields(tmp_path: Path) -> None:
    capture = load_capture_module()

    html_path = capture.write_harness(tmp_path)
    html = html_path.read_text()

    assert "__evalEvents" in html
    assert "__recordEvalClick" in html
    assert "function captureTilesets" in html
    assert "function captureTerrain" in html
    assert "out.tilesets = captureTilesets()" in html
    assert "out.terrain = captureTerrain()" in html
    assert "out.events = JSON.parse" in html
