"""Harness-neutral agent CLI dispatch for evaluation and optimization."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Sequence

from optimization.framework.adapters.codex_cli import (
    CodexCLIError,
    CodexCLINotFoundError,
    ensure_cli_available as ensure_codex_available,
    invoke_codex,
)
from optimization.framework.adapters.opencode_cli import (
    OpenCodeCLIError,
    OpenCodeCLINotFoundError,
    default_opencode_model,
    default_opencode_variant,
    ensure_cli_available as ensure_opencode_available,
    invoke_opencode,
    resolve_opencode_model,
    resolve_opencode_variant,
)
from harness.models import (
    DEFAULT_CODEX_MODEL as _DEFAULT_CODEX_MODEL,
    DEFAULT_CODEX_REASONING_EFFORT as _DEFAULT_CODEX_REASONING_EFFORT,
    codex_fallback_model as _codex_fallback_model,
    model_supports_vision as _opencode_model_supports_vision,
    vision_fallback_enabled as _vision_fallback_enabled,
)
from harness.selection import (
    VALID_HARNESSES,
    HarnessError as AgentHarnessError,
    default_harness as default_agent_harness,
    resolve_harness as resolve_agent_harness,
    role_prefix as _role_prefix,
)


AgentCLINotFoundError = (OpenCodeCLINotFoundError, CodexCLINotFoundError)
AgentCLIError = (OpenCodeCLIError, CodexCLIError)


def default_agent_model(role: str = "default", harness: str | None = None) -> str:
    resolved_harness = resolve_agent_harness(harness, role)
    prefix = _role_prefix(role)
    if resolved_harness == "codex":
        for name in (f"CODEX_{prefix}_MODEL", "CODEX_MODEL", f"{prefix}_MODEL", "AGENT_MODEL"):
            value = os.environ.get(name)
            if value:
                return value
        return _DEFAULT_CODEX_MODEL
    return default_opencode_model(role)


def default_codex_profile(role: str = "default") -> str | None:
    """Return the codex config profile for a role, or None for the base config.

    Text roles can opt into the Copilot subscription with
    ``CODEX_PROFILE=copilot`` (or role-specific ``CODEX_<ROLE>_PROFILE``). The
    judge is multimodal and Copilot has no vision, so the judge never uses the
    Copilot profile regardless of configuration.
    """

    prefix = _role_prefix(role)
    profile: str | None = None
    for name in (f"CODEX_{prefix}_PROFILE", "CODEX_PROFILE"):
        value = os.environ.get(name)
        if value:
            normalized = value.strip()
            profile = None if normalized.lower() in {"", "none", "default"} else normalized
            break
    if role.lower() == "judge" and profile == "copilot":
        return None
    return profile


def default_agent_variant(role: str = "default", harness: str | None = None) -> str | None:
    resolved_harness = resolve_agent_harness(harness, role)
    if resolved_harness == "codex":
        prefix = _role_prefix(role)
        for name in (f"CODEX_{prefix}_VARIANT", "CODEX_VARIANT"):
            value = os.environ.get(name)
            if value:
                return value
        return _DEFAULT_CODEX_REASONING_EFFORT
    return default_opencode_variant(role)


def resolve_agent_model(
    model: str | None,
    role: str = "default",
    harness: str | None = None,
) -> str | None:
    resolved_harness = resolve_agent_harness(harness, role)
    if resolved_harness == "codex":
        value = model if model is not None else default_agent_model(role, resolved_harness)
        if not value or value.strip().lower() == "auto":
            return None
        return value
    return resolve_opencode_model(model, role)


def resolve_agent_variant(
    variant: str | None,
    role: str = "default",
    harness: str | None = None,
) -> str | None:
    resolved_harness = resolve_agent_harness(harness, role)
    if resolved_harness == "codex":
        value = variant if variant is not None else default_agent_variant(role, resolved_harness)
        if not value or value.strip().lower() == "auto":
            return None
        return value
    return resolve_opencode_variant(variant, role)


# Vision fallback: the Copilot subscription powers all text work, but its
# multimodal endpoint is disabled for this account (any image-bearing opencode
# call returns HTTP 400 "vision is not enabled"). When such a call carries image
# `files`, ``invoke_agent`` re-routes it to the codex (ChatGPT) harness with the
# same model. The policy helpers live in :mod:`harness.models`:
#   _vision_fallback_enabled / _opencode_model_supports_vision / _codex_fallback_model
# Knobs: AGENT_VISION_FALLBACK=0 disables; AGENT_VISION_FALLBACK_MODEL overrides.


def ensure_agent_cli_available(harness: str | None = None, role: str = "default") -> str:
    resolved_harness = resolve_agent_harness(harness, role)
    if resolved_harness == "codex":
        return ensure_codex_available()
    return ensure_opencode_available()


def invoke_agent(
    prompt: str,
    *,
    harness: str | None = None,
    role: str = "default",
    system: str | None = None,
    model: str | None = None,
    agent: str | None = None,
    variant: str | None = None,
    files: Sequence[str | Path] | None = None,
    cwd: str | Path | None = None,
    add_dirs: Sequence[str | Path] | None = None,
    allowed_tools: Sequence[str] | None = None,
    disable_tools: bool = False,
    title: str | None = None,
    timeout_seconds: int = 600,
) -> str:
    """Invoke the configured agent harness and return assistant text."""

    resolved_harness = resolve_agent_harness(harness, role)
    resolved_model = resolve_agent_model(model, role, resolved_harness)
    resolved_variant = resolve_agent_variant(variant, role, resolved_harness)

    if resolved_harness == "codex":
        _ = agent, title
        return invoke_codex(
            prompt=prompt,
            system=system,
            model=resolved_model,
            reasoning_effort=resolved_variant,
            profile=default_codex_profile(role),
            files=files,
            cwd=cwd,
            add_dirs=add_dirs,
            allowed_tools=allowed_tools,
            disable_tools=disable_tools,
            timeout_seconds=timeout_seconds,
        )

    # Multimodal fallback: opencode/Copilot can't accept images, so re-route
    # any image-bearing call to the codex (ChatGPT subscription) harness.
    if (
        files
        and _vision_fallback_enabled()
        and not _opencode_model_supports_vision(resolved_model)
    ):
        fallback_model = _codex_fallback_model(resolved_model)
        print(
            f"[agent_cli] vision fallback: {role} call has image inputs but "
            f"opencode model {resolved_model!r} lacks vision; routing to codex "
            f"model {fallback_model!r}.",
            file=sys.stderr,
        )
        return invoke_codex(
            prompt=prompt,
            system=system,
            model=fallback_model,
            reasoning_effort=resolved_variant,
            # Images must stay on the ChatGPT subscription: never the Copilot
            # profile, whose endpoint has no vision.
            profile=None,
            files=files,
            cwd=cwd,
            add_dirs=add_dirs,
            allowed_tools=allowed_tools,
            disable_tools=disable_tools,
            timeout_seconds=timeout_seconds,
        )

    return invoke_opencode(
        prompt=prompt,
        system=system,
        model=resolved_model,
        agent=agent,
        variant=resolved_variant,
        files=files,
        cwd=cwd,
        add_dirs=add_dirs,
        allowed_tools=allowed_tools,
        disable_tools=disable_tools,
        title=title,
        timeout_seconds=timeout_seconds,
    )
