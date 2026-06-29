"""OpenCode CLI access for the optimization pipeline.

The subprocess mechanics live in the neutral :mod:`harness.opencode` package
(shared with the evaluation pipeline). This module adds the optimization-specific
*policy*: role-based model/variant defaults driven by ``OPENCODE_*`` env vars.
"""

from __future__ import annotations

import os

from harness.env import clean_subprocess_env as _clean_subprocess_env  # noqa: F401  (re-exported)
from harness.models import (
    DEFAULT_MODEL as DEFAULT_OPENCODE_MODEL,
    HIGH_VARIANT as DEFAULT_OPENCODE_HIGH_VARIANT,
    MEDIUM_VARIANT as DEFAULT_OPENCODE_MEDIUM_VARIANT,
    latest_default_gpt55_model as _latest_default_gpt55_model,
)
from harness.opencode import (  # noqa: F401  (re-exported public surface)
    OpenCodeCLIError,
    OpenCodeCLINotFoundError,
    ensure_cli_available,
    invoke_opencode,
)


def default_opencode_model(role: str = "default") -> str:
    """Return the configured OpenCode model for a pipeline role.

    By default this discovers GPT-5.5 through the installed OpenCode CLI.
    Role-specific env vars can override the defaults without changing code.
    Setting any candidate env var to ``auto`` forces discovery for that role.
    """

    normalized = role.lower()
    if normalized == "proposer":
        role_env = "OPENCODE_PROPOSER_MODEL"
    elif normalized in {"eval", "codegen"}:
        role_env = "OPENCODE_EVAL_MODEL"
    else:
        role_env = "OPENCODE_JUDGE_MODEL" if normalized == "judge" else None

    candidates = [role_env, "OPENCODE_MODEL"]
    for name in candidates:
        if not name:
            continue
        value = os.environ.get(name)
        if value:
            if value.strip().lower() == "auto":
                break
            return value

    return _latest_default_gpt55_model() or DEFAULT_OPENCODE_MODEL


def default_opencode_variant(role: str = "default") -> str:
    """Return the configured OpenCode model variant for a pipeline role."""

    normalized = role.lower()
    if normalized == "proposer":
        role_env = "OPENCODE_PROPOSER_VARIANT"
        fallback = DEFAULT_OPENCODE_HIGH_VARIANT
    elif normalized in {"eval", "codegen"}:
        role_env = "OPENCODE_EVAL_VARIANT"
        fallback = DEFAULT_OPENCODE_MEDIUM_VARIANT
    else:
        role_env = "OPENCODE_JUDGE_VARIANT" if normalized == "judge" else None
        fallback = DEFAULT_OPENCODE_MEDIUM_VARIANT

    for name in (role_env, "OPENCODE_VARIANT"):
        if not name:
            continue
        value = os.environ.get(name)
        if value:
            return value
    return fallback


def resolve_opencode_model(model: str | None, role: str = "sonnet") -> str:
    """Resolve an optional model id, accepting ``auto`` as the role default."""

    if model and model.strip().lower() != "auto":
        return model
    return default_opencode_model(role)


def resolve_opencode_variant(variant: str | None, role: str = "default") -> str:
    """Resolve an optional model variant, accepting ``auto`` as role default."""

    if variant and variant.strip().lower() != "auto":
        return variant
    return default_opencode_variant(role)
