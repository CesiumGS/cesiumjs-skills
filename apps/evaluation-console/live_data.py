#!/usr/bin/env python3
"""Read-only live progress for eval runs the optimization loop is running NOW.

The loop (optimization/scripts/run-loop.py) streams structured events into
``optimization/results/<skill>/<iter>/journal.jsonl`` at every phase boundary,
and its phases drop per-trial artifacts on disk as they complete:

  skills_adapter   optimization/generated/<skill>/<iter>/<scenario>.js
  browser_runner   optimization/runs/<skill>/<iter>/<scenario-dir>/  (bundle)
  judges           optimization/runs/<skill>/<iter>/<scenario-dir>/judge-verdicts.json

This module derives an honest, disk-truth progress model from those artifacts:
phase states come 1:1 from the journal, per-trial counts come from the files
the phases actually wrote. It never writes and never guesses — a phase with no
countable trials contributes progress only once its terminal event lands.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from optimization_data import RUNNING_MAX_AGE_S, _is_fresh, _journal, _scenario_label

REPO_ROOT = Path(__file__).resolve().parents[2]
RESULTS = REPO_ROOT / "optimization" / "results"
RUNS = REPO_ROOT / "optimization" / "runs"
GENERATED = REPO_ROOT / "optimization" / "generated"
SCENARIOS = REPO_ROOT / "optimization" / "scenarios"

# A complete browser bundle (mirrors run-loop.evidence_dir_complete).
_BUNDLE_REQUIRED = [
    "console.json",
    "programmatic-checks.json",
    "scene-state.json",
    "metadata.json",
    "screenshot-quality.json",
]

# Iteration phases in loop order, with wall-clock-informed progress weights.
# The three agent-heavy phases dominate; bookkeeping phases are near-free.
# "promote_current_best" is conditional on KEEP, so it is displayed when it
# appears in the journal but carries no weight (progress reaches 1.0 without it).
_ITER_PHASES: list[tuple[str, str, float]] = [
    ("proposer", "Proposer", 0.16),
    ("skills_adapter", "Codegen", 0.22),
    ("browser_runner", "Render", 0.30),
    ("judges", "Judges", 0.26),
    ("decision", "Decision", 0.02),
    ("report", "Report", 0.02),
    ("archive", "Archive", 0.02),
]

# Baseline (pre-iteration) phases, from ensure_current_best_baseline's events.
_BASELINE_PHASES: list[tuple[str, str, float]] = [
    ("baseline_check", "Baseline check", 0.04),
    ("baseline_generation", "Baseline codegen", 0.38),
    ("baseline_browser_eval", "Baseline render", 0.58),
]

_ITER_TERMINAL = {"iteration_completed", "iteration_failed"}
_BASELINE_TERMINAL = {
    "baseline_check_completed",
    "baseline_generation_failed",
    "baseline_browser_eval_completed",
    "baseline_browser_eval_failed",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _scenarios(skill: str) -> list[dict[str, Any]]:
    """Scenario manifests for a skill: id, label, and whether the browser runs it."""
    out: list[dict[str, Any]] = []
    base = SCENARIOS / skill
    if not base.is_dir():
        return out
    for path in sorted(base.glob("eval-*.json")):
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        scenario_id = str(data.get("id") or path.stem)
        _, label = _scenario_label(f"{scenario_id}-{data.get('name') or path.stem}")
        out.append(
            {
                "scenario_id": scenario_id,
                "label": label,
                "runnable": data.get("runner_mode", "global-js") != "review-only",
            }
        )
    return out


def _bundle_complete(bundle: Path) -> bool:
    if not bundle.is_dir():
        return False
    if not any(bundle.glob("screenshot*.png")):
        return False
    return all((bundle / name).is_file() for name in _BUNDLE_REQUIRED)


def _find_bundle(runs_dir: Path, scenario_id: str) -> Path | None:
    if not runs_dir.is_dir():
        return None
    exact = runs_dir / scenario_id
    if exact.is_dir():
        return exact
    for item in sorted(runs_dir.iterdir()):
        if item.is_dir() and item.name.startswith(f"{scenario_id}-"):
            return item
    return None


def _trials(skill: str, artifact_iter: str) -> list[dict[str, Any]]:
    """Per-trial (scenario) artifact truth for one iteration's work directories."""
    gen_dir = GENERATED / skill / artifact_iter
    runs_dir = RUNS / skill / artifact_iter
    rows: list[dict[str, Any]] = []
    for scenario in _scenarios(skill):
        sid = scenario["scenario_id"]
        bundle = _find_bundle(runs_dir, sid)
        rows.append(
            {
                **scenario,
                "codegen_done": (gen_dir / f"{sid}.js").is_file(),
                "render_done": bool(bundle and _bundle_complete(bundle)),
                "judged": bool(bundle and (bundle / "judge-verdicts.json").is_file()),
            }
        )
    return rows


