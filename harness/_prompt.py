"""Shared prompt formatting for non-interactive harness CLI runs."""

from __future__ import annotations


def format_prompt(prompt: str, system: str | None) -> str:
    """Wrap a system instruction + task into a single stdin prompt."""

    if not system:
        return prompt
    return (
        "Follow these system-level instructions for this automated evaluation run.\n\n"
        "<system_instructions>\n"
        f"{system.strip()}\n"
        "</system_instructions>\n\n"
        "<task>\n"
        f"{prompt.strip()}\n"
        "</task>"
    )
