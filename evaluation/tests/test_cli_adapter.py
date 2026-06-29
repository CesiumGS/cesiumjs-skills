"""CI-safe tests for the qualitative judge OpenCode adapter."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from evaluation.framework.judge.cli_adapter import CodexCliAdapter, OpenCodeCliAdapter
from harness import codex as h_codex
from harness import opencode as h_opencode


def test_opencode_adapter_attaches_screenshot_files(monkeypatch, tmp_path: Path) -> None:
    screenshot = tmp_path / "screenshot.png"
    screenshot.write_bytes(b"not-a-real-png-for-command-construction-only")
    bundle = tmp_path / "bundle"
    bundle.mkdir()

    captured: dict = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs["env"]
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps(
                {"type": "text", "part": {"text": "{\"overall\": 8}"}}
            )
            + "\n",
            stderr="",
        )

    monkeypatch.setattr(h_opencode.shutil, "which", lambda _: "/usr/local/bin/opencode")
    monkeypatch.setattr(h_opencode.subprocess, "run", fake_run)
    monkeypatch.setenv("OPENCODE_JUDGE_MODEL", "openai/gpt-5.5")
    monkeypatch.setenv("OPENCODE_JUDGE_VARIANT", "medium")

    result = OpenCodeCliAdapter().run(
        "judge this attached screenshot",
        "openai/gpt-5.5",
        [str(bundle)],
        [],
        [str(screenshot)],
    )

    assert result == '{"overall": 8}'
    assert captured["cmd"][:4] == [
        "/usr/local/bin/opencode",
        "run",
        "--format",
        "json",
    ]
    assert "--file" in captured["cmd"]
    assert str(screenshot.resolve()) in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("--variant") + 1] == "medium"
    permission = json.loads(captured["env"]["OPENCODE_PERMISSION"])
    assert permission["external_directory"][str(bundle.resolve())] == "allow"


def test_opencode_adapter_maps_gpt55_depth_aliases(monkeypatch, tmp_path: Path) -> None:
    captured: dict = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=json.dumps({"type": "text", "part": {"text": "{\"overall\": 8}"}}) + "\n",
            stderr="",
        )

    monkeypatch.setattr(h_opencode.shutil, "which", lambda _: "/usr/local/bin/opencode")
    monkeypatch.setattr(h_opencode.subprocess, "run", fake_run)

    OpenCodeCliAdapter().run(
        "judge this attached screenshot",
        "openai/gpt-5.5-high",
        [str(tmp_path)],
        [],
        [],
    )

    assert captured["cmd"][captured["cmd"].index("--model") + 1] == "openai/gpt-5.5"
    assert captured["cmd"][captured["cmd"].index("--variant") + 1] == "high"


def test_codex_adapter_attaches_screenshot_images(monkeypatch, tmp_path: Path) -> None:
    screenshot = tmp_path / "screenshot.png"
    screenshot.write_bytes(b"not-a-real-png-for-command-construction-only")
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    output_file = tmp_path / "last-message.txt"
    captured: dict = {}

    def fake_named_tempfile(*args, **kwargs):
        output_file.write_text("{\"overall\": 8}\n", encoding="utf-8")

        class Handle:
            name = str(output_file)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        return Handle()

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(h_codex.shutil, "which", lambda _: "/usr/local/bin/codex")
    monkeypatch.setattr(h_codex.tempfile, "NamedTemporaryFile", fake_named_tempfile)
    monkeypatch.setattr(h_codex.subprocess, "run", fake_run)

    result = CodexCliAdapter().run(
        "judge this attached screenshot",
        "auto",
        [str(bundle)],
        [],
        [str(screenshot)],
    )

    assert result == '{"overall": 8}'
    assert captured["cmd"][:3] == ["/usr/local/bin/codex", "exec", "--json"]
    assert "--model" not in captured["cmd"]
    assert "--image" in captured["cmd"]
    assert str(screenshot.resolve()) in captured["cmd"]
    assert "--add-dir" in captured["cmd"]
    assert str(bundle.resolve()) in captured["cmd"]
