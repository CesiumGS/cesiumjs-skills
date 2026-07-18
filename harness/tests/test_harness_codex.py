"""Tests for the shared codex CLI wrapper, including Copilot routing."""

import subprocess

from harness import codex, copilot


def _fake_tempfile_factory(tmp_path):
    def fake_named_tempfile(*args, **kwargs):
        output = tmp_path / "last-message.txt"
        output.write_text("CODEX_OK\n", encoding="utf-8")

        class Handle:
            name = str(output)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        return Handle()

    return fake_named_tempfile


def test_invoke_codex_uses_exec_json_and_images(monkeypatch, tmp_path):
    screenshot = tmp_path / "screenshot.png"
    screenshot.write_bytes(b"placeholder")
    add_dir = tmp_path / "evidence"
    add_dir.mkdir()
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(codex.shutil, "which", lambda name: "/usr/local/bin/codex")
    monkeypatch.setattr(codex.tempfile, "NamedTemporaryFile", _fake_tempfile_factory(tmp_path))
    monkeypatch.setattr(codex.subprocess, "run", fake_run)

    result = codex.invoke_codex(
        "inspect screenshot",
        model=None,
        files=[screenshot],
        add_dirs=[add_dir],
        cwd=tmp_path,
    )

    assert result == "CODEX_OK"
    assert captured["cmd"][:3] == ["/usr/local/bin/codex", "exec", "--json"]
    assert "--model" not in captured["cmd"]
    assert "--image" in captured["cmd"]
    assert str(screenshot.resolve()) in captured["cmd"]
    assert "--add-dir" in captured["cmd"]
    assert captured["cmd"][-1] == "-"


def test_invoke_codex_reasoning_effort_adds_config_override(monkeypatch, tmp_path):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(codex.shutil, "which", lambda name: "/usr/local/bin/codex")
    monkeypatch.setattr(codex.tempfile, "NamedTemporaryFile", _fake_tempfile_factory(tmp_path))
    monkeypatch.setattr(codex.subprocess, "run", fake_run)

    codex.invoke_codex("hello", model="gpt-5.6-sol", reasoning_effort="low", cwd=tmp_path)

    cmd = captured["cmd"]
    assert cmd[cmd.index("--model") + 1] == "gpt-5.6-sol"
    assert "-c" in cmd
    assert cmd[cmd.index("-c") + 1] == 'model_reasoning_effort="low"'


def test_invoke_codex_no_reasoning_effort_omits_config_flag(monkeypatch, tmp_path):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(codex.shutil, "which", lambda name: "/usr/local/bin/codex")
    monkeypatch.setattr(codex.tempfile, "NamedTemporaryFile", _fake_tempfile_factory(tmp_path))
    monkeypatch.setattr(codex.subprocess, "run", fake_run)

    codex.invoke_codex("hello", cwd=tmp_path)

    assert "-c" not in captured["cmd"]


def test_invoke_codex_copilot_profile_adds_flag_and_injects_token(monkeypatch, tmp_path):
    auth = tmp_path / "auth.json"
    auth.write_text('{"github-copilot": {"refresh": "gho_test_token"}}', encoding="utf-8")
    monkeypatch.setattr(copilot, "OPENCODE_AUTH_PATH", auth)
    monkeypatch.delenv("COPILOT_GHO_TOKEN", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-be-scrubbed")

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs["env"]
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(codex.shutil, "which", lambda name: "/usr/local/bin/codex")
    monkeypatch.setattr(codex.tempfile, "NamedTemporaryFile", _fake_tempfile_factory(tmp_path))
    monkeypatch.setattr(codex.subprocess, "run", fake_run)

    result = codex.invoke_codex("hello", profile="copilot", cwd=tmp_path)

    assert result == "CODEX_OK"
    assert "-p" in captured["cmd"]
    assert captured["cmd"][captured["cmd"].index("-p") + 1] == "copilot"
    assert captured["env"]["COPILOT_GHO_TOKEN"] == "gho_test_token"
    assert "OPENAI_API_KEY" not in captured["env"]


def test_invoke_codex_copilot_profile_missing_token_raises(monkeypatch, tmp_path):
    auth = tmp_path / "auth.json"
    auth.write_text('{"openai": {"access": "x"}}', encoding="utf-8")  # no github-copilot
    monkeypatch.setattr(copilot, "OPENCODE_AUTH_PATH", auth)
    monkeypatch.delenv("COPILOT_GHO_TOKEN", raising=False)
    monkeypatch.setattr(codex.shutil, "which", lambda name: "/usr/local/bin/codex")
    monkeypatch.setattr(codex.tempfile, "NamedTemporaryFile", _fake_tempfile_factory(tmp_path))

    try:
        codex.invoke_codex("hello", profile="copilot", cwd=tmp_path)
    except codex.CodexCLIError as exc:
        assert "copilot" in str(exc).lower()
    else:
        raise AssertionError("expected CodexCLIError when copilot token is missing")


def test_invoke_codex_copilot_profile_respects_preset_token(monkeypatch, tmp_path):
    monkeypatch.setattr(copilot, "OPENCODE_AUTH_PATH", tmp_path / "missing.json")
    monkeypatch.setenv("COPILOT_GHO_TOKEN", "gho_preset")
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["env"] = kwargs["env"]
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(codex.shutil, "which", lambda name: "/usr/local/bin/codex")
    monkeypatch.setattr(codex.tempfile, "NamedTemporaryFile", _fake_tempfile_factory(tmp_path))
    monkeypatch.setattr(codex.subprocess, "run", fake_run)

    codex.invoke_codex("hello", profile="copilot", cwd=tmp_path)
    assert captured["env"]["COPILOT_GHO_TOKEN"] == "gho_preset"


def test_codex_cli_error_keeps_output_tail():
    stderr = "warning\n" * 600 + "actual terminal error"
    error = codex.CodexCLIError(1, stderr=stderr, stdout="")
    message = str(error)
    assert "warning" in message
    assert "actual terminal error" in message
    assert "[truncated]" in message
