"""Tests for codex model/variant defaults and reasoning-effort forwarding
in the harness-neutral dispatch layer.

Regression coverage for a real bug: ``invoke_agent`` used to resolve a codex
variant and then discard it (``_ = agent, title, resolved_variant``), so
reasoning effort silently never reached the codex CLI.
"""

from optimization.framework.adapters import agent_cli


def _clear_codex_env(monkeypatch):
    for name in (
        "CODEX_MODEL",
        "CODEX_PROPOSER_MODEL",
        "CODEX_EVAL_MODEL",
        "CODEX_JUDGE_MODEL",
        "PROPOSER_MODEL",
        "AGENT_MODEL",
        "CODEX_VARIANT",
        "CODEX_PROPOSER_VARIANT",
        "CODEX_EVAL_VARIANT",
        "CODEX_JUDGE_VARIANT",
    ):
        monkeypatch.delenv(name, raising=False)


def test_default_agent_model_codex_falls_back_to_gpt56_sol(monkeypatch):
    _clear_codex_env(monkeypatch)
    assert agent_cli.default_agent_model("proposer", "codex") == "gpt-5.6-sol"
    assert agent_cli.default_agent_model("eval", "codex") == "gpt-5.6-sol"
    assert agent_cli.default_agent_model("judge", "codex") == "gpt-5.6-sol"


def test_default_agent_model_codex_env_override_wins(monkeypatch):
    _clear_codex_env(monkeypatch)
    monkeypatch.setenv("CODEX_MODEL", "o3")
    assert agent_cli.default_agent_model("proposer", "codex") == "o3"


def test_default_agent_variant_codex_falls_back_to_low(monkeypatch):
    _clear_codex_env(monkeypatch)
    assert agent_cli.default_agent_variant("proposer", "codex") == "low"
    assert agent_cli.default_agent_variant("eval", "codex") == "low"
    assert agent_cli.default_agent_variant("judge", "codex") == "low"


def test_default_agent_variant_codex_env_override_wins(monkeypatch):
    _clear_codex_env(monkeypatch)
    monkeypatch.setenv("CODEX_EVAL_VARIANT", "high")
    assert agent_cli.default_agent_variant("eval", "codex") == "high"


def test_invoke_agent_forwards_variant_as_codex_reasoning_effort(monkeypatch):
    _clear_codex_env(monkeypatch)
    captured = {}

    def fake_invoke_codex(**kwargs):
        captured.update(kwargs)
        return "OK"

    monkeypatch.setattr(agent_cli, "invoke_codex", fake_invoke_codex)

    result = agent_cli.invoke_agent(
        "prompt text",
        harness="codex",
        role="proposer",
    )

    assert result == "OK"
    assert captured["model"] == "gpt-5.6-sol"
    assert captured["reasoning_effort"] == "low"


def test_invoke_agent_explicit_variant_overrides_codex_default(monkeypatch):
    _clear_codex_env(monkeypatch)
    captured = {}

    def fake_invoke_codex(**kwargs):
        captured.update(kwargs)
        return "OK"

    monkeypatch.setattr(agent_cli, "invoke_codex", fake_invoke_codex)

    agent_cli.invoke_agent(
        "prompt text",
        harness="codex",
        role="proposer",
        variant="xhigh",
    )

    assert captured["reasoning_effort"] == "xhigh"
