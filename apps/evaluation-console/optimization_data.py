#!/usr/bin/env python3
"""Read-only access to the self-optimization loop's artifacts.

The optimization loop writes three artifact trees under the repo:

  optimization/results/<skill>/<iter>/   decision.json, summary.md, journal.jsonl
  optimization/runs/<skill>/<iter>/<scenario>/   screenshot.png, *-checks.json,
                                                 judge-verdicts.json, console.json, ...
  optimization/runs/<skill>/baseline/<scenario>/ the current-best render to diff against

This module turns those into clean JSON the evaluation console renders. It never
writes; the loop owns the files. Every path returned is repo-relative so the
server's ``/api/artifact`` endpoint can serve it.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# A non-terminal journal whose last event is older than this is a stalled /
# orphaned run, not "running" — generous enough not to false-stall an active
# iteration that is mid-step (the loop's steps can each take minutes).
RUNNING_MAX_AGE_S = 1800


def _is_fresh(ts_str: Any, max_age_s: int = RUNNING_MAX_AGE_S) -> bool:
    if not ts_str:
        return False
    try:
        ts = datetime.fromisoformat(str(ts_str))
    except ValueError:
        return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() <= max_age_s


REPO_ROOT = Path(__file__).resolve().parents[2]
RESULTS = REPO_ROOT / "optimization" / "results"
RUNS = REPO_ROOT / "optimization" / "runs"
SCENARIOS = REPO_ROOT / "optimization" / "scenarios"
SKILLS = REPO_ROOT / "skills"

# Per-scenario judge verdict -> who the visual panel preferred.
#   CANDIDATE = the new revision won (an improvement)
#   BASELINE  = the current-best won (a regression)
#   TIE       = no meaningful difference
WIN, LOSS, TIE = "CANDIDATE", "BASELINE", "TIE"


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def _rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _iter_key(name: str) -> tuple[int, str]:
    """Sort 'baseline' first, then numeric iterations ascending."""
    if name == "baseline":
        return (-1, name)
    m = re.match(r"(\d+)", name)
    return (int(m.group(1)) if m else 10_000, name)


def _scenario_label(dirname: str) -> tuple[str, str]:
    """'eval-006-grand-canyon-south-rim' -> ('eval-006', 'grand canyon south rim')."""
    m = re.match(r"(eval-\d+)-(.*)$", dirname)
    if not m:
        return dirname, dirname.replace("-", " ")
    return m.group(1), m.group(2).replace("-", " ")


def _screenshots(bundle: Path) -> list[str]:
    if not bundle.is_dir():
        return []
    shots = sorted(bundle.glob("screenshot*.png"), key=lambda p: p.name)
    return [_rel(p) for p in shots]


# --------------------------------------------------------------------------- #
# summary.md scores
# --------------------------------------------------------------------------- #
_SCORE_PATTERNS = {
    "programmatic": r"\*\*Programmatic Correctness:\*\*\s*([\d.]+)%",
    "api": r"\*\*API Accuracy:\*\*\s*([\d.]+)%",
    "visual_win_rate": r"\*\*Visual Win Rate:\*\*\s*([\d.]+)%",
    "coverage_delta": r"\*\*Coverage Delta:\*\*\s*([\-\d.]+)%",
}


def _parse_scores(summary_md: Path) -> dict[str, float | None]:
    out: dict[str, float | None] = {k: None for k in _SCORE_PATTERNS}
    if not summary_md.is_file():
        return out
    text = summary_md.read_text(encoding="utf-8", errors="replace")
    for key, pat in _SCORE_PATTERNS.items():
        m = re.search(pat, text)
        if m:
            try:
                out[key] = float(m.group(1))
            except ValueError:
                pass
    return out


# --------------------------------------------------------------------------- #
# iteration-level reads
# --------------------------------------------------------------------------- #
def _iteration_dirs(skill: str) -> list[str]:
    base = RESULTS / skill
    if not base.is_dir():
        return []
    names = [p.name for p in base.iterdir() if p.is_dir()]
    return sorted(names, key=_iter_key)


def _decision(skill: str, it: str) -> dict[str, Any]:
    return _read_json(RESULTS / skill / it / "decision.json") or {}


def _journal(skill: str, it: str) -> list[dict[str, Any]]:
    path = RESULTS / skill / it / "journal.jsonl"
    if not path.is_file():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def iteration_summary(skill: str, it: str) -> dict[str, Any]:
    """Lightweight per-iteration record for the history strip + trends."""
    decision = _decision(skill, it)
    scores = _parse_scores(RESULTS / skill / it / "summary.md")
    journal = _journal(skill, it)
    started = next((e.get("timestamp_utc") for e in journal if e.get("event") == "iteration_started"), None)
    finished = next(
        (e.get("timestamp_utc") for e in reversed(journal) if e.get("event") == "iteration_completed"),
        None,
    )
    counts = decision.get("counts") or {}
    events = {e.get("event") for e in journal}
    if it == "baseline":
        status = "baseline"
    elif "iteration_completed" in events:
        status = "completed"
    elif "iteration_failed" in events:
        status = "failed"
    elif journal:
        # Non-terminal journal: "running" only if its last event is recent;
        # otherwise it is a stalled/orphaned run from a previous session.
        last_ts = journal[-1].get("timestamp_utc")
        status = "running" if _is_fresh(last_ts) else "stalled"
    else:
        status = "empty"
    failed_step = next(
        (e.get("step") for e in reversed(journal) if e.get("event") == "iteration_failed"),
        None,
    )
    return {
        "iteration": it,
        "is_baseline": it == "baseline",
        "status": status,
        "failed_step": failed_step,
        "decision": decision.get("decision"),
        "rule_fired": decision.get("rule_fired"),
        "rationale": decision.get("rationale"),
        "counts": {
            "wins": counts.get("wins", 0),
            "losses": counts.get("losses", 0),
            "ties": counts.get("ties", 0),
            "critical_failures": counts.get("critical_failures", 0),
            "check_failures": counts.get("check_failures", 0),
        },
        "scores": scores,
        "started_utc": started,
        "finished_utc": finished,
        "has_runs": (RUNS / skill / it).is_dir(),
    }


# --------------------------------------------------------------------------- #
# scenario-level reads (the candidate-vs-baseline evidence)
# --------------------------------------------------------------------------- #
def _checks_summary(bundle: Path) -> dict[str, int]:
    data = _read_json(bundle / "programmatic-checks.json") or {}
    checks = data.get("checks") or []
    passed = sum(1 for c in checks if c.get("result") == "pass")
    crit_failed = sum(1 for c in checks if c.get("result") == "fail" and c.get("critical"))
    return {"passed": passed, "total": len(checks), "critical_failed": crit_failed}


def _console_errors(bundle: Path) -> int:
    data = _read_json(bundle / "console.json") or {}
    return len(data.get("errors") or [])


def _scenario_detail(skill: str, it: str, scenario_dir: Path) -> dict[str, Any]:
    scenario_id, label = _scenario_label(scenario_dir.name)
    verdicts = _read_json(scenario_dir / "judge-verdicts.json") or {}
    baseline_bundle = RUNS / skill / "baseline" / scenario_dir.name
    individual = [
        {
            "seed": v.get("seed"),
            "verdict": v.get("verdict"),
            "rationale": v.get("rationale"),
            "judge_index": v.get("judge_index"),
        }
        for v in (verdicts.get("individual_verdicts") or [])
    ]
    return {
        "scenario_id": scenario_id,
        "label": label,
        "dir": scenario_dir.name,
        "verdict": verdicts.get("verdict"),
        "majority_count": verdicts.get("majority_count"),
        "judge_unavailable": bool(verdicts.get("judge_unavailable")),
        "individual_verdicts": individual,
        "checks": _checks_summary(scenario_dir),
        "console_errors": _console_errors(scenario_dir),
        "candidate_screenshots": _screenshots(scenario_dir),
        "baseline_screenshots": _screenshots(baseline_bundle),
    }


def iteration_detail(skill: str, it: str) -> dict[str, Any]:
    """Full evidence for one iteration: decision + scores + per-scenario diffs."""
    summary = iteration_summary(skill, it)
    runs_dir = RUNS / skill / it
    scenarios: list[dict[str, Any]] = []
    if runs_dir.is_dir():
        for sd in sorted(runs_dir.iterdir(), key=lambda p: p.name):
            if sd.is_dir() and sd.name.startswith("eval-"):
                scenarios.append(_scenario_detail(skill, it, sd))
    summary["scenarios"] = scenarios
    summary["journal"] = _journal(skill, it)
    return summary


# --------------------------------------------------------------------------- #
# skill-level aggregation
# --------------------------------------------------------------------------- #
def _live_skill_md_meta(skill: str) -> dict[str, Any]:
    md = SKILLS / skill / "SKILL.md"
    if not md.is_file():
        return {"exists": False}
    text = md.read_text(encoding="utf-8", errors="replace")
    return {"exists": True, "bytes": len(text.encode("utf-8")), "lines": text.count("\n") + 1}


def skill_overview(skill: str) -> dict[str, Any]:
    iters = _iteration_dirs(skill)
    history = [iteration_summary(skill, it) for it in iters]
    non_baseline = [h for h in history if not h["is_baseline"]]
    kept = sum(1 for h in non_baseline if h["decision"] == "KEEP")
    rejected = sum(1 for h in non_baseline if h["decision"] == "REJECT")
    # "Latest" is the most recent decisioned iteration, not a half-finished attempt.
    decisioned = [h for h in non_baseline if h["decision"]]
    latest = decisioned[-1] if decisioned else (non_baseline[-1] if non_baseline else None)
    running = [h for h in non_baseline if h["status"] == "running"]
    return {
        "skill": skill,
        "iteration_count": len(non_baseline),
        "kept": kept,
        "rejected": rejected,
        "latest": latest,
        "running": bool(running),
        "history": history,
        "skill_md": _live_skill_md_meta(skill),
    }


def list_skills() -> list[dict[str, Any]]:
    if not RESULTS.is_dir():
        return []
    skills = sorted(p.name for p in RESULTS.iterdir() if p.is_dir() and (RESULTS / p.name).is_dir())
    return [skill_overview(s) for s in skills if _iteration_dirs(s)]


# --------------------------------------------------------------------------- #
# live-run detection (the loop streams into journal.jsonl as it runs)
# --------------------------------------------------------------------------- #
_TERMINAL_EVENTS = {"iteration_completed", "iteration_failed", "baseline_check_completed"}


def active_runs() -> list[dict[str, Any]]:
    """Iterations whose journal has started but reached no terminal event.

    Note: a stale journal (process died without a terminal event) also lands
    here. True "is a process running right now" is owned by the server's
    run-control registry; this is the disk-level signal only.
    """
    live: list[dict[str, Any]] = []
    if not RESULTS.is_dir():
        return live
    for skill_dir in RESULTS.iterdir():
        if not skill_dir.is_dir():
            continue
        for it in _iteration_dirs(skill_dir.name):
            journal = _journal(skill_dir.name, it)
            if not journal:
                continue
            last = journal[-1]
            if last.get("event") in _TERMINAL_EVENTS:
                continue
            live.append(
                {
                    "skill": skill_dir.name,
                    "iteration": it,
                    "last_event": last.get("event"),
                    "last_step": last.get("step"),
                    "last_ts": last.get("timestamp_utc"),
                }
            )
    return live


if __name__ == "__main__":  # quick smoke check
    import sys

    out = {"skills": [s["skill"] for s in list_skills()], "active": active_runs()}
    json.dump(out, sys.stdout, indent=2)
    print()