def _last_artifact_mtime(skill: str, artifact_iter: str) -> datetime | None:
    """Newest artifact write across the iteration's work dirs (activity signal
    between journal events, which can be minutes apart during agent phases)."""
    newest: float | None = None
    for base in (GENERATED / skill / artifact_iter, RUNS / skill / artifact_iter):
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if newest is None or mtime > newest:
                newest = mtime
    if newest is None:
        return None
    return datetime.fromtimestamp(newest, tz=timezone.utc)


def _phase_states(
    journal: list[dict[str, Any]],
    phases: list[tuple[str, str, float]],
    kind: str,
) -> list[dict[str, Any]]:
    """Derive phase rows 1:1 from journal events (pending|active|done|failed)."""
    rows = [
        {"id": pid, "label": label, "weight": weight, "state": "pending", "started_utc": None}
        for pid, label, weight in phases
    ]
    by_id = {row["id"]: row for row in rows}

    def apply(pid: str, event_kind: str, ts: Any) -> None:
        row = by_id.get(pid)
        if row is None:
            return
        if event_kind == "started" and row["state"] == "pending":
            row["state"] = "active"
            row["started_utc"] = ts
        elif event_kind == "completed" and row["state"] != "failed":
            row["state"] = "done"
        elif event_kind == "failed":
            row["state"] = "failed"

    for e in journal:
        event = str(e.get("event") or "")
        ts = e.get("timestamp_utc")
        if kind == "iteration":
            if event in {"step_started", "step_completed", "step_failed"}:
                apply(str(e.get("step") or ""), event.split("_", 1)[1], ts)
        else:
            # baseline events are "<phase>_started|_completed|_failed"
            for suffix, event_kind in (("_started", "started"), ("_completed", "completed"), ("_failed", "failed")):
                if event.endswith(suffix):
                    apply(event[: -len(suffix)], event_kind, ts)
                    break
    return rows


def _apply_trial_counts(phases: list[dict[str, Any]], trials: list[dict[str, Any]], kind: str) -> None:
    """Attach honest per-trial counts to the phases that drop countable artifacts."""
    runnable = [t for t in trials if t["runnable"]]
    counts = {
        "skills_adapter": (sum(1 for t in trials if t["codegen_done"]), len(trials)),
        "browser_runner": (sum(1 for t in runnable if t["render_done"]), len(runnable)),
        "judges": (sum(1 for t in runnable if t["judged"]), len(runnable)),
        "baseline_generation": (sum(1 for t in trials if t["codegen_done"]), len(trials)),
        "baseline_browser_eval": (sum(1 for t in runnable if t["render_done"]), len(runnable)),
    }
    for phase in phases:
        done_total = counts.get(phase["id"])
        if done_total is None or kind == "skip":
            phase["trials_done"] = None
            phase["trials_total"] = None
        else:
            phase["trials_done"], phase["trials_total"] = done_total


def _progress(phases: list[dict[str, Any]]) -> float:
    """Weighted progress: full weight for done phases; countable phases earn
    partial credit from real trial artifacts; agent phases without countable
    output contribute nothing until their terminal event lands (never guessed)."""
    total = 0.0
    for phase in phases:
        if phase["state"] == "done":
            total += phase["weight"]
        elif phase["state"] in {"active", "failed"}:
            done, count = phase.get("trials_done"), phase.get("trials_total")
            if done is not None and count:
                total += phase["weight"] * min(1.0, done / count)
    return round(min(1.0, total), 4)


