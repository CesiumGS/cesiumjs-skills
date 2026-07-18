"""Adapters for invoking a visual judge LLM.

This module MUST NOT import anything from ``optimization/`` (enforced by
``evaluation/scripts/validate-evaluation.py``). It depends only on the neutral
:mod:`harness` package -- the shared, single source of truth for driving the
``opencode`` and ``codex`` CLIs -- plus the judge-specific model policy below.
"""

from __future__ import annotations

import os
from typing import Callable, Protocol, Union, runtime_checkable

from harness import (
    codex_fallback_model,
    invoke_codex,
    invoke_opencode,
    latest_default_frontier_model,
    model_supports_vision,
    vision_fallback_enabled,
)
from harness.models import (
    DEFAULT_CODEX_MODEL,
    DEFAULT_CODEX_REASONING_EFFORT,
    DEFAULT_MODEL as DEFAULT_OPENCODE_JUDGE_MODEL,
    LOW_VARIANT as _LOW_VARIANT,
)
from harness.selection import default_harness

DEFAULT_OPENCODE_JUDGE_VARIANT = _LOW_VARIANT


def default_judge_harness() -> str:
    return default_harness("judge")


def default_judge_model() -> str:
    if default_judge_harness() == "codex":
        for name in ("CODEX_JUDGE_MODEL", "CODEX_MODEL", "JUDGE_MODEL", "AGENT_MODEL"):
            value = os.environ.get(name)
            if value:
                return value
        return DEFAULT_CODEX_MODEL
    for name in ("OPENCODE_JUDGE_MODEL", "OPENCODE_MODEL"):
        value = os.environ.get(name)
        if value:
            if value.strip().lower() == "auto":
                break
            return value
    return latest_default_frontier_model() or DEFAULT_OPENCODE_JUDGE_MODEL


def default_judge_variant() -> str:
    for name in ("OPENCODE_JUDGE_VARIANT", "OPENCODE_VARIANT"):
        value = os.environ.get(name)
        if value:
            return value
    return DEFAULT_OPENCODE_JUDGE_VARIANT


def _resolve_judge_model(model: str | None) -> str:
    if model and model.strip().lower() != "auto":
        return model
    return default_judge_model()


def _split_opencode_model_variant(model: str | None, fallback_variant: str) -> tuple[str | None, str]:
    """Normalize requested shorthand model ids into OpenCode model + variant.

    OpenCode exposes ``openai/gpt-5.5`` as the model and controls reasoning
    depth through ``--variant``. The eval workflow still accepts the explicit
    user-facing shorthands ``openai/gpt-5.5-med`` and ``openai/gpt-5.5-high`` so
    callers can be clear about which depth they intend.
    """
    if not model:
        return None, fallback_variant
    aliases = {
        "openai/gpt-5.5-med": ("openai/gpt-5.5", "medium"),
        "openai/gpt-5.5-medium": ("openai/gpt-5.5", "medium"),
        "openai/gpt-5.5-high": ("openai/gpt-5.5", "high"),
    }
    normalized = model.strip().lower()
    if normalized in aliases:
        return aliases[normalized]
    return model, fallback_variant


def _resolve_codex_judge_model(model: str | None) -> str | None:
    """Resolve an explicit codex model override, or None to defer to the CLI.

    ``model="auto"`` (or an ``auto``-valued env var) is a deliberate request to
    use codex's own configured default rather than this pipeline's default --
    distinct from "nothing configured," which ``default_judge_model()``
    already resolves to :data:`DEFAULT_CODEX_MODEL` before this function ever
    runs in the normal flow.
    """
    if model and model.strip().lower() != "auto":
        return model
    for name in ("CODEX_JUDGE_MODEL", "CODEX_MODEL", "JUDGE_MODEL", "AGENT_MODEL"):
        value = os.environ.get(name)
        if value and value.strip().lower() != "auto":
            return value
    return None


