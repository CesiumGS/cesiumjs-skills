"""Subprocess wrapper around the `codex` CLI for non-interactive runs."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence

from harness._prompt import format_prompt
from harness.copilot import COPILOT_PROFILE, COPILOT_TOKEN_ENV, OPENCODE_AUTH_PATH, read_copilot_gho_token
from harness.env import clean_subprocess_env


class CodexCLINotFoundError(RuntimeError):
    """Raised when the `codex` executable is not on PATH."""


class CodexCLIError(RuntimeError):
    """Raised when the `codex` CLI exits non-zero or returns no text."""

    def __init__(self, returncode: int, stderr: str, stdout: str) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout
        detail = _summarize_process_output(stderr=stderr, stdout=stdout)
        super().__init__(f"codex CLI exited with code {returncode}: {detail}")


def _truncate_middle(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    head_len = limit // 2
    tail_len = limit - head_len
    return f"{text[:head_len].rstrip()}\n...[truncated]...\n{text[-tail_len:].lstrip()}"


def _summarize_process_output(*, stderr: str, stdout: str) -> str:
    streams = []
    if stderr.strip():
        streams.append("stderr:\n" + stderr.strip())
    if stdout.strip():
        streams.append("stdout:\n" + stdout.strip())
    if not streams:
        return "<no output>"
    return _truncate_middle("\n\n".join(streams))


def _find_codex_executable() -> str:
    path = shutil.which("codex")
    if not path:
        raise CodexCLINotFoundError(
            "`codex` CLI not found on PATH. Install Codex CLI and authenticate "
            "before running evaluations with the codex harness."
        )
    return path


def invoke_codex(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    profile: str | None = None,
    files: Sequence[str | Path] | None = None,
    cwd: str | Path | None = None,
    add_dirs: Sequence[str | Path] | None = None,
    allowed_tools: Sequence[str] | None = None,
    disable_tools: bool = False,
    timeout_seconds: int = 600,
) -> str:
    """Invoke `codex exec` and return the final assistant message text.

    ``profile`` layers ``~/.codex/<profile>.config.toml`` over the base config.
    The ``copilot`` profile bills text work to the GitHub Copilot subscription;
    its bearer token is injected automatically from opencode's stored credential.
    """

    codex = _find_codex_executable()
    workdir = Path(cwd or os.getcwd()).resolve()

    with tempfile.NamedTemporaryFile(prefix="cesiumjs-codex-last-", delete=False) as handle:
        output_path = Path(handle.name)

    cmd: list[str] = [
        codex,
        "exec",
        "--json",
        "--sandbox",
        "read-only",
        "--cd",
        str(workdir),
        "--output-last-message",
        str(output_path),
    ]
    if profile:
        cmd.extend(["-p", profile])
    if model:
        cmd.extend(["--model", model])
    for item in add_dirs or []:
        cmd.extend(["--add-dir", str(Path(item).resolve())])
    for file_path in files or []:
        cmd.extend(["--image", str(Path(file_path).resolve())])
    if disable_tools:
        cmd.extend(["--ignore-rules"])
    # Codex CLI does not expose a direct tool allow-list for exec. Keep this
    # argument in the wrapper signature so callers can share one harness API.
    _ = allowed_tools
    cmd.append("-")

    env = clean_subprocess_env()
    if profile == COPILOT_PROFILE and COPILOT_TOKEN_ENV not in env:
        token = read_copilot_gho_token()
        if not token:
            raise CodexCLIError(
                1,
                "codex 'copilot' profile requested but no GitHub Copilot token "
                f"was found in {OPENCODE_AUTH_PATH}. Authenticate Copilot in "
                "opencode (`opencode auth login` -> GitHub Copilot) first.",
                "",
            )
        env[COPILOT_TOKEN_ENV] = token

    try:
        result = subprocess.run(
            cmd,
            input=format_prompt(prompt, system),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
            cwd=workdir,
            env=env,
        )
        try:
            text = output_path.read_text(encoding="utf-8").strip()
        except OSError:
            text = ""
    finally:
        try:
            output_path.unlink()
        except OSError:
            pass

    if result.returncode != 0:
        raise CodexCLIError(result.returncode, result.stderr, result.stdout)
    if not text:
        raise CodexCLIError(
            result.returncode,
            result.stderr,
            result.stdout or "codex returned no final assistant message",
        )
    return text


def ensure_cli_available() -> str:
    """Return the path to `codex`, raising if missing."""

    return _find_codex_executable()
