#!/usr/bin/env python3
"""Summarize deterministic scorecard failures for local optimization focus."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from optimization.framework.scorecard_focus import build_focus, focus_to_decision, focus_to_markdown  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scorecard", help="Path to evaluation scorecard JSON")
    parser.add_argument("--format", choices=["json", "markdown", "decision"], default="json")
    parser.add_argument("--skill", help="Restrict decision output to one skill")
    parser.add_argument("--output", help="Optional path to write the focus summary")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    scorecard_path = Path(args.scorecard)
    scorecard = json.loads(scorecard_path.read_text())
    focus = build_focus(scorecard)
    if args.format == "markdown":
        payload = focus_to_markdown(focus)
    elif args.format == "decision":
        payload = json.dumps(focus_to_decision(focus, skill=args.skill), indent=2, sort_keys=True) + "\n"
    else:
        payload = json.dumps(focus, indent=2, sort_keys=True) + "\n"

    if args.output:
        Path(args.output).write_text(payload)
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
