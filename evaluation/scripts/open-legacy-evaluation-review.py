#!/usr/bin/env python3
"""Open the legacy evaluation-review UI (cesiumjs-skills-legacy-uis/evaluation-review).

Usage:
    python3 evaluation/scripts/open-legacy-evaluation-review.py [scorecard.json] [--open] [--port N] [--state-dir DIR]
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LEGACY_UIS_ROOT = REPO_ROOT.parent / "cesiumjs-skills-legacy-uis"
SERVER = LEGACY_UIS_ROOT / "evaluation-review" / "server.py"
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
    if not SERVER.is_file():
        print(
            f"Legacy evaluation-review not found at {SERVER}. "
            "Expected sibling checkout: ../cesiumjs-skills-legacy-uis/evaluation-review",
            file=sys.stderr,
        )
        return 1

    args = sys.argv[1:]
    if not has_positional(args):
        sc = newest_scorecard()
        if sc is None:
            print("No scorecard found under evaluation/artifacts/{audits,scorecards}/.", file=sys.stderr)
            return 1
        print(f"No scorecard given; opening newest: {sc.relative_to(REPO_ROOT)}")
        args = [str(sc), *args]

    sys.argv = [str(SERVER), *args]
    runpy.run_path(str(SERVER), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
