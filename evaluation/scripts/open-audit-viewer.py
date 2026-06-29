#!/usr/bin/env python3
"""Open the legacy audit-viewer UI (cesiumjs-skills-legacy-uis/audit-viewer).

Usage:
    python3 evaluation/scripts/open-audit-viewer.py [scorecard.json] [--open] [--port N] [--state-dir DIR]
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LEGACY_UIS_ROOT = REPO_ROOT.parent / "cesiumjs-skills-legacy-uis"
SERVER = LEGACY_UIS_ROOT / "audit-viewer" / "server.py"


def main() -> int:
    if not SERVER.is_file():
        print(
            f"Legacy audit-viewer not found at {SERVER}. "
            "Expected sibling checkout: ../cesiumjs-skills-legacy-uis/audit-viewer",
            file=sys.stderr,
        )
        return 1
    sys.argv = [str(SERVER), *sys.argv[1:]]
    runpy.run_path(str(SERVER), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
