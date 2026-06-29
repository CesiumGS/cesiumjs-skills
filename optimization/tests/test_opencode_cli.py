"""Optimization-specific OpenCode policy: role-based model/variant defaults.

The subprocess mechanics and model discovery are tested in ``harness/tests``;
this file only covers the optimization role->env resolution layered on top.
"""

from optimization.framework.adapters import opencode_cli


def test_default_opencode_model_roles(monkeypatch):
    monkeypatch.delenv("OPENCODE_MODEL", raising=False)
    monkeypatch.delenv("OPENCODE_PROPOSER_MODEL", raising=False)
    monkeypatch.delenv("OPENCODE_EVAL_MODEL", raising=False)
    monkeypatch.delenv("OPENCODE_JUDGE_MODEL", raising=False)
    monkeypatch.setattr(opencode_cli, "_latest_default_gpt55_model", lambda: "github-copilot/gpt-5.5")

    assert opencode_cli.default_opencode_model("proposer") == "github-copilot/gpt-5.5"
    assert opencode_cli.default_opencode_model("eval") == "github-copilot/gpt-5.5"
    assert opencode_cli.default_opencode_model("judge") == "github-copilot/gpt-5.5"
    assert opencode_cli.default_opencode_variant("proposer") == "high"
    assert opencode_cli.default_opencode_variant("eval") == "medium"
    assert opencode_cli.default_opencode_variant("judge") == "medium"

    monkeypatch.setenv("OPENCODE_PROPOSER_MODEL", "openai/custom-proposer")
    monkeypatch.setenv("OPENCODE_EVAL_MODEL", "openai/custom-eval")
    monkeypatch.setenv("OPENCODE_PROPOSER_VARIANT", "max")
    monkeypatch.setenv("OPENCODE_EVAL_VARIANT", "low")

    assert opencode_cli.default_opencode_model("proposer") == "openai/custom-proposer"
    assert opencode_cli.default_opencode_model("eval") == "openai/custom-eval"
    assert opencode_cli.default_opencode_variant("proposer") == "max"
    assert opencode_cli.default_opencode_variant("eval") == "low"


def test_auto_env_forces_discovery(monkeypatch):
    monkeypatch.setenv("OPENCODE_MODEL", "openai/custom-general")
    monkeypatch.setenv("OPENCODE_PROPOSER_MODEL", "auto")
    monkeypatch.setattr(opencode_cli, "_latest_default_gpt55_model", lambda: "github-copilot/gpt-5.5")

    assert opencode_cli.default_opencode_model("proposer") == "github-copilot/gpt-5.5"


def test_discovery_failure_uses_concrete_fallback(monkeypatch):
    for name in (
        "OPENCODE_MODEL",
        "OPENCODE_PROPOSER_MODEL",
        "OPENCODE_EVAL_MODEL",
        "OPENCODE_JUDGE_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(opencode_cli, "_latest_default_gpt55_model", lambda: None)

    assert opencode_cli.default_opencode_model("proposer") == "github-copilot/gpt-5.5"
    assert opencode_cli.default_opencode_model("eval") == "github-copilot/gpt-5.5"
