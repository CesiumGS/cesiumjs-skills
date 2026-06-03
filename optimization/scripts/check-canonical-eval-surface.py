#!/usr/bin/env python3
"""Ensure active eval work stays in optimization/ or evaluation/."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

ALLOWED_REFERENCE_FILES = {
    ".gitignore",
    "optimization/docs/source-of-truth.md",
    "evaluation/README.md",
    "optimization/scripts/check-canonical-eval-surface.py",
}

FORBIDDEN_TOP_LEVEL_EVAL_DIRS = {
    "adapters": "optimization/framework/",
    "checks": "optimization/framework/",
    "decision": "optimization/framework/",
    "judges": "optimization/framework/",
    "proposer": "optimization/framework/",
    "scripts": "optimization/scripts/ or evaluation/scripts/",
    "tasks": "optimization/docs/",
    "tests": "optimization/tests/ or evaluation/tests/",
}

FORBIDDEN_TOP_LEVEL_EVAL_FILES = {
    "prd.json": "optimization/docs/prd.json",
}

FORBIDDEN_REFERENCE_PATTERNS = {
    "historical tuning path": re.compile(r"\btuning/"),
    "old tuning runner": re.compile(r"\brun_eval_suite\.py\b"),
    "old tuning coverage tool": re.compile(r"\bcoverage-analyzer\.py\b"),
}

FORBIDDEN_EVALUATION_IMPORT_PATTERN = re.compile(
    r"^\s*(?:from\s+optimization\b|import\s+optimization\b)"
)


def git_ls_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def main() -> int:
    tracked = git_ls_files()
    failures: list[str] = []

    tracked_tuning = [path for path in tracked if path == "tuning" or path.startswith("tuning/")]
    for path in tracked_tuning:
        failures.append(f"{path}: tracked historical tuning content is not allowed")

    tracked_legacy_evals = [path for path in tracked if path == "evals" or path.startswith("evals/")]
    for path in tracked_legacy_evals:
        failures.append(
            f"{path}: legacy evals/ content must be moved to optimization/ or evaluation/"
        )

    for rel_path in tracked:
        if rel_path in FORBIDDEN_TOP_LEVEL_EVAL_FILES:
            destination = FORBIDDEN_TOP_LEVEL_EVAL_FILES[rel_path]
            failures.append(f"{rel_path}: eval planning artifacts must live under {destination}")

        top_level = rel_path.split("/", 1)[0]
        if top_level in FORBIDDEN_TOP_LEVEL_EVAL_DIRS:
            destination = FORBIDDEN_TOP_LEVEL_EVAL_DIRS[top_level]
            failures.append(
                f"{rel_path}: eval pipeline files must live under {destination}"
            )

    for rel_path in tracked:
        if rel_path in ALLOWED_REFERENCE_FILES:
            continue
        path = REPO_ROOT / rel_path
        if not path.is_file():
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            if (
                rel_path.startswith("evaluation/")
                and rel_path.endswith(".py")
                and FORBIDDEN_EVALUATION_IMPORT_PATTERN.search(line)
            ):
                failures.append(
                    f"{rel_path}:{line_number}: evaluation code must not import optimization"
                )
            for label, pattern in FORBIDDEN_REFERENCE_PATTERNS.items():
                if pattern.search(line):
                    failures.append(f"{rel_path}:{line_number}: {label}")

    if failures:
        print("[check-canonical-eval-surface] FAIL:")
        for failure in failures:
            print(f"  {failure}")
        return 1

    print("[check-canonical-eval-surface] OK: eval work is scoped to optimization/ and evaluation/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
