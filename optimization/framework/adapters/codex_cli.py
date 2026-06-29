"""Codex CLI access for the optimization pipeline.

The subprocess mechanics and Copilot routing live in the neutral
:mod:`harness.codex` package (shared with the evaluation pipeline). This module
re-exports that surface so existing callers keep importing from
``optimization.framework.adapters.codex_cli``.
"""

from __future__ import annotations

from harness.codex import (  # noqa: F401  (re-exported public surface)
    CodexCLIError,
    CodexCLINotFoundError,
    ensure_cli_available,
    invoke_codex,
)
from harness.copilot import (  # noqa: F401  (re-exported)
    COPILOT_PROFILE,
    read_copilot_gho_token as _read_copilot_gho_token,
)
from harness.env import clean_subprocess_env as _clean_subprocess_env  # noqa: F401
