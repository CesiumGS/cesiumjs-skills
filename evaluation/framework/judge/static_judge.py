"""Static, single-render qualitative judge for CesiumJS baselines.

Runs a panel of N judges (distinct seeds + lenses) over one rendered bundle via
a pluggable :class:`~evaluation.framework.judge.cli_adapter.Adapter`, aggregates
per-dimension by median, applies the liveness/subject gates, computes a weighted
0-10 overall, and emits a ``visual_review_item`` dict matching section 2 of
``evaluation/docs/qualitative-audit-design.md``.

MUST NOT import anything from ``optimization/`` (boundary enforced by
``evaluation/scripts/validate-evaluation.py``).
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .cli_adapter import (
    Adapter,
    CodexCliAdapter,
    FakeAdapter,
    OpenCodeCliAdapter,
    default_judge_harness,
    default_judge_model,
)

# --- protocol constants --------------------------------------------------

PROTOCOL_VERSION = "static-visual-v1"

# Six weighted rubric dimensions (doc section 1). Order is significant for the
# emitted item but aggregation/weighting is keyed by name.
DIMENSION_WEIGHTS: dict[str, float] = {
    "render_liveness": 0.20,
    "subject_presence_and_recognizability": 0.22,
    "framing_and_composition": 0.18,
    "prompt_and_behavior_fidelity": 0.22,
    "visual_correctness_and_artifacts": 0.10,
    "legibility_and_clarity": 0.08,
}

DEFAULT_SEEDS: list[int] = [42, 123, 789]

# Lenses appended to the system prompt, one per judge index.
LENSES: list[str] = [
    "FAILURE-MODE AUDITOR: default to skepticism; your priority is catching "
    "dead/empty/wrong frames; do not reward a confident-looking but empty or "
    "wrong render.",
    "PROMPT-FIDELITY READER: focus on whether the visible viewing geometry and "
    "content match the prompt and expected behaviors.",
    "NEUTRAL HOLISTIC: balanced overall assessment.",
]

# Bands (doc section 1).
BAND_PASS = 7.0
BAND_BORDERLINE_LOW = 4.5

# Blocking failure flags downgrade an otherwise-passing render. Any flag the
# judges agree on (>=2/3) for a HARD gate dimension is treated as blocking.
BLOCKING_FAILURE_FLAGS = {
    "black_frame_ion_auth",
    "starfield_only",
    "gray_unloaded_globe",
    "wrong_subject",
    "missing_required_subject",
    "camera_inside_geometry",
}

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def _default_adapter() -> Adapter:
    if default_judge_harness() == "codex":
        return CodexCliAdapter()
    return OpenCodeCliAdapter()


@dataclass
class JudgeConfig:
    """Configuration for a static-judge panel run."""

    adapter: Adapter = field(default_factory=_default_adapter)
    model: str | None = field(default_factory=default_judge_model)
    n_judges: int = 3
    seeds: list[int] = field(default_factory=lambda: list(DEFAULT_SEEDS))
    allowed_tools: list[str] = field(default_factory=list)
    repo_root: Optional[Path] = None
    reviewer: str = "screenshot-visual-judge"


# --- helpers -------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _repo_root() -> Path:
    # evaluation/framework/judge/static_judge.py -> repo root is parents[3].
    return Path(__file__).resolve().parents[3]


def _repo_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _load_json_file(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _list_screenshots(bundle_dir: Path) -> list[Path]:
    """screenshot.png first, then screenshot-*.png in sorted order."""
    shots: list[Path] = []
    primary = bundle_dir / "screenshot.png"
    if primary.is_file():
        shots.append(primary)
    extras = sorted(
        p for p in bundle_dir.glob("screenshot-*.png") if p.is_file()
    )
    shots.extend(extras)
    return shots


def _clamp_score(value: Any) -> Optional[int]:
    """Coerce a judge dimension score to an int in [0, 10], else None."""
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, min(10, score))


def parse_judge_json(raw: str) -> Optional[dict]:
    """Tolerantly parse a judge's JSON response.

    Strips code fences and any prose preamble/trailer, then extracts the first
    balanced ``{...}`` object. Returns ``None`` if nothing parseable is found.
    """
    if not raw:
        return None
    text = raw.strip()

    # Strip ```json ... ``` / ``` ... ``` fences.
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        candidate = fence.group(1).strip()
        parsed = _try_load_object(candidate)
        if parsed is not None:
            return parsed

    # Direct parse.
    parsed = _try_load_object(text)
    if parsed is not None:
        return parsed

    # Extract first balanced object from arbitrary surrounding prose.
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    parsed = _try_load_object(text[start : i + 1])
                    if parsed is not None:
                        return parsed
                    break
        start = text.find("{", start + 1)
    return None


def _try_load_object(text: str) -> Optional[dict]:
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


# --- prompt rendering ----------------------------------------------------


def _format_list(value: Any) -> str:
    if value is None:
        return "(none specified)"
    if isinstance(value, (list, tuple)):
        items = [str(v) for v in value if str(v).strip()]
        return "\n".join(f"- {v}" for v in items) if items else "(none specified)"
    text = str(value).strip()
    return text if text else "(none specified)"


def _render_user_prompt(
    template: str,
    case_meta: dict,
    screenshots: list[str],
    console_text: str,
    scene_state_text: str,
    checks_text: str,
    screenshot_quality_text: str,
) -> str:
    shots_block = (
        "\n".join(f"- {name}" for name in screenshots)
        if screenshots
        else "(no screenshot available)"
    )
    return template.format(
        scenario_id=case_meta.get("id") or case_meta.get("case_id") or "(unknown)",
        scenario_name=case_meta.get("name", "(unnamed)"),
        scenario_description=case_meta.get("description", "(no description)"),
        scenario_prompt=case_meta.get("prompt", "(no prompt)"),
        expected_behaviors=_format_list(case_meta.get("expected_behaviors")),
        visual_expectations=_format_list(case_meta.get("visual_expectations")),
        screenshots=shots_block,
        console=console_text,
        scene_state=scene_state_text,
        checks=checks_text,
        screenshot_quality=screenshot_quality_text,
    )


def _summarize_console(console: Any, limit: int = 30) -> str:
    if console is None:
        return "(no console output captured)"
    if isinstance(console, dict):
        messages = console.get("console_messages")
        if isinstance(messages, list):
            errors = [m for m in messages if isinstance(m, dict) and m.get("type") == "error"]
            shown = (errors or messages)[:limit]
            lines = [
                f"[{m.get('type', '?')}] {str(m.get('text', '')).strip()[:240]}"
                for m in shown
                if isinstance(m, dict)
            ]
            prefix = f"{len(errors)} error(s), {len(messages)} message(s) total.\n"
            return prefix + ("\n".join(lines) if lines else "(no messages)")
    return json.dumps(console, indent=2)[:4000]


def _summarize_scene_state(scene_state: Any) -> str:
    if scene_state is None:
        return "(no scene state captured)"
    return json.dumps(scene_state, indent=2)[:4000]


def _summarize_checks(checks_data: Any) -> str:
    if checks_data is None:
        return "(no programmatic checks captured)"
    if isinstance(checks_data, dict):
        checks = checks_data.get("checks")
        if isinstance(checks, list):
            lines: list[str] = []
            for check in checks:
                if not isinstance(check, dict):
                    continue
                result = str(check.get("result", "?")).upper()
                check_id = check.get("check_id") or check.get("type") or "(unknown)"
                detail = str(check.get("detail") or check.get("description") or "").strip()
                lines.append(f"[{result}] {check_id}: {detail[:240]}")
            summary = checks_data.get("summary")
            if isinstance(summary, dict):
                lines.append(
                    "Summary: "
                    f"{summary.get('passed', '?')}/{summary.get('total', '?')} passed, "
                    f"{summary.get('failed', '?')} failed"
                )
            return "\n".join(lines) if lines else "(programmatic checks present but empty)"
    return json.dumps(checks_data, indent=2)[:4000]


def _summarize_screenshot_quality(quality: Any) -> str:
    if quality is None:
        return "(no screenshot-quality evidence captured)"
    return json.dumps(quality, indent=2)[:4000]


# --- aggregation ---------------------------------------------------------


def _median_int(values: list[int]) -> int:
    return int(round(statistics.median(values)))


def _aggregate(per_judge: list[dict]) -> dict:
    """Median per-dimension scores + flag tallies across parsed judge results.

    ``per_judge`` items are the *parsed* judge dicts (or ``None`` for failures).
    Returns dimension medians, all detected failure flags, and per-flag counts.
    """
    parsed = [j for j in per_judge if isinstance(j, dict)]

    dim_medians: dict[str, int] = {}
    for dim in DIMENSION_WEIGHTS:
        scores: list[int] = []
        for j in parsed:
            dims = j.get("dimensions") or {}
            entry = dims.get(dim) or {}
            score = _clamp_score(entry.get("score"))
            if score is not None:
                scores.append(score)
        # Missing scores default to 0 (conservative: treat as failing).
        dim_medians[dim] = _median_int(scores) if scores else 0

    # Tally failure flags across both top-level and per-dimension lists.
    flag_counts: dict[str, int] = {}
    flagged_by_judge: list[set[str]] = []
    for j in parsed:
        flags: set[str] = set()
        top = j.get("failure_modes_detected") or []
        if isinstance(top, list):
            flags.update(str(f) for f in top if str(f).strip())
        dims = j.get("dimensions") or {}
        for entry in dims.values():
            if isinstance(entry, dict):
                fms = entry.get("failure_modes") or []
                if isinstance(fms, list):
                    flags.update(str(f) for f in fms if str(f).strip())
        flagged_by_judge.append(flags)
        for flag in flags:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1

    return {
        "n_parsed": len(parsed),
        "dim_medians": dim_medians,
        "flag_counts": flag_counts,
        "flagged_by_judge": flagged_by_judge,
    }


def _weighted_overall(dim_medians: dict[str, int]) -> float:
    return sum(dim_medians[dim] * weight for dim, weight in DIMENSION_WEIGHTS.items())


def _band(overall: float) -> str:
    if overall >= BAND_PASS:
        return "PASS"
    if overall >= BAND_BORDERLINE_LOW:
        return "BORDERLINE"
    return "FAIL"


def _dimension_status(score: int, gated: bool) -> str:
    if gated or score <= 2:
        return "fail"
    if score <= 4:
        return "needs_review"
    if score >= 7:
        return "pass"
    return "needs_review"


# --- core ----------------------------------------------------------------


def judge_render(
    case_meta: dict,
    bundle_dir,
    *,
    config: JudgeConfig,
) -> dict:
    """Run the judge panel over one bundle and emit a ``visual_review_item``.

    Args:
        case_meta: scenario metadata (id, name, description, prompt, optional
            ``expected_behaviors`` / ``visual_expectations``, ``skill``).
        bundle_dir: directory holding ``screenshot.png`` (+ optional
            ``screenshot-*.png``), ``scene-state.json``, ``console.json``.
        config: panel configuration (adapter, model, n_judges, seeds, ...).

    Returns:
        A dict matching the section-2 item contract.
    """
    bundle_dir = Path(bundle_dir)
    repo_root = config.repo_root or _repo_root()

    skill = case_meta.get("skill", "")
    raw_case_id = str(case_meta.get("id") or case_meta.get("case_id") or "")
    # The schema requires case_id matching ^eval-[0-9]{3}$; normalize.
    m = re.search(r"eval-(\d{3})", raw_case_id)
    case_id = f"eval-{m.group(1)}" if m else raw_case_id

    screenshots = _list_screenshots(bundle_dir)
    screenshot_rel = [_repo_relative(p, repo_root) for p in screenshots]
    screenshot_names = [p.name for p in screenshots]

    reviewed_at = _now_iso()
    seeds = list(config.seeds)[: config.n_judges]
    # Pad seeds if fewer provided than judges.
    while len(seeds) < config.n_judges:
        seeds.append(DEFAULT_SEEDS[len(seeds) % len(DEFAULT_SEEDS)])

    # --- missing screenshot -> not_reviewed -----------------------------
    if not screenshots:
        return _not_reviewed_item(
            skill=skill,
            case_id=case_id,
            config=config,
            reviewed_at=reviewed_at,
            seeds=seeds,
            screenshots=screenshot_rel,
            reason="no screenshot.png found in bundle",
        )

    # --- load supporting evidence ---------------------------------------
    console = _load_json_file(bundle_dir / "console.json")
    scene_state = _load_json_file(bundle_dir / "scene-state.json")
    console_text = _summarize_console(console)
    scene_state_text = _summarize_scene_state(scene_state)

    system_template = _load_text(PROMPTS_DIR / f"{PROTOCOL_VERSION}.system.txt")
    user_template = _load_text(PROMPTS_DIR / f"{PROTOCOL_VERSION}.user.txt")

    checks = _load_json_file(bundle_dir / "programmatic-checks.json")
    screenshot_quality = _load_json_file(bundle_dir / "screenshot-quality.json")
    checks_text = _summarize_checks(checks)
    screenshot_quality_text = _summarize_screenshot_quality(screenshot_quality)

    user_prompt = _render_user_prompt(
        user_template,
        case_meta,
        screenshot_rel,
        console_text,
        scene_state_text,
        checks_text,
        screenshot_quality_text,
    )

    add_dir = str(bundle_dir.resolve())
    screenshot_files = [str(path.resolve()) for path in screenshots]

    # --- run the panel ---------------------------------------------------
    per_judge_records: list[dict] = []
    parsed_results: list[Optional[dict]] = []

    for idx in range(config.n_judges):
        lens = LENSES[idx % len(LENSES)]
        seed = seeds[idx]
        system_prompt = system_template.replace("{lens}", lens)
        # Embed seed determinism hint; the system prompt carries the lens.
        full_prompt = (
            f"{system_prompt}\n\n"
            f"[Deterministic judge seed: {seed}]\n\n"
            f"{user_prompt}"
        )
        record: dict = {
            "judge_index": idx,
            "seed": seed,
            "lens": lens,
        }
        try:
            raw = config.adapter.run(
                full_prompt,
                config.model,
                [add_dir],
                list(config.allowed_tools),
                screenshot_files,
            )
            parsed = parse_judge_json(raw)
        except Exception as exc:  # adapter/transport failure
            record["error"] = f"{type(exc).__name__}: {exc}"
            parsed = None
            raw = ""

        if parsed is None:
            record["parsed"] = False
            if "error" not in record:
                record["error"] = "unparseable judge response"
            record["raw_excerpt"] = (raw or "")[:500]
        else:
            record["parsed"] = True
            record["observed"] = parsed.get("observed")
            record["dimensions"] = {
                dim: {
                    "score": _clamp_score((parsed.get("dimensions") or {}).get(dim, {}).get("score")),
                    "justification": (parsed.get("dimensions") or {}).get(dim, {}).get("justification"),
                    "failure_modes": (parsed.get("dimensions") or {}).get(dim, {}).get("failure_modes", []),
                }
                for dim in DIMENSION_WEIGHTS
            }
            record["failure_modes_detected"] = parsed.get("failure_modes_detected", [])
            record["overall"] = parsed.get("overall")
            record["band"] = parsed.get("band")
            record["confidence"] = parsed.get("confidence")
            record["rationale"] = parsed.get("rationale")

        per_judge_records.append(record)
        parsed_results.append(parsed)

    # --- panel unavailable -> needs_review ------------------------------
    agg = _aggregate(parsed_results)
    if agg["n_parsed"] == 0:
        return _judge_unavailable_item(
            skill=skill,
            case_id=case_id,
            config=config,
            reviewed_at=reviewed_at,
            seeds=seeds,
            screenshots=screenshot_rel,
            per_judge=per_judge_records,
        )

    return _build_item(
        skill=skill,
        case_id=case_id,
        config=config,
        reviewed_at=reviewed_at,
        seeds=seeds,
        screenshots=screenshot_rel,
        per_judge=per_judge_records,
        agg=agg,
    )


# --- item builders -------------------------------------------------------


def _build_item(
    *,
    skill: str,
    case_id: str,
    config: JudgeConfig,
    reviewed_at: str,
    seeds: list[int],
    screenshots: list[str],
    per_judge: list[dict],
    agg: dict,
) -> dict:
    dim_medians: dict[str, int] = agg["dim_medians"]
    flag_counts: dict[str, int] = agg["flag_counts"]
    n_parsed: int = agg["n_parsed"]
    majority = (n_parsed // 2) + 1  # >= ceil(n/2) e.g. 2 of 3

    weighted_sum = _weighted_overall(dim_medians)

    # --- gates ----------------------------------------------------------
    cap: Optional[float] = None
    gates_triggered: list[str] = []
    gated_dims: set[str] = set()

    liveness = dim_medians["render_liveness"]
    subject = dim_medians["subject_presence_and_recognizability"]

    # >=2/3 judges flagging a failure mode mapped to a gate dimension also fires.
    liveness_flag_modes = {
        "black_frame_ion_auth",
        "starfield_only",
        "gray_unloaded_globe",
    }
    subject_flag_modes = {
        "wrong_subject",
        "missing_required_subject",
        "subject_tiny_speck",
        "camera_inside_geometry",
    }
    liveness_flag_count = sum(flag_counts.get(f, 0) for f in liveness_flag_modes)
    subject_flag_count = sum(flag_counts.get(f, 0) for f in subject_flag_modes)

    if liveness <= 2 or liveness_flag_count >= majority:
        cap = 2.0
        gates_triggered.append("liveness_gate")
        gated_dims.add("render_liveness")
    if subject <= 2 or subject_flag_count >= majority:
        subject_cap = 3.5
        cap = subject_cap if cap is None else min(cap, subject_cap)
        gates_triggered.append("subject_gate")
        gated_dims.add("subject_presence_and_recognizability")

    overall_score = round(min(weighted_sum, cap) if cap is not None else weighted_sum, 1)
    overall_score = max(0.0, min(10.0, overall_score))
    band = _band(overall_score)

    # --- failure flags (consensus >= majority) --------------------------
    failure_flags = sorted(
        flag for flag, count in flag_counts.items() if count >= majority
    )
    blocking_fired = any(f in BLOCKING_FAILURE_FLAGS for f in failure_flags) or bool(
        gated_dims
    )

    # --- status mapping (doc section 2) ---------------------------------
    # blocking failure_flag -> fail; else score>=7 pass, 5-7 needs_review, <5 fail.
    if blocking_fired and failure_flags:
        status = "fail"
    elif overall_score >= 7.0:
        status = "pass"
    elif overall_score >= 5.0:
        status = "needs_review"
    else:
        status = "fail"

    # --- confidence -----------------------------------------------------
    bands = [r.get("band") for r in per_judge if r.get("parsed")]
    overalls = [
        r.get("overall")
        for r in per_judge
        if r.get("parsed") and isinstance(r.get("overall"), (int, float))
    ]
    confidence = _panel_confidence(band, bands, overalls)

    # --- per-dimension output -------------------------------------------
    dimensions: dict[str, dict] = {}
    for dim, score in dim_medians.items():
        dstatus = _dimension_status(score, dim in gated_dims)
        note = _dimension_note(dim, per_judge)
        dimensions[dim] = {"score": score, "status": dstatus, "note": note}

    # --- observations / risks -------------------------------------------
    observations = [
        r["observed"]
        for r in per_judge
        if r.get("parsed") and r.get("observed")
    ]
    risks: list[str] = []
    if failure_flags:
        risks.append("Consensus failure modes: " + ", ".join(failure_flags))
    if gates_triggered:
        risks.append("Gates triggered: " + ", ".join(sorted(set(gates_triggered))))
    if confidence == "low" or band == "BORDERLINE":
        risks.append("Flagged for human review (low confidence or borderline band).")
    if n_parsed < config.n_judges:
        risks.append(
            f"Only {n_parsed}/{config.n_judges} judges returned parseable JSON."
        )

    summary = _build_summary(band, overall_score, status, failure_flags, per_judge)

    return {
        "skill": skill,
        "case_id": case_id,
        "status": status,
        "score": round(overall_score / 10.0, 4),
        "overall_score": overall_score,
        "summary": summary,
        "dimensions": dimensions,
        "failure_flags": failure_flags,
        "observations": observations,
        "risks": risks,
        "screenshots": screenshots,
        "required": True,
        "blocking": True,
        "reviewer": config.reviewer,
        "reviewed_at": reviewed_at,
        "judge": {
            "model": config.model,
            "n_judges": config.n_judges,
            "seeds": seeds,
            "aggregation": "median",
            "protocol_version": PROTOCOL_VERSION,
            "screenshot_input_mode": "attached_image_files",
            "screenshots_attached": len(screenshots),
            "band": band,
            "confidence": confidence,
            "weighted_sum": round(weighted_sum, 3),
            "cap_applied": cap,
            "gates_triggered": sorted(set(gates_triggered)),
            "n_parsed": n_parsed,
            "per_judge": per_judge,
        },
    }


def _panel_confidence(
    overall_band: str, judge_bands: list, overalls: list
) -> str:
    if not judge_bands:
        return "low"
    agree = sum(1 for b in judge_bands if b == overall_band)
    spread = (max(overalls) - min(overalls)) if len(overalls) >= 2 else 0.0
    if agree == len(judge_bands) and spread <= 1.5:
        return "high"
    if agree >= max(1, (len(judge_bands) // 2) + 1) and spread <= 3.0:
        return "medium"
    return "low"


def _dimension_note(dim: str, per_judge: list[dict]) -> str:
    for r in per_judge:
        if not r.get("parsed"):
            continue
        entry = (r.get("dimensions") or {}).get(dim) or {}
        just = entry.get("justification")
        if just:
            return str(just)[:400]
    return ""


def _build_summary(
    band: str,
    overall_score: float,
    status: str,
    failure_flags: list[str],
    per_judge: list[dict],
) -> str:
    parts = [f"{band} ({overall_score}/10, status={status})."]
    rationale = next(
        (r.get("rationale") for r in per_judge if r.get("parsed") and r.get("rationale")),
        None,
    )
    if rationale:
        parts.append(str(rationale)[:500])
    if failure_flags:
        parts.append("Failure modes: " + ", ".join(failure_flags) + ".")
    return " ".join(parts)


def _empty_dimensions(status: str) -> dict:
    return {
        dim: {"score": 0, "status": status, "note": "not assessed"}
        for dim in DIMENSION_WEIGHTS
    }


def _not_reviewed_item(
    *,
    skill: str,
    case_id: str,
    config: JudgeConfig,
    reviewed_at: str,
    seeds: list[int],
    screenshots: list[str],
    reason: str,
) -> dict:
    return {
        "skill": skill,
        "case_id": case_id,
        "status": "not_reviewed",
        "score": None,
        "overall_score": None,
        "summary": f"Not reviewed: {reason}.",
        "dimensions": _empty_dimensions("not_applicable"),
        "failure_flags": [],
        "observations": [],
        "risks": [reason],
        "screenshots": screenshots,
        "required": True,
        "blocking": False,
        "reviewer": config.reviewer,
        "reviewed_at": reviewed_at,
        "judge": {
            "model": config.model,
            "n_judges": config.n_judges,
            "seeds": seeds,
            "aggregation": "median",
            "protocol_version": PROTOCOL_VERSION,
            "screenshot_input_mode": "attached_image_files",
            "screenshots_attached": len(screenshots),
            "per_judge": [],
        },
    }


def _judge_unavailable_item(
    *,
    skill: str,
    case_id: str,
    config: JudgeConfig,
    reviewed_at: str,
    seeds: list[int],
    screenshots: list[str],
    per_judge: list[dict],
) -> dict:
    return {
        "skill": skill,
        "case_id": case_id,
        "status": "needs_review",
        "score": None,
        "overall_score": None,
        "summary": "Judge unavailable: no judge returned a parseable response.",
        "dimensions": _empty_dimensions("needs_review"),
        "failure_flags": [],
        "observations": [],
        "risks": ["All judges failed or returned unparseable output; manual review required."],
        "screenshots": screenshots,
        "required": True,
        "blocking": True,
        "reviewer": config.reviewer,
        "reviewed_at": reviewed_at,
        "judge": {
            "model": config.model,
            "n_judges": config.n_judges,
            "seeds": seeds,
            "aggregation": "median",
            "protocol_version": PROTOCOL_VERSION,
            "screenshot_input_mode": "attached_image_files",
            "screenshots_attached": len(screenshots),
            "per_judge": per_judge,
        },
    }


# --- CLI -----------------------------------------------------------------


def _build_adapter(name: str) -> Adapter:
    if name == "fake":
        # A plausible canned "live, correct" response for smoke runs.
        canned = json.dumps(
            {
                "observed": "A loaded 3D globe with the intended subject centered in frame.",
                "dimensions": {
                    "render_liveness": {"score": 9, "justification": "Loaded textured globe, no black/gray frame.", "failure_modes": []},
                    "subject_presence_and_recognizability": {"score": 8, "justification": "Subject clearly identifiable center-frame.", "failure_modes": []},
                    "framing_and_composition": {"score": 8, "justification": "Subject fills a meaningful, inspectable fraction.", "failure_modes": []},
                    "prompt_and_behavior_fidelity": {"score": 8, "justification": "Viewing geometry matches the prompt.", "failure_modes": []},
                    "visual_correctness_and_artifacts": {"score": 9, "justification": "Clean render, no artifacts.", "failure_modes": []},
                    "legibility_and_clarity": {"score": 8, "justification": "Overlays readable and uncluttered.", "failure_modes": []},
                },
                "failure_modes_detected": [],
                "gates_triggered": [],
                "weighted_sum": 8.3,
                "overall": 8.3,
                "band": "PASS",
                "confidence": "high",
                "rationale": "Live scene with correct, well-framed subject matching the prompt.",
            }
        )
        return FakeAdapter(canned)
    if name == "codex":
        return CodexCliAdapter()
    return OpenCodeCliAdapter()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python3 -m evaluation.framework.judge.static_judge",
        description="Run the static visual judge panel over one render bundle.",
    )
    parser.add_argument("--bundle", required=True, help="Bundle directory with screenshot.png etc.")
    parser.add_argument("--case", required=True, help="Path to the case JSON (scenario metadata).")
    parser.add_argument(
        "--model",
        default="auto",
        help="Judge model id/alias (default: OpenCode GPT-5.5 or Codex CLI default when adapter=codex).",
    )
    parser.add_argument("--n-judges", type=int, default=3, help="Number of panel judges (default: 3).")
    parser.add_argument(
        "--adapter",
        default=default_judge_harness(),
        choices=["opencode", "codex", "fake"],
        help="Adapter to use.",
    )
    parser.add_argument("--emit-item", help="Write the emitted item JSON to this path.")
    args = parser.parse_args(argv)

    case_path = Path(args.case)
    case_meta = json.loads(case_path.read_text(encoding="utf-8"))

    config = JudgeConfig(
        adapter=_build_adapter(args.adapter),
        model=args.model,
        n_judges=args.n_judges,
    )

    item = judge_render(case_meta, args.bundle, config=config)
    payload = json.dumps(item, indent=2)

    if args.emit_item:
        out_path = Path(args.emit_item)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload + "\n", encoding="utf-8")
        print(f"[static-judge] wrote item -> {out_path}", file=sys.stderr)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
