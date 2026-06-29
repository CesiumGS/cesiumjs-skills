"""Subprocess wrapper around the `opencode` CLI for non-interactive runs."""

from __future__ import annotations

import json
import os
import subprocess
import shutil
from pathlib import Path
from typing import Any, Sequence

from harness._prompt import format_prompt
from harness.env import clean_subprocess_env


class OpenCodeCLINotFoundError(RuntimeError):
    """Raised when the `opencode` executable is not on PATH."""


class OpenCodeCLIError(RuntimeError):
    """Raised when the `opencode` CLI exits non-zero or returns no text."""

    def __init__(self, returncode: int, stderr: str, stdout: str) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout
        detail = (stderr or stdout).strip()[:2000]
        super().__init__(f"opencode CLI exited with code {returncode}: {detail}")


_TOOL_PERMISSION_NAMES = {
    "Read": "read",
    "Grep": "grep",
    "Glob": "glob",
    "Bash": "bash",
    "Edit": "edit",
    "Write": "edit",
    "Skill": "skill",
}


def _find_opencode_executable() -> str:
    path = shutil.which("opencode")
    if not path:
        raise OpenCodeCLINotFoundError(
            "`opencode` CLI not found on PATH. Install OpenCode and authenticate "
            "the provider account before running evaluations."
        )
    return path


def _permission_env(
    *,
    add_dirs: Sequence[str | Path] | None,
    allowed_tools: Sequence[str] | None,
    disable_tools: bool,
) -> str | None:
    if disable_tools:
        return json.dumps({"*": "deny"})
    if allowed_tools is None:
        return None

    permission: dict[str, Any] = {"*": "deny"}
    for tool in allowed_tools:
        permission[_TOOL_PERMISSION_NAMES.get(tool, tool).lower()] = "allow"

    if add_dirs:
        external: dict[str, str] = {"*": "deny"}
        for item in add_dirs:
            path = str(Path(item).resolve())
            external[path] = "allow"
            external[f"{path}/*"] = "allow"
            external[f"{path}/**"] = "allow"
        permission["external_directory"] = external

    return json.dumps(permission, sort_keys=True)


def _extract_text_from_json_events(stdout: str) -> str:
    text_parts: list[str] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "text":
            continue
        part = event.get("part")
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text = part["text"].strip()
            if text:
                text_parts.append(text)
    return "\n".join(text_parts).strip()


def invoke_opencode(
    prompt: str,
    *,
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
    """Invoke `opencode run --format json` and return the assistant text."""

    opencode = _find_opencode_executable()
    workdir = Path(cwd or os.getcwd()).resolve()

    cmd: list[str] = [
        opencode,
        "run",
        "--format",
        "json",
        "--dir",
        str(workdir),
    ]
    if model:
        cmd.extend(["--model", model])
    if agent:
        cmd.extend(["--agent", agent])
    if variant:
        cmd.extend(["--variant", variant])
    if files:
        for file_path in files:
            cmd.extend(["--file", str(Path(file_path).resolve())])
    if title:
        cmd.extend(["--title", title])

    env = clean_subprocess_env()
    permission = _permission_env(
        add_dirs=add_dirs,
        allowed_tools=allowed_tools,
        disable_tools=disable_tools,
    )
    if permission is not None:
        env["OPENCODE_PERMISSION"] = permission

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
    except subprocess.TimeoutExpired:
        raise

    if result.returncode != 0:
        raise OpenCodeCLIError(result.returncode, result.stderr, result.stdout)

    text = _extract_text_from_json_events(result.stdout)
    if not text:
        raise OpenCodeCLIError(
            result.returncode,
            result.stderr,
            result.stdout or "opencode returned no assistant text",
        )
    return text


def ensure_cli_available() -> str:
    """Return the path to `opencode`, raising if missing."""

    return _find_opencode_executable()
