"""Subprocess environment hardening shared by every harness CLI call."""

from __future__ import annotations

import os

# The OpenAI API key must never be used for billing: strip it from every CLI
# subprocess env so opencode/codex fall back to their subscription oauth
# credentials even when a stale shell still exports the key.
DISALLOWED_ENV_VARS = ("OPENAI_API_KEY",)


def clean_subprocess_env() -> dict[str, str]:
    """Return a copy of the process env with disallowed secrets removed."""

    env = os.environ.copy()
    for name in DISALLOWED_ENV_VARS:
        env.pop(name, None)
    return env
