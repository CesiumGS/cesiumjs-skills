"""GitHub Copilot subscription routing for the codex harness.

Copilot is reached by sending the long-lived GitHub OAuth token opencode stores
directly as a Bearer to ``api.githubcopilot.com`` -- no token exchange. The
``codex`` ``copilot`` profile (``~/.codex/copilot.config.toml``) reads that token
from the ``COPILOT_GHO_TOKEN`` env var, which the codex wrapper injects at call
time. Copilot's multimodal endpoint is disabled for this account, so the profile
is TEXT-ONLY; image work must use the default (ChatGPT subscription) profile.
"""

from __future__ import annotations

import json
from pathlib import Path

COPILOT_PROFILE = "copilot"
COPILOT_TOKEN_ENV = "COPILOT_GHO_TOKEN"
OPENCODE_AUTH_PATH = Path.home() / ".local" / "share" / "opencode" / "auth.json"


def read_copilot_gho_token() -> str | None:
    """Return the GitHub OAuth token (with Copilot access) opencode stores."""

    try:
        data = json.loads(OPENCODE_AUTH_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    cred = data.get("github-copilot")
    if not isinstance(cred, dict):
        return None
    token = cred.get("refresh") or cred.get("access")
    return token if isinstance(token, str) and token else None
