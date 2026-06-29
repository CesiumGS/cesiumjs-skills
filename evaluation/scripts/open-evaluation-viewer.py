#!/usr/bin/env python3
"""Open the Skill Evaluation Console (apps/evaluation-console).

Usage:
    python3 evaluation/scripts/open-evaluation-viewer.py [scorecard.json] [--open] [--port N] [--state-dir DIR]

If no scorecard path is given, the newest scorecard under
evaluation/artifacts/{audits,scorecards}/ is opened.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER = REPO_ROOT / "apps" / "evaluation-console" / "server.py"
RUN_DIRS = [
    REPO_ROOT / "evaluation" / "artifacts" / "audits",
    REPO_ROOT / "evaluation" / "artifacts" / "scorecards",
]


def newest_scorecard() -> Path | None:
    candidates = []
    for base in RUN_DIRS:
        if base.is_dir():
            candidates.extend(base.glob("*/scorecard.json"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


VALUE_FLAGS = {"--state-dir", "--host", "--port"}


def has_positional(args: list[str]) -> bool:
    i = 0
    while i < len(args):
        a = args[i]
        if a in VALUE_FLAGS:
            i += 2
            continue
        if a.startswith("-"):
            i += 1
            continue
        return True
    return False


def main() -> int:
    args = sys.argv[1:]
    if not has_positional(args):
        sc = newest_scorecard()
        if sc is None:
            print("No scorecard found under evaluation/artifacts/{audits,scorecards}/.", file=sys.stderr)
            return 1
        print(f"No scorecard given; opening newest: {sc.relative_to(REPO_ROOT)}")
        args = [str(sc), *args]
    if not any(arg == "--port" for arg in args):
        args = [*args, "--port", "8933"]
    sys.argv = [str(SERVER), *args]
    runpy.run_path(str(SERVER), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
