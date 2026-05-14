#!/usr/bin/env python3
"""Scan public-facing docs and eval artifacts for private or unsafe references."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCANNED_ROOTS = [
    ".architecture",
    "wiki",
    "evals",
    "README.md",
    ".github/workflows",
]
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
PATTERNS = {
    "gist URL": re.compile(r"https?://gist\.github\.com/", re.I),
    "local filesystem path": re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    "localhost trace URL": re.compile(r"https?://(?:127\.0\.0\.1|localhost):[0-9]+/"),
    "Cesium token assignment": re.compile(r"Cesium\.Ion\.defaultAccessToken\s*=\s*['\"][A-Za-z0-9._-]{40,}['\"]"),
    "URL access token": re.compile(r"access_token=eyJ[A-Za-z0-9._-]{20,}"),
    "private-source marker": re.compile(
        r"\b(?:DO NOT DISTRIBUTE|proprietary and internal|SharePoint|dev\.azure)\b",
        re.I,
    ),
}


def iter_files() -> list[Path]:
    files: list[Path] = []
    for root in SCANNED_ROOTS:
        path = REPO_ROOT / root
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(p for p in path.rglob("*") if p.is_file())
    return sorted(set(files))


def main() -> None:
    hits: list[str] = []
    for path in iter_files():
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        rel = path.relative_to(REPO_ROOT)
        for line_number, line in enumerate(text.splitlines(), 1):
            for label, pattern in PATTERNS.items():
                if pattern.search(line):
                    hits.append(f"{rel}:{line_number}: {label}")

    if hits:
        print("[check-public-artifacts] FAIL: public-safety scan matched:")
        for hit in hits:
            print(f"  {hit}")
        raise SystemExit(1)

    print(f"[check-public-artifacts] OK: scanned {len(iter_files())} files")


if __name__ == "__main__":
    main()
