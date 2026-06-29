"""Tests for shared harness selection."""

import pytest

from harness import selection


def _clear(monkeypatch):
    for name in (
        "AGENT_HARNESS",
        "CESIUM_AGENT_HARNESS",
        "EVAL_HARNESS",
        "JUDGE_HARNESS",
        "PROPOSER_HARNESS",
    ):
        monkeypatch.delenv(name, raising=False)


def test_default_is_opencode(monkeypatch):
    _clear(monkeypatch)
    assert selection.default_harness("eval") == "opencode"
    assert selection.default_harness("judge") == "opencode"


def test_role_specific_env_wins(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("AGENT_HARNESS", "opencode")
    monkeypatch.setenv("JUDGE_HARNESS", "codex")
    assert selection.default_harness("judge") == "codex"
    assert selection.default_harness("eval") == "opencode"


def test_resolve_auto_and_validation(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("EVAL_HARNESS", "codex")
    assert selection.resolve_harness("auto", "eval") == "codex"
    assert selection.resolve_harness("OpenCode") == "opencode"
    with pytest.raises(selection.HarnessError):
        selection.resolve_harness("gemini-cli")
