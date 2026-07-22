#!/usr/bin/env python3
"""Harness/model registry + observed model×harness insights for the console.

Two truths, kept separate on purpose (the PM's provenance rule):

  DECLARED  — the harness/model registry: what harnesses exist, which provider
              backs them, whether they can see images, what models they expose
              and at what relative price/effort. Data lives in
              ``config/harness-registry.json``; live pipeline defaults are overlaid
              from the neutral ``harness`` package at read time so the console
              always reflects what a run started today would actually use.
  OBSERVED  — what the artifacts on disk actually recorded: per-iteration
              codegen provenance from ``optimization/generated/<skill>/<iter>/
              *.meta.json`` joined with each iteration's decision/counts. An
              iteration with no recorded provenance aggregates under the
              honest ``unrecorded`` bucket — it is never guessed.

This module only reads; it never writes.
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

import optimization_data as optd

VIEWER_ROOT = Path(__file__).resolve().parent
REPO_ROOT = VIEWER_ROOT.parents[1]
GENERATED = REPO_ROOT / "optimization" / "generated"
REGISTRY_PATH = REPO_ROOT / "config" / "harness-registry.json"

UNRECORDED = "unrecorded"


# --------------------------------------------------------------------------- #
# DECLARED — registry + live pipeline defaults
# --------------------------------------------------------------------------- #
def _live_defaults() -> dict[str, dict[str, str]]:
    """Pipeline defaults straight from the neutral harness package.

    Import failures (e.g. running the console from a checkout without the
    harness package on path) degrade to the registry's static fallbacks.
    """
    try:
        import sys

        if str(REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(REPO_ROOT))
        from harness.models import (  # noqa: PLC0415
            DEFAULT_CODEX_MODEL,
            DEFAULT_CODEX_REASONING_EFFORT,
            DEFAULT_MODEL,
            LOW_VARIANT,
        )

        return {
            "codex": {"default_model": DEFAULT_CODEX_MODEL, "default_effort": DEFAULT_CODEX_REASONING_EFFORT},
            "opencode": {"default_model": DEFAULT_MODEL, "default_effort": LOW_VARIANT},
        }
    except Exception:
        return {}


def registry() -> dict[str, Any]:
    with REGISTRY_PATH.open("r", encoding="utf-8") as fh:
        reg = json.load(fh)
    live = _live_defaults()
    for h in reg.get("harnesses", []):
        overlay = live.get(h.get("id", ""))
        if overlay:
            h["default_model"] = overlay["default_model"]
            h["default_effort"] = overlay["default_effort"]
            h["defaults_source"] = "live (harness/models.py)"
        else:
            h["defaults_source"] = "registry fallback"
    return reg


# --------------------------------------------------------------------------- #
# OBSERVED — per-iteration codegen provenance from generated *.meta.json
# --------------------------------------------------------------------------- #
def iteration_provenance(skill: str, iteration: str) -> dict[str, Any] | None:
    """Majority provenance across one iteration's scenario metas.

    Returns None when the iteration recorded nothing. ``mixed`` flags an
    iteration whose scenarios disagree (should not happen; surfaced, not hidden).
    """
    it_dir = GENERATED / skill / str(iteration)
    if not it_dir.is_dir():
        return None
    combos: dict[tuple[str | None, str | None, str | None], int] = {}
    temperature: float | None = None
    for meta_path in sorted(it_dir.glob("*.meta.json")):
        try:
            with meta_path.open("r", encoding="utf-8") as fh:
                meta = json.load(fh)
        except Exception:
            continue
        key = (meta.get("harness"), meta.get("model_id"), meta.get("model_variant"))
        combos[key] = combos.get(key, 0) + 1
        if temperature is None and isinstance(meta.get("temperature"), (int, float)):
            temperature = float(meta["temperature"])
    if not combos:
        return None
    (harness, model_id, variant), _ = max(combos.items(), key=lambda kv: kv[1])
    return {
        "harness": harness,
        "model_id": model_id,
        "model_variant": variant,
        "temperature": temperature,
        "mixed": len(combos) > 1,
    }


def _duration_s(summary: dict[str, Any]) -> float | None:
    started, finished = summary.get("started_utc"), summary.get("finished_utc")
    if not started or not finished:
        return None
    try:
        t0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(str(finished).replace("Z", "+00:00"))
    except ValueError:
        return None
    delta = (t1 - t0).total_seconds()
    return delta if delta >= 0 else None


def _win_rate(summary: dict[str, Any]) -> float | None:
    counts = summary.get("counts") or {}
    wins, losses = counts.get("wins", 0), counts.get("losses", 0)
    denom = wins + losses
    return (wins / denom) if denom else None


def _stddev(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def _newer(a: str | None, b: str | None) -> str | None:
    """The more recent of two ISO timestamps (either may be None/unparseable)."""
    da, db = _parse_ts(a), _parse_ts(b)
    if da is None:
        return b if db is not None else None
    if db is None:
        return a
    return a if da >= db else b


def _run_activity_by_combo(runs: list[dict[str, Any]] | None) -> dict[tuple[str, str, str], str]:
    """Latest evaluation timestamp per (harness, model, variant) across runs.

    A scorecard run evaluates code produced by some codegen combo; folding its
    timestamp into that combo's recency keeps the leaderboard honest about the
    last time the combo was actually exercised, not just first generated.
    """
    latest: dict[tuple[str, str, str], str] = {}
    for run in runs or []:
        harness = run.get("harness")
        model = run.get("model")
        if not (isinstance(harness, str) and harness.strip()) or not (isinstance(model, str) and model.strip()):
            continue
        variant = run.get("model_variant")
        key = (harness.strip(), model.strip(), (variant or "").strip() if isinstance(variant, str) else "")
        ts = run.get("timestamp_utc")
        if isinstance(ts, str) and ts.strip():
            latest[key] = _newer(latest.get(key), ts) or ts
    return latest


def combo_insights(runs: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Observed performance grouped by (harness, model, effort) combination.

    One row per combination actually present in the optimization artifacts.
    Stability = sample stddev of per-iteration visual win-rates (needs >= 2
    scored iterations; otherwise null — insufficient data, not "perfectly
    stable"). Iterations whose metas predate provenance stamping aggregate
    under harness="unrecorded" so legacy data stays visible but honest. When
    scorecard ``runs`` are supplied, each combo's recency also reflects the last
    time a run evaluated code from that combo (``last_evaluated`` / ``last_active``).
    """
    rows: dict[tuple[str, str, str], dict[str, Any]] = {}
    for skill_overview in optd.list_skills():
        skill = skill_overview["skill"]
        for summary in skill_overview["history"]:
            if summary["is_baseline"]:
                continue
            prov = iteration_provenance(skill, summary["iteration"])
            harness = (prov or {}).get("harness") or UNRECORDED
            model = (prov or {}).get("model_id") or UNRECORDED
            variant = (prov or {}).get("model_variant") or None
            key = (harness, model, variant or "")
            row = rows.setdefault(
                key,
                {
                    "harness": harness,
                    "model_id": model,
                    "model_variant": variant,
                    "iterations": 0,
                    "keeps": 0,
                    "rejects": 0,
                    "undecided": 0,
                    "wins": 0,
                    "losses": 0,
                    "ties": 0,
                    "win_rates": [],
                    "durations": [],
                    "skills": set(),
                    "first_used": None,
                    "last_used": None,
                    "members": [],
                },
            )
            row["iterations"] += 1
            decision = summary.get("decision")
            if decision == "KEEP":
                row["keeps"] += 1
            elif decision == "REJECT":
                row["rejects"] += 1
            else:
                row["undecided"] += 1
            counts = summary.get("counts") or {}
            row["wins"] += counts.get("wins", 0)
            row["losses"] += counts.get("losses", 0)
            row["ties"] += counts.get("ties", 0)
            rate = _win_rate(summary)
            if rate is not None:
                row["win_rates"].append(rate)
            duration = _duration_s(summary)
            if duration is not None:
                row["durations"].append(duration)
            row["skills"].add(skill)
            ts = summary.get("started_utc") or summary.get("finished_utc")
            if ts:
                if row["first_used"] is None or ts < row["first_used"]:
                    row["first_used"] = ts
                if row["last_used"] is None or ts > row["last_used"]:
                    row["last_used"] = ts
            row["members"].append(
                {
                    "skill": skill,
                    "iteration": summary["iteration"],
                    "decision": decision,
                    "status": summary.get("status"),
                    "win_rate": rate,
                    "started_utc": summary.get("started_utc"),
                }
            )

    out: list[dict[str, Any]] = []
    for row in rows.values():
        win_rates = row.pop("win_rates")
        durations = row.pop("durations")
        decided = row["keeps"] + row["rejects"]
        denom = row["wins"] + row["losses"]
        out.append(
            {
                **row,
                "skills": sorted(row["skills"]),
                "keep_rate": (row["keeps"] / decided) if decided else None,
                "win_rate": (row["wins"] / denom) if denom else None,
                "win_rate_stddev": _stddev(win_rates),
                "scored_iterations": len(win_rates),
                "mean_duration_s": (sum(durations) / len(durations)) if durations else None,
                "members": sorted(
                    row["members"], key=lambda m: (m["started_utc"] or "", m["skill"]), reverse=True
                ),
            }
        )
    # Fold in the most recent evaluation of each combo so recency tracks the last
    # time the combo was actually exercised, not just when its code was generated.
    run_activity = _run_activity_by_combo(runs)
    for combo in out:
        key = (combo["harness"], combo["model_id"], combo["model_variant"] or "")
        combo["last_evaluated"] = run_activity.get(key)
        combo["last_active"] = _newer(combo["last_used"], combo["last_evaluated"])
    # Highest-volume combos first; unrecorded sinks to the bottom.
    out.sort(key=lambda r: (r["harness"] == UNRECORDED, -r["iterations"], r["model_id"]))
    return out


def insights(runs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"combos": combo_insights(runs)}


if __name__ == "__main__":  # smoke check
    import sys

    json.dump({"registry": registry(), "insights": insights()}, sys.stdout, indent=2, default=str)
    print()
