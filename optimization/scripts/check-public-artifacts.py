#!/usr/bin/env python3
"""Scan public-facing docs and eval artifacts for private or unsafe references.

Public-Safety Scanner Configuration
====================================
This script scans tracked files under optimization/, evaluation/, wiki/,
.architecture/, .github/workflows/, docs/, and README.md for patterns
that must never appear in public commits.
Unit tests under optimization/tests/ are skipped because they contain intentional
negative fixtures for token and path detection.

Configurable Pattern List (PATTERNS dict, line ~50):
- Ion token patterns: Cesium.Ion.defaultAccessToken assignments, access_token= URLs
- Absolute filesystem paths: /Users/, /home/ (Linux/Mac)
- Email addresses: Common email patterns
- Private-source markers: "DO NOT DISTRIBUTE", "proprietary", SharePoint, dev.azure
- Private URLs: localhost, 127.0.0.1, gist.github.com

To add new patterns: Edit the PATTERNS dict below with a descriptive key and compiled regex.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCANNED_ROOTS = [
    ".architecture",
    "docs",
    "wiki",
    "optimization",
    "evaluation",
    "README.md",
    ".github/workflows",
]
SKIP_FILES = {
    "optimization/scripts/check-public-artifacts.py",
}
SKIP_PREFIXES = {
    "optimization/tests/",
}
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# Configurable pattern list - add new sensitive patterns here:
PATTERNS = {
    "gist URL": re.compile(r"https?://gist\.github\.com/", re.I),
    "local filesystem path (macOS)": re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    "local filesystem path (Linux)": re.compile(r"/home/[A-Za-z0-9._-]+/"),
    "email address": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"),
    "localhost trace URL": re.compile(r"https?://(?:127\.0\.0\.1|localhost):[0-9]+/"),
    "Cesium token assignment": re.compile(r"Cesium\.Ion\.defaultAccessToken\s*=\s*['\"][A-Za-z0-9._-]{40,}['\"]"),
    "URL access token": re.compile(r"access_token=eyJ[A-Za-z0-9._-]{20,}"),
    "private-source marker": re.compile(
        r"\b(?:DO NOT DISTRIBUTE|proprietary and internal|SharePoint|dev\.azure)\b",
        re.I,
    ),
}


def git_ls_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def is_scanned_relpath(rel_path: str) -> bool:
    for root in SCANNED_ROOTS:
        if rel_path == root or rel_path.startswith(f"{root}/"):
            return True
    return False


def iter_files() -> list[Path]:
    files = [
        REPO_ROOT / rel_path
        for rel_path in git_ls_files()
        if (
            is_scanned_relpath(rel_path)
            and not any(rel_path.startswith(prefix) for prefix in SKIP_PREFIXES)
            and (REPO_ROOT / rel_path).is_file()
        )
    ]
    return sorted(files)


# Allowed public email patterns (CI bots, no-reply addresses, etc.)
ALLOWED_EMAILS = {
    re.compile(r"^actions@github\.com$"),
    re.compile(r"^noreply@github\.com$"),
    re.compile(r"^.*@users\.noreply\.github\.com$"),
}


def is_allowed_email(email: str) -> bool:
    """Check if email is a known public/bot email that's safe to commit."""
    return any(pattern.match(email) for pattern in ALLOWED_EMAILS)


def _resolve_target_files(argv: list[str]) -> list[Path]:
    """If file paths are passed as argv, scan only those; else fall back to SCANNED_ROOTS."""
    if not argv:
        return iter_files()
    targets: list[Path] = []
    for raw in argv:
        path = Path(raw)
        if not path.is_absolute():
            path = REPO_ROOT / path
        if path.is_file():
            targets.append(path)
        elif path.is_dir():
            targets.extend(p for p in path.rglob("*") if p.is_file())
    return sorted(set(targets))


def main() -> None:
    target_files = _resolve_target_files(sys.argv[1:])
    hits: list[str] = []
    for path in target_files:
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        try:
            rel = path.relative_to(REPO_ROOT)
        except ValueError:
            rel = path
        if str(rel) in SKIP_FILES:
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            for label, pattern in PATTERNS.items():
                match = pattern.search(line)
                if match:
                    # Special handling for email addresses - filter out allowed ones
                    if label == "email address":
                        # README may include public project contact text; other
                        # sensitive patterns still apply to it.
                        if str(rel) == "README.md":
                            continue
                        email_text = match.group(0)
                        if is_allowed_email(email_text):
                            continue
                    hits.append(f"{rel}:{line_number}: {label}")

    if hits:
        print("[check-public-artifacts] FAIL: public-safety scan matched:")
        for hit in hits:
            print(f"  {hit}")
        raise SystemExit(1)

    print(f"[check-public-artifacts] OK: scanned {len(target_files)} files")


if __name__ == "__main__":
    main()
