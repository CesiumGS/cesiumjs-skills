#!/usr/bin/env python3
"""Backfill codegen provenance (harness, model, effort) into historical scorecards.

Older scorecards never stamped the codegen model, and some never stamped the
harness, so the evaluation console showed "Unknown" harnesses and "model?"
chips. Every scorecard case, however, points at the generated code it scored
(``evidence_summary.actual_source_path``), and that code sits beside a
``*.meta.json`` recording the exact harness / model / effort it was produced
with. This script recovers that provenance and stamps it back onto each
scorecard so the record is self-describing — recovered from real metas on disk,
never guessed.

Stamps (only when missing — idempotent, never overwrites a real value):
  * top-level ``harness``
  * ``artifacts.model`` and ``artifacts.model_variant``
  * ``artifacts.evidence_source`` (agent | fixtures | mixed)

Usage:
  python3 evaluation/scripts/backfill-scorecard-provenance.py            # write
  python3 evaluation/scripts/backfill-scorecard-provenance.py --dry-run  # preview
  python3 evaluation/scripts/backfill-scorecard-provenance.py --check    # CI gate
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from evaluation.framework.scorecard import (  # noqa: E402
    _evidence_source,
    resolve_codegen_provenance,
)

# The two locations the console discovers runs from, plus any nested scorecards.
SEARCH_ROOTS = [
    REPO_ROOT / "evaluation" / "artifacts" / "audits",
    REPO_ROOT / "evaluation" / "artifacts" / "scorecards",
]


def discover_scorecards() -> list[Path]:
    seen: set[Path] = set()
    found: list[Path] = []
    for root in SEARCH_ROOTS:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("scorecard*.json")):
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            found.append(path)
    return found


def plan_stamps(scorecard: dict[str, Any]) -> dict[str, str]:
    """Fields this scorecard is missing that we can recover, as label -> value."""
    provenance = resolve_codegen_provenance(scorecard, REPO_ROOT)
    artifacts = scorecard.get("artifacts")
    artifacts = artifacts if isinstance(artifacts, dict) else {}
    stamps: dict[str, str] = {}

    harness_field = scorecard.get("harness")
    if not (isinstance(harness_field, str) and harness_field.strip()) and provenance.get("harness"):
        stamps["harness"] = provenance["harness"]

    if not (isinstance(artifacts.get("model"), str) and artifacts["model"].strip()) and provenance.get("model"):
        stamps["artifacts.model"] = provenance["model"]

    if not (
        isinstance(artifacts.get("model_variant"), str) and artifacts["model_variant"].strip()
    ) and provenance.get("model_variant"):
        stamps["artifacts.model_variant"] = provenance["model_variant"]

    if not (isinstance(artifacts.get("evidence_source"), str) and artifacts["evidence_source"].strip()):
        cases = scorecard.get("cases")
        if isinstance(cases, list) and cases:
            stamps["artifacts.evidence_source"] = _evidence_source(cases)

    return stamps


def apply_stamps(scorecard: dict[str, Any], stamps: dict[str, str]) -> None:
    artifacts = scorecard.setdefault("artifacts", {})
    if not isinstance(artifacts, dict):
        artifacts = {}
        scorecard["artifacts"] = artifacts
    for label, value in stamps.items():
        if label == "harness":
            scorecard["harness"] = value
        elif label.startswith("artifacts."):
            artifacts[label.split(".", 1)[1]] = value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if any scorecard is missing recoverable provenance (CI gate).",
    )
    args = parser.parse_args(argv)

    scorecards = discover_scorecards()
    if not scorecards:
        print("[backfill] no scorecards found under evaluation/artifacts.")
        return 0

    changed = 0
    unrecoverable = 0
    for path in scorecards:
        try:
            with path.open("r", encoding="utf-8") as handle:
                scorecard = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[backfill] skip {path.relative_to(REPO_ROOT)}: {exc}", file=sys.stderr)
            continue
        if not isinstance(scorecard, dict) or not isinstance(scorecard.get("cases"), list):
            continue

        stamps = plan_stamps(scorecard)
        rel = path.relative_to(REPO_ROOT)
        if not stamps:
            # Nothing missing, or a pure-fixtures run with no codegen to recover.
            has_model = isinstance((scorecard.get("artifacts") or {}).get("model"), str)
            has_harness = isinstance(scorecard.get("harness"), str)
            if not (has_model and has_harness):
                unrecoverable += 1
            continue

        summary = ", ".join(f"{k}={v}" for k, v in stamps.items())
        verb = "would stamp" if args.dry_run or args.check else "stamped"
        print(f"[backfill] {verb} {rel}: {summary}")
        changed += 1
        if args.dry_run or args.check:
            continue
        apply_stamps(scorecard, stamps)
        path.write_text(json.dumps(scorecard, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(
        f"[backfill] {len(scorecards)} scorecard(s) scanned, "
        f"{changed} {'need' if (args.dry_run or args.check) else 'received'} stamps, "
        f"{unrecoverable} with no recoverable provenance."
    )
    if args.check and changed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
