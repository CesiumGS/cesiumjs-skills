"""Neutral, shared agent-CLI harness.

Single source of truth for driving the ``opencode`` and ``codex`` command-line
tools from automation. Both the ``optimization`` and ``evaluation`` pipelines
depend on this package so the subprocess construction, output parsing, env
hardening, model discovery, Copilot routing, and vision-fallback policy live in
exactly one place.

This package intentionally imports nothing from ``optimization`` or
``evaluation`` -- it is a leaf dependency. The ``evaluation`` boundary validator
(``evaluation/scripts/validate-evaluation.py``) only forbids importing
``optimization``; depending on this neutral package is allowed.
"""

from __future__ import annotations

from harness.codex import (
    CodexCLIError,
    CodexCLINotFoundError,
    ensure_cli_available as ensure_codex_available,
    invoke_codex,
)
from harness.copilot import (
    COPILOT_PROFILE,
    COPILOT_TOKEN_ENV,
    OPENCODE_AUTH_PATH,
    read_copilot_gho_token,
)
from harness.env import DISALLOWED_ENV_VARS, clean_subprocess_env
from harness.models import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    HIGH_VARIANT,
    MEDIUM_VARIANT,
    codex_fallback_model,
    latest_default_gpt55_model,
    model_supports_vision,
    vision_fallback_enabled,
)
from harness.opencode import (
    OpenCodeCLIError,
    OpenCodeCLINotFoundError,
    ensure_cli_available as ensure_opencode_available,
    invoke_opencode,
)

__all__ = [
    "CodexCLIError",
    "CodexCLINotFoundError",
    "invoke_codex",
    "ensure_codex_available",
    "COPILOT_PROFILE",
    "COPILOT_TOKEN_ENV",
    "OPENCODE_AUTH_PATH",
    "read_copilot_gho_token",
    "DISALLOWED_ENV_VARS",
    "clean_subprocess_env",
    "DEFAULT_MODEL",
    "DEFAULT_PROVIDER",
    "HIGH_VARIANT",
    "MEDIUM_VARIANT",
    "codex_fallback_model",
    "latest_default_gpt55_model",
    "model_supports_vision",
    "vision_fallback_enabled",
    "OpenCodeCLIError",
    "OpenCodeCLINotFoundError",
    "invoke_opencode",
    "ensure_opencode_available",
]
