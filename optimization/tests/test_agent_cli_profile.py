"""Tests for codex profile resolution in the harness-neutral dispatch layer."""

from optimization.framework.adapters import agent_cli


def _clear_profile_env(monkeypatch):
    for name in (
        "CODEX_PROFILE",
        "CODEX_PROPOSER_PROFILE",
        "CODEX_EVAL_PROFILE",
        "CODEX_JUDGE_PROFILE",
    ):
        monkeypatch.delenv(name, raising=False)


def test_default_codex_profile_none_without_env(monkeypatch):
    _clear_profile_env(monkeypatch)
    assert agent_cli.default_codex_profile("eval") is None
    assert agent_cli.default_codex_profile("proposer") is None


def test_global_profile_applies_to_text_roles(monkeypatch):
    _clear_profile_env(monkeypatch)
    monkeypatch.setenv("CODEX_PROFILE", "copilot")
    assert agent_cli.default_codex_profile("eval") == "copilot"
    assert agent_cli.default_codex_profile("proposer") == "copilot"


def test_role_specific_profile_overrides_global(monkeypatch):
    _clear_profile_env(monkeypatch)
    monkeypatch.setenv("CODEX_PROFILE", "copilot")
    monkeypatch.setenv("CODEX_EVAL_PROFILE", "none")
    assert agent_cli.default_codex_profile("eval") is None
    assert agent_cli.default_codex_profile("proposer") == "copilot"


def test_judge_never_uses_copilot_profile(monkeypatch):
    """The judge is multimodal; Copilot has no vision, so it must drop copilot."""
    _clear_profile_env(monkeypatch)
    monkeypatch.setenv("CODEX_PROFILE", "copilot")
    assert agent_cli.default_codex_profile("judge") is None

    monkeypatch.setenv("CODEX_JUDGE_PROFILE", "copilot")
    assert agent_cli.default_codex_profile("judge") is None


def test_judge_may_use_non_copilot_profile(monkeypatch):
    _clear_profile_env(monkeypatch)
    monkeypatch.setenv("CODEX_JUDGE_PROFILE", "some-other-profile")
    assert agent_cli.default_codex_profile("judge") == "some-other-profile"
