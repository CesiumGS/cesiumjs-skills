"""Default model selection, discovery, and vision-fallback policy.

Text work runs on the Copilot subscription (``github-copilot/gpt-5.5``).
Copilot's multimodal endpoint is disabled account-wide, so any image-bearing
opencode call is re-routed to the codex (ChatGPT subscription) harness with the
same model, by ``codex_fallback_model``.
"""

from __future__ import annotations

import os
import shutil
import subprocess

from harness.env import clean_subprocess_env

DEFAULT_PROVIDER = "github-copilot"

# Concrete fallback for offline/test contexts. Normal runtime selection asks
# OpenCode for the currently exposed Copilot models and uses GPT-5.5 when
# available.
DEFAULT_MODEL = "github-copilot/gpt-5.5"
HIGH_VARIANT = "high"
MEDIUM_VARIANT = "medium"

_LATEST_MODEL_CACHE: dict[str, str | None] = {}

# Vision fallback knobs.
_VISION_FALLBACK_DISABLED = {"0", "off", "false", "no"}


def latest_default_gpt55_model() -> str | None:
    """Discover the latest exposed ``<provider>/gpt-5.5`` model, or None."""

    family = "gpt-5.5"
    cached = _LATEST_MODEL_CACHE.get(family)
    if family in _LATEST_MODEL_CACHE:
        return cached

    opencode = shutil.which("opencode")
    if not opencode:
        return None

    try:
        result = subprocess.run(
            [opencode, "models", DEFAULT_PROVIDER],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
            env=clean_subprocess_env(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    candidates: list[str] = []
    for raw_line in result.stdout.splitlines():
        model = raw_line.strip()
        if model == DEFAULT_MODEL:
            _LATEST_MODEL_CACHE[family] = model
            return model
        if model.startswith(f"{DEFAULT_PROVIDER}/gpt-5.5"):
            candidates.append(model)

    latest = next((model for model in candidates if not model.endswith(("-fast", "-pro"))), None)
    if latest:
        _LATEST_MODEL_CACHE[family] = latest
    return latest


def vision_fallback_enabled() -> bool:
    """Whether image-bearing opencode calls may re-route to codex."""

    value = os.environ.get("AGENT_VISION_FALLBACK", "").strip().lower()
    return value not in _VISION_FALLBACK_DISABLED


def model_supports_vision(model: str | None) -> bool:
    """Whether an opencode model id can accept image inputs on this account.

    Copilot's multimodal endpoint is disabled account-wide, so every
    ``github-copilot/*`` model rejects images. The default openai-oauth path
    (``openai/gpt-5.5``) and others are assumed vision-capable.
    """

    if not model:
        return True
    return not model.strip().lower().startswith("github-copilot/")


def codex_fallback_model(opencode_model: str | None) -> str | None:
    """Map an opencode model to its codex equivalent, preserving the model.

    ``github-copilot/gpt-5.5`` -> ``gpt-5.5``; an explicit override wins.
    """

    override = (
        os.environ.get("AGENT_VISION_FALLBACK_MODEL")
        or os.environ.get("CODEX_VISION_FALLBACK_MODEL")
    )
    if override and override.strip():
        return override.strip()
    if opencode_model and "/" in opencode_model:
        return opencode_model.split("/", 1)[1]
    return opencode_model