def _live_run(skill: str, iteration: str, journal: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Build one live-run row from a non-terminal journal, or None when inactive."""
    if not journal:
        return None
    kind = "baseline" if iteration == "baseline" else "iteration"

    # A re-run of the same iteration appends to the old journal; only the
    # segment after the most recent start event describes the current attempt.
    start_events = {"baseline_check_started"} if kind == "baseline" else {"iteration_started"}
    for idx in range(len(journal) - 1, -1, -1):
        if str(journal[idx].get("event") or "") in start_events:
            journal = journal[idx:]
            break

    last = journal[-1]
    last_event = str(last.get("event") or "")
    terminal = _BASELINE_TERMINAL if kind == "baseline" else _ITER_TERMINAL
    if last_event in terminal:
        return None

    phase_spec = _BASELINE_PHASES if kind == "baseline" else _ITER_PHASES
    phases = _phase_states(journal, phase_spec, kind)

    # The conditional promote phase: displayed only when the journal shows it.
    if kind == "iteration" and any(e.get("step") == "promote_current_best" for e in journal):
        promote = _phase_states(journal, [("promote_current_best", "Promote", 0.0)], "iteration")
        phases.extend(promote)

    trials = _trials(skill, iteration)
    _apply_trial_counts(phases, trials, kind)

    started_ts = _parse_ts(journal[0].get("timestamp_utc"))
    journal_ts = _parse_ts(last.get("timestamp_utc"))
    artifact_ts = _last_artifact_mtime(skill, iteration)
    activity_candidates = [ts for ts in (journal_ts, artifact_ts) if ts is not None]
    last_activity = max(activity_candidates) if activity_candidates else None

    status = "running" if last_activity and _is_fresh(last_activity.isoformat()) else "stalled"
    now = datetime.now(timezone.utc)
    active = next((p for p in phases if p["state"] in {"active", "failed"}), None)
    done_count = sum(1 for p in phases if p["state"] == "done")

    return {
        "skill": skill,
        "iteration": iteration,
        "kind": kind,
        "status": status,
        "started_utc": started_ts.isoformat() if started_ts else None,
        "last_activity_utc": last_activity.isoformat() if last_activity else None,
        "elapsed_s": max(0, int((now - started_ts).total_seconds())) if started_ts else None,
        "current_phase": active["id"] if active else None,
        "current_phase_label": active["label"] if active else None,
        "phase_index": min(done_count + 1, len(phases)) if phases else 0,
        "phase_total": len(phases),
        "phases": phases,
        "trials": trials,
        "trials_total": len(trials),
        "progress": _progress(phases),
        "last_event": {
            "event": last_event,
            "step": last.get("step"),
            "timestamp_utc": last.get("timestamp_utc"),
        },
        "journal_tail": journal[-12:],
    }


def live_status() -> dict[str, Any]:
    """All eval runs progressing on disk right now (plus honest stalled ones)."""
    active: list[dict[str, Any]] = []
    if RESULTS.is_dir():
        for skill_dir in sorted(RESULTS.iterdir()):
            if not skill_dir.is_dir():
                continue
            for it_dir in sorted(skill_dir.iterdir()):
                if not it_dir.is_dir():
                    continue
                journal = _journal(skill_dir.name, it_dir.name)
                run = _live_run(skill_dir.name, it_dir.name, journal)
                if run:
                    active.append(run)
    active.extend(_audit_live_runs())
    # Freshest activity first; running before stalled.
    active.sort(
        key=lambda r: (r["status"] != "running", -(_parse_ts(r["last_activity_utc"]) or datetime.min.replace(tzinfo=timezone.utc)).timestamp()),
    )
    return {
        "generated_at": _now_iso(),
        "running": any(r["status"] == "running" for r in active),
        "poll_ms": 2500,
        "max_age_s": RUNNING_MAX_AGE_S,
        "active": active,
    }


# ---------------------------------------------------------------------------
# Combined baseline audits: journaled by run-baseline-audit.py --journal.
# The same append-only JSONL contract as the optimization loop, so the Live
# station (and any CI log collector) streams progress the same way.
# ---------------------------------------------------------------------------

AUDITS = REPO_ROOT / "evaluation" / "artifacts" / "audits"
FIXTURES = REPO_ROOT / "evaluation" / "fixtures"
AUDIT_SCRIPT = REPO_ROOT / "evaluation" / "scripts" / "run-baseline-audit.py"
AUDIT_JOURNAL_NAME = "progress.jsonl"
LAUNCH_META_NAME = "launch.json"
_AUDIT_TERMINAL = {"audit_completed", "audit_failed"}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue  # Torn tail write; the next poll sees it whole.
                if isinstance(data, dict):
                    events.append(data)
    except OSError:
        return []
    return events


def _audit_phase_spec(judge: bool) -> list[tuple[str, str, float]]:
    # Weights follow wall clock: the judge panel dominates a judged audit;
    # deterministic scoring dominates a det-only one.
    if judge:
        return [
            ("judge", "Visual judge", 0.82),
            ("score", "Deterministic score", 0.13),
            ("write", "Scorecard", 0.05),
        ]
    return [("score", "Deterministic score", 0.85), ("write", "Scorecard", 0.15)]


def _audit_phases(journal: list[dict[str, Any]], judge: bool) -> list[dict[str, Any]]:
    rows = [
        {"id": pid, "label": label, "weight": weight, "state": "pending", "started_utc": None,
         "trials_done": None, "trials_total": None}
        for pid, label, weight in _audit_phase_spec(judge)
    ]
    by_id = {row["id"]: row for row in rows}

    def mark(pid: str, state: str, ts: Any = None) -> None:
        row = by_id.get(pid)
        if row is None:
            return
        if state == "active" and row["state"] == "pending":
            row["state"] = "active"
            row["started_utc"] = ts
        elif state == "done" and row["state"] != "failed":
            row["state"] = "done"
        elif state == "failed":
            row["state"] = "failed"

    for e in journal:
        event = str(e.get("event") or "")
        ts = e.get("timestamp_utc")
        if event == "judge_started":
            mark("judge", "active", ts)
            by_id["judge"]["trials_total"] = e.get("total")
            by_id["judge"]["trials_done"] = 0
        elif event == "judge_case_completed":
            by_id.get("judge", {}).update(trials_done=e.get("index"), trials_total=e.get("total"))
        elif event == "judge_completed":
            mark("judge", "done")
        elif event == "scoring_started":
            mark("judge", "done")  # Judge lane (if any) is behind us.
            mark("score", "active", ts)
            by_id["score"]["trials_total"] = e.get("total")
            by_id["score"]["trials_done"] = 0
        elif event == "scoring_case_completed":
            by_id["score"].update(trials_done=e.get("index"), trials_total=e.get("total"))
        elif event == "scoring_completed":
            mark("score", "done")
            mark("write", "active", ts)
        elif event == "scorecard_written":
            mark("write", "done")
        elif event == "audit_failed":
            failing = next((r for r in rows if r["state"] == "active"), rows[-1])
            failing["state"] = "failed"
    return rows


def _audit_trials(journal: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-case board rows mapped onto the LiveTrial shape the UI renders.

    Codegen is not an audit stage (evidence is pre-rendered), so cases go
    queued -> scored (render_done) -> judged; det-only audits finish at
    scored, and the UI words the stages accordingly.
    """
    started = next((e for e in journal if str(e.get("event")) == "audit_started"), None)
    roster: list[tuple[str, str]] = []
    if started and isinstance(started.get("cases"), list):
        roster = [
            (str(c.get("skill") or ""), str(c.get("case_id") or ""))
            for c in started["cases"]
            if isinstance(c, dict)
        ]
    judged: set[tuple[str, str]] = set()
    scored: set[tuple[str, str]] = set()
    for e in journal:
        event = str(e.get("event") or "")
        key = (str(e.get("skill") or ""), str(e.get("case_id") or ""))
        if event == "judge_case_completed":
            judged.add(key)
        elif event == "scoring_case_completed":
            scored.add(key)
    if not roster:
        roster = sorted(judged | scored)
    multi_skill = len({s for s, _ in roster}) > 1
    rows: list[dict[str, Any]] = []
    for skill, case_id in roster:
        key = (skill, case_id)
        short = skill.removeprefix("cesiumjs-")
        rows.append(
            {
                "scenario_id": f"{short}·{case_id}" if multi_skill else case_id,
                "label": "" if multi_skill else short,  # multi-skill ids already carry the skill
                "runnable": True,
                "codegen_done": False,
                "render_done": key in scored,
                "judged": key in judged,
            }
        )
    return rows


def _audit_live_run(audit_dir: Path) -> dict[str, Any] | None:
    """One live-run row for a journaled combined audit, or None when finished."""
    journal_path = audit_dir / AUDIT_JOURNAL_NAME
    journal = _read_jsonl(journal_path)
    launch_meta: dict[str, Any] = {}
    meta_path = audit_dir / LAUNCH_META_NAME
    if meta_path.is_file():
        try:
            launch_meta = json.loads(meta_path.read_text())
        except (OSError, json.JSONDecodeError):
            launch_meta = {}
    if not journal:
        if not launch_meta:
            return None
        # Launched but no journal line yet: honest "starting" row.
        started = str(launch_meta.get("started_utc") or "")
        if not _is_fresh(started):
            return None  # Never journaled and old: a dead launch, not live.
        journal = [{"timestamp_utc": started, "event": "launch_accepted"}]

    last = journal[-1]
    last_event = str(last.get("event") or "")
    if last_event in _AUDIT_TERMINAL:
        return None

    started_ev = next((e for e in journal if str(e.get("event")) == "audit_started"), None)
    judge = bool((started_ev or {}).get("judge", launch_meta.get("judge", True)))
    skills = list((started_ev or {}).get("skills") or launch_meta.get("skills") or [])
    phases = _audit_phases(journal, judge)
    trials = _audit_trials(journal)

    started_ts = _parse_ts(journal[0].get("timestamp_utc"))
    journal_ts = _parse_ts(last.get("timestamp_utc"))
    # The launch log ticks while agent judges stream stdout between journal
    # events (a panel case can take minutes), so it is a real activity signal.
    log_ts: datetime | None = None
    log_path = audit_dir / "launch.log"
    if log_path.is_file():
        try:
            log_ts = datetime.fromtimestamp(log_path.stat().st_mtime, tz=timezone.utc)
        except OSError:
            log_ts = None
    candidates = [ts for ts in (journal_ts, log_ts) if ts is not None]
    last_activity = max(candidates) if candidates else None

    status = "running" if last_activity and _is_fresh(last_activity.isoformat()) else "stalled"
    now = datetime.now(timezone.utc)
    active = next((p for p in phases if p["state"] in {"active", "failed"}), None)
    done_count = sum(1 for p in phases if p["state"] == "done")
    label = "Combined audit" if len(skills) != 1 else f"Audit · {skills[0]}"

    return {
        "skill": skills[0] if len(skills) == 1 else "baseline-audit",
        "label": f"{label} ({len(skills)} skills)" if len(skills) > 1 else label,
        "iteration": audit_dir.name,
        "kind": "audit",
        "judge": judge,
        "status": status,
        "started_utc": started_ts.isoformat() if started_ts else None,
        "last_activity_utc": last_activity.isoformat() if last_activity else None,
        "elapsed_s": max(0, int((now - started_ts).total_seconds())) if started_ts else None,
        "current_phase": active["id"] if active else None,
        "current_phase_label": active["label"] if active else None,
        "phase_index": min(done_count + 1, len(phases)) if phases else 0,
        "phase_total": len(phases),
        "phases": phases,
        "trials": trials,
        "trials_total": len(trials),
        "progress": _progress(phases),
        "last_event": {
            "event": last_event,
            "step": last.get("step"),
            "timestamp_utc": last.get("timestamp_utc"),
        },
        "journal_tail": journal[-12:],
    }


def _audit_live_runs() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not AUDITS.is_dir():
        return rows
    for audit_dir in sorted(AUDITS.iterdir()):
        if not audit_dir.is_dir():
            continue
        if not (audit_dir / AUDIT_JOURNAL_NAME).is_file() and not (audit_dir / LAUNCH_META_NAME).is_file():
            continue  # Historic audits without journals are not live subjects.
        try:
            run = _audit_live_run(audit_dir)
        except Exception:
            continue  # One corrupt dir must not take down the endpoint.
        if run:
            rows.append(run)
    return rows


# ---------------------------------------------------------------------------
# Launching runs from the console. The server process only ever builds a
# fixed argv from validated inputs (no shell, no free-form strings) and
# detaches the child; progress flows back exclusively through the journal,
# which is also exactly what a CI wrapper would tail.
# ---------------------------------------------------------------------------

_ADAPTERS = {"opencode", "codex"}


def available_skills() -> list[str]:
    if not FIXTURES.is_dir():
        return []
    return sorted(d.name for d in FIXTURES.iterdir() if d.is_dir())


def launch_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and start a combined baseline audit; return the launch record."""
    import subprocess
    import sys as _sys

    kind = str(payload.get("kind") or "audit")
    if kind != "audit":
        raise ValueError(f"unsupported launch kind: {kind!r} (supported: audit)")

    known = available_skills()
    requested = payload.get("skills")
    if requested in (None, [], "all", "ALL"):
        skills = known
    else:
        if not isinstance(requested, list):
            raise ValueError("skills must be a list of skill ids or omitted for all")
        skills = [str(s) for s in requested]
        unknown = [s for s in skills if s not in known]
        if unknown:
            raise ValueError(f"unknown skill(s): {', '.join(unknown)}")
    if not skills:
        raise ValueError("no skills available to audit")

    judge = bool(payload.get("judge", True))
    adapter = str(payload.get("adapter") or "opencode")
    if adapter not in _ADAPTERS:
        raise ValueError(f"unknown adapter: {adapter!r} (supported: {', '.join(sorted(_ADAPTERS))})")
    try:
        n_judges = int(payload.get("n_judges", 3))
    except (TypeError, ValueError):
        raise ValueError("n_judges must be an integer") from None
    if not 1 <= n_judges <= 5:
        raise ValueError("n_judges must be between 1 and 5")

    launch_id = "live-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = AUDITS / launch_id
    out_dir.mkdir(parents=True, exist_ok=True)
    journal_path = out_dir / AUDIT_JOURNAL_NAME
    log_path = out_dir / "launch.log"

    argv = [
        _sys.executable,
        str(AUDIT_SCRIPT),
        "--skills",
        ",".join(skills),
        "--journal",
        str(journal_path),
        "--output-dir",
        str(out_dir),
        "--adapter",
        adapter,
        "--n-judges",
        str(n_judges),
    ]
    if not judge:
        argv.append("--no-judge")

    with log_path.open("w", encoding="utf-8") as log_fh:
        proc = subprocess.Popen(
            argv,
            cwd=REPO_ROOT,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,  # Survives console restarts; owns its group.
        )

    record = {
        "launch_id": launch_id,
        "kind": "audit",
        "pid": proc.pid,
        "skills": skills,
        "judge": judge,
        "adapter": adapter,
        "n_judges": n_judges,
        "argv": argv,
        "journal": str(journal_path),
        "log": str(log_path),
        "output_dir": str(out_dir),
        "started_utc": _now_iso(),
    }
    (out_dir / LAUNCH_META_NAME).write_text(json.dumps(record, indent=2) + "\n")
    return record


if __name__ == "__main__":  # quick smoke check
    import sys

    json.dump(live_status(), sys.stdout, indent=2)
    print()
