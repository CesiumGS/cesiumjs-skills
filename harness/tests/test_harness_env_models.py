"""Tests for harness env hardening and model/vision policy."""

from types import SimpleNamespace

from harness import env, models


def test_clean_subprocess_env_drops_openai_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-be-dropped")
    monkeypatch.setenv("KEEP_ME", "yes")
    cleaned = env.clean_subprocess_env()
    assert "OPENAI_API_KEY" not in cleaned
    assert cleaned.get("KEEP_ME") == "yes"


def test_latest_default_gpt55_model_prefers_base_model(monkeypatch):
    monkeypatch.setattr(models.shutil, "which", lambda name: "/usr/local/bin/opencode")
    monkeypatch.setattr(models, "_LATEST_MODEL_CACHE", {})

    completed = SimpleNamespace(
        returncode=0,
        stdout="\n".join(
            [
                "github-copilot/gpt-5.5-fast",
                "github-copilot/gpt-5.5-pro",
                "github-copilot/gpt-5.5",
            ]
        ),
        stderr="",
    )
    monkeypatch.setattr(models.subprocess, "run", lambda *args, **kwargs: completed)

    assert models.latest_default_gpt55_model() == "github-copilot/gpt-5.5"


def test_model_supports_vision():
    assert models.model_supports_vision("github-copilot/gpt-5.5") is False
    assert models.model_supports_vision("openai/gpt-5.5") is True
    assert models.model_supports_vision(None) is True


def test_codex_fallback_model_strips_provider_prefix(monkeypatch):
    monkeypatch.delenv("AGENT_VISION_FALLBACK_MODEL", raising=False)
    monkeypatch.delenv("CODEX_VISION_FALLBACK_MODEL", raising=False)
    assert models.codex_fallback_model("github-copilot/gpt-5.5") == "gpt-5.5"
    assert models.codex_fallback_model("gpt-5.5") == "gpt-5.5"


def test_codex_fallback_model_override_wins(monkeypatch):
    monkeypatch.setenv("AGENT_VISION_FALLBACK_MODEL", "o4-mini")
    assert models.codex_fallback_model("github-copilot/gpt-5.5") == "o4-mini"


def test_vision_fallback_enabled_toggle(monkeypatch):
    monkeypatch.delenv("AGENT_VISION_FALLBACK", raising=False)
    assert models.vision_fallback_enabled() is True
    monkeypatch.setenv("AGENT_VISION_FALLBACK", "0")
    assert models.vision_fallback_enabled() is False
    monkeypatch.setenv("AGENT_VISION_FALLBACK", "off")
    assert models.vision_fallback_enabled() is False
