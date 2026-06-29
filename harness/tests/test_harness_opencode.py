"""Tests for the shared opencode CLI wrapper."""

import json
from types import SimpleNamespace

from harness import opencode


def test_invoke_opencode_attaches_files(monkeypatch, tmp_path):
    screenshot = tmp_path / "screenshot.png"
    screenshot.write_bytes(b"placeholder")
    captured = {}

    completed = SimpleNamespace(
        returncode=0,
        stdout=json.dumps({"type": "text", "part": {"text": "OK"}}) + "\n",
        stderr="",
    )

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return completed

    monkeypatch.setattr(opencode.shutil, "which", lambda name: "/usr/local/bin/opencode")
    monkeypatch.setattr(opencode.subprocess, "run", fake_run)

    result = opencode.invoke_opencode(
        "inspect screenshot",
        model="openai/gpt-5.5",
        variant="medium",
        files=[screenshot],
    )

    assert result == "OK"
    assert "--file" in captured["cmd"]
    assert str(screenshot.resolve()) in captured["cmd"]


def test_invoke_opencode_permission_allowlist_and_dirs(monkeypatch, tmp_path):
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    captured = {}

    completed = SimpleNamespace(
        returncode=0,
        stdout=json.dumps({"type": "text", "part": {"text": "OK"}}) + "\n",
        stderr="",
    )

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs["env"]
        return completed

    monkeypatch.setattr(opencode.shutil, "which", lambda name: "/usr/local/bin/opencode")
    monkeypatch.setattr(opencode.subprocess, "run", fake_run)

    opencode.invoke_opencode(
        "judge",
        model="openai/gpt-5.5",
        allowed_tools=[],
        add_dirs=[bundle],
    )

    permission = json.loads(captured["env"]["OPENCODE_PERMISSION"])
    assert permission["external_directory"][str(bundle.resolve())] == "allow"
