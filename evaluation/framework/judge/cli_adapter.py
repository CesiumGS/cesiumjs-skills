"""Self-contained adapters for invoking a visual judge LLM.

This module MUST NOT import anything from ``optimization/``. The evaluation
boundary (enforced by ``evaluation/scripts/validate-evaluation.py``) keeps the
qualitative judge a self-contained subprocess client. Everything here talks to
an external CLI via ``subprocess`` only, or returns canned data for tests.
"""

from __future__ import annotations

import subprocess
from typing import Callable, Protocol, Union, runtime_checkable


@runtime_checkable
class Adapter(Protocol):
    """An LLM adapter the static judge can call.

    Implementations take a fully-rendered prompt plus the directories the judge
    is allowed to read (the bundle holding the screenshots) and return the raw
    text response, which the judge then parses as JSON.
    """

    def run(
        self,
        prompt: str,
        model: str,
        add_dirs: list[str],
        allowed_tools: list[str],
    ) -> str:
        ...


class ClaudeCliAdapter:
    """Default adapter that shells out to the ``claude`` CLI.

    Invokes (model may be a short alias such as ``"sonnet"``)::

        claude -p <prompt> --output-format text --model <model>
               --dangerously-skip-permissions --strict-mcp-config
               --mcp-config {} --add-dir <bundle> --tools Read
    """

    def __init__(self, binary: str = "claude", timeout_s: int = 600) -> None:
        self.binary = binary
        self.timeout_s = timeout_s

    def run(
        self,
        prompt: str,
        model: str,
        add_dirs: list[str],
        allowed_tools: list[str],
    ) -> str:
        # Mirror the proven optimization claude-CLI invocation: prompt via STDIN
        # (not argv), a VALID empty MCP record, trusted setting source, and the
        # nargs+ --add-dir/--tools placed LAST.
        cmd: list[str] = [
            self.binary,
            "-p",
            "--output-format",
            "text",
            "--model",
            model,
            "--dangerously-skip-permissions",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--setting-sources",
            "user",
        ]
        if add_dirs:
            cmd.append("--add-dir")
            cmd.extend(str(d) for d in add_dirs)
        cmd += ["--tools", ",".join(allowed_tools) if allowed_tools else "Read"]

        completed = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=self.timeout_s,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"claude CLI exited {completed.returncode}: "
                f"{(completed.stderr or completed.stdout or '').strip()[:2000]}"
            )
        return completed.stdout


class FakeAdapter:
    """Test adapter returning canned responses.

    ``canned`` may be:
      * a ``str`` returned for every call;
      * a ``dict`` keyed by the lens substring or seed (matched against the
        prompt text), falling back to a ``"default"`` key or the first value;
      * a ``callable(prompt, model, add_dirs, allowed_tools) -> str``.
    """

    def __init__(self, canned: Union[str, dict, Callable[..., str]]) -> None:
        self.canned = canned
        self.calls: list[dict] = []

    def run(
        self,
        prompt: str,
        model: str,
        add_dirs: list[str],
        allowed_tools: list[str],
    ) -> str:
        self.calls.append(
            {
                "prompt": prompt,
                "model": model,
                "add_dirs": list(add_dirs),
                "allowed_tools": list(allowed_tools),
            }
        )
        canned = self.canned
        if callable(canned):
            return canned(prompt, model, add_dirs, allowed_tools)
        if isinstance(canned, dict):
            for key, value in canned.items():
                if key != "default" and str(key) in prompt:
                    return value
            if "default" in canned:
                return canned["default"]
            return next(iter(canned.values()))
        return str(canned)
