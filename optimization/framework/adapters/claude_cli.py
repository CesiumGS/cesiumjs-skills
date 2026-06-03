"""Subprocess wrapper around the `claude` CLI for non-interactive invocations.

All Claude calls in this framework go through this module so that evaluations
never depend on a personal Anthropic API key. The CLI handles authentication
itself (OAuth, Bedrock, etc.) and is the user's chosen, audited entry point.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Sequence

# Extended-thinking budget for every eval call. "High reasoning" for Opus 4.7;
# users can override per-process with MAX_THINKING_TOKENS in the environment.
_DEFAULT_MAX_THINKING_TOKENS = "31999"


class ClaudeCLINotFoundError(RuntimeError):
    """Raised when the `claude` executable is not on PATH."""


class ClaudeCLIError(RuntimeError):
    """Raised when the `claude` CLI exits non-zero."""

    def __init__(self, returncode: int, stderr: str, stdout: str) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout
        super().__init__(
            f"claude CLI exited with code {returncode}: {stderr.strip() or stdout.strip()[:200]}"
        )


def _find_claude_executable() -> str:
    path = shutil.which("claude")
    if not path:
        raise ClaudeCLINotFoundError(
            "`claude` CLI not found on PATH. Install Claude Code (https://claude.com/claude-code) "
            "or ensure the executable is on PATH before running evaluations."
        )
    return path


def invoke_claude(
    prompt: str,
    *,
    system: str | None = None,
    model: str = "claude-opus-4-7",
    add_dirs: Sequence[str | Path] | None = None,
    allowed_tools: Sequence[str] | None = None,
    disable_tools: bool = False,
    max_budget_usd: float | None = None,
    timeout_seconds: int = 600,
) -> str:
    """Invoke `claude -p` and return the textual response.

    Args:
        prompt: The user prompt content.
        system: Optional system prompt prepended to the default. Use to inject
            skill content, judge persona, etc.
        model: Model alias ("sonnet", "opus", "haiku") or full ID
            (e.g. "claude-sonnet-4-6", "claude-opus-4-7"). The CLI resolves
            aliases to the latest available version.
        add_dirs: Extra filesystem directories to grant the CLI read access to.
            Required when the prompt asks the agent to read evidence files
            (screenshots, JSON bundles) outside the cwd.
        allowed_tools: Tools to enable in non-interactive mode (e.g. ["Read"]).
            When None, defaults to text-only (no tools).
        disable_tools: If True, forces an empty tool set (no tools at all).
            Takes precedence over `allowed_tools`.
        max_budget_usd: Optional spend cap forwarded to --max-budget-usd.
        timeout_seconds: Subprocess timeout. Defaults to 10 minutes.

    Returns:
        The CLI's stdout as a stripped string (the assistant's text response).

    Raises:
        ClaudeCLINotFoundError: If `claude` is not on PATH.
        ClaudeCLIError: If the CLI exits non-zero.
        subprocess.TimeoutExpired: If the call exceeds `timeout_seconds`.
    """
    claude = _find_claude_executable()

    # Prompt is piped via stdin so positional argument parsing isn't fragile
    # against neighbours like --tools "" (nargs+) which can otherwise consume it.
    cmd: list[str] = [
        claude,
        "-p",
        "--output-format",
        "text",
        "--model",
        model,
        # Eval runs are unattended; allow the CLI to act without prompting.
        "--dangerously-skip-permissions",
        # Hermetic MCP surface: ignore any user/project MCP config and provide
        # an empty server set. Third-party MCP tool schemas (oneOf/allOf at
        # top level) otherwise fail Anthropic API schema validation.
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        # Keep only the built-in setting sources we trust for evals.
        "--setting-sources",
        "user",
    ]

    if system:
        cmd.extend(["--append-system-prompt", system])

    if max_budget_usd is not None:
        cmd.extend(["--max-budget-usd", str(max_budget_usd)])

    # --add-dir and --tools are nargs+, so put them LAST and ensure the next
    # positional flag is one we accept as a fixed-arity option (none follow).
    if add_dirs:
        cmd.append("--add-dir")
        for d in add_dirs:
            cmd.append(str(d))

    if disable_tools:
        cmd.extend(["--tools", ""])
    elif allowed_tools is not None:
        cmd.extend(["--tools", ",".join(allowed_tools)])
    # When neither disable_tools nor allowed_tools is set, omit --tools entirely
    # and let the CLI use defaults; we'll pass the prompt via stdin.

    env = os.environ.copy()
    env.setdefault("MAX_THINKING_TOKENS", _DEFAULT_MAX_THINKING_TOKENS)

    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        raise

    if result.returncode != 0:
        raise ClaudeCLIError(result.returncode, result.stderr, result.stdout)

    return result.stdout.strip()


def ensure_cli_available() -> str:
    """Return the path to `claude`, raising ClaudeCLINotFoundError if missing.

    Use this as a fail-fast precondition in scripts that need the CLI.
    """
    return _find_claude_executable()