def _resolve_codex_judge_variant() -> str:
    for name in ("CODEX_JUDGE_VARIANT", "CODEX_VARIANT"):
        value = os.environ.get(name)
        if value and value.strip().lower() != "auto":
            return value
    return DEFAULT_CODEX_REASONING_EFFORT


@runtime_checkable
class Adapter(Protocol):
    """An LLM adapter the static judge can call.

    Implementations take a fully-rendered prompt plus any directories the judge
    is explicitly allowed to read and return the raw text response, which the
    judge then parses as JSON.
    """

    def run(
        self,
        prompt: str,
        model: str | None,
        add_dirs: list[str],
        allowed_tools: list[str],
        files: list[str] | None = None,
    ) -> str:
        ...


class OpenCodeCliAdapter:
    """Judge adapter that drives ``opencode`` via the shared harness.

    Image-bearing calls whose model lacks vision (Copilot) are re-routed to the
    codex (ChatGPT subscription) harness, since Copilot has no vision endpoint.
    """

    def __init__(self, binary: str = "opencode", timeout_s: int = 600) -> None:
        self.binary = binary
        self.timeout_s = timeout_s

    def run(
        self,
        prompt: str,
        model: str | None,
        add_dirs: list[str],
        allowed_tools: list[str],
        files: list[str] | None = None,
    ) -> str:
        model_id, variant = _split_opencode_model_variant(
            _resolve_judge_model(model),
            default_judge_variant(),
        )

        if files and vision_fallback_enabled() and not model_supports_vision(model_id):
            return CodexCliAdapter(timeout_s=self.timeout_s).run(
                prompt,
                codex_fallback_model(model_id),
                add_dirs,
                allowed_tools,
                files,
            )

        return invoke_opencode(
            prompt,
            model=model_id,
            variant=variant,
            files=files,
            add_dirs=add_dirs,
            allowed_tools=allowed_tools,
            timeout_seconds=self.timeout_s,
        )


class CodexCliAdapter:
    """Judge adapter that drives ``codex exec`` via the shared harness."""

    def __init__(self, binary: str = "codex", timeout_s: int = 600) -> None:
        self.binary = binary
        self.timeout_s = timeout_s

    def run(
        self,
        prompt: str,
        model: str | None,
        add_dirs: list[str],
        allowed_tools: list[str],
        files: list[str] | None = None,
    ) -> str:
        return invoke_codex(
            prompt,
            model=_resolve_codex_judge_model(model),
            reasoning_effort=_resolve_codex_judge_variant(),
            files=files,
            add_dirs=add_dirs,
            allowed_tools=allowed_tools,
            timeout_seconds=self.timeout_s,
        )


class FakeAdapter:
    """Test adapter returning canned responses.

    ``canned`` may be:
      * a ``str`` returned for every call;
      * a ``dict`` keyed by the lens substring or seed (matched against the
        prompt text), falling back to a ``"default"`` key or the first value;
      * a ``callable(prompt, model, add_dirs, allowed_tools, files) -> str``.
    """

    def __init__(self, canned: Union[str, dict, Callable[..., str]]) -> None:
        self.canned = canned
        self.calls: list[dict] = []

    def run(
        self,
        prompt: str,
        model: str | None,
        add_dirs: list[str],
        allowed_tools: list[str],
        files: list[str] | None = None,
    ) -> str:
        self.calls.append(
            {
                "prompt": prompt,
                "model": model,
                "add_dirs": list(add_dirs),
                "allowed_tools": list(allowed_tools),
                "files": list(files or []),
            }
        )
        canned = self.canned
        if callable(canned):
            try:
                return canned(prompt, model, add_dirs, allowed_tools, files or [])
            except TypeError:
                return canned(prompt, model, add_dirs, allowed_tools)
        if isinstance(canned, dict):
            for key, value in canned.items():
                if key != "default" and str(key) in prompt:
                    return value
            if "default" in canned:
                return canned["default"]
            return next(iter(canned.values()))
        return str(canned)
