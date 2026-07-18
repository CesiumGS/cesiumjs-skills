#!/usr/bin/env python3
"""Skill Evaluation Console — one local server for the whole CesiumJS skill-quality lifecycle.

It unifies two read surfaces that were previously split across separate tools:

  EVALUATE / REVIEW  — the deterministic + visual scorecard, human review grades,
                       and the focus.json bridge (built by the real ``build_focus``
                       over a scorecard restricted to human-confirmed flags).
  OPTIMIZE / DECIDE  — the self-optimization loop's artifacts: per-skill iteration
                       history, KEEP/REJECT decisions, per-scenario candidate-vs-
                       baseline renders and judge verdicts (via ``optimization_data``).

The scorecard and the optimization artifacts stay the immutable source of truth;
this server only reads them and writes the human focus set. Default port 8933.
"""

from __future__ import annotations

import argparse
import copy
import json
import mimetypes
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

VIEWER_ROOT = Path(__file__).resolve().parent
REPO_ROOT = VIEWER_ROOT.parents[1]
DIST_ROOT = VIEWER_ROOT / "dist"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(VIEWER_ROOT))
from optimization.framework.scorecard_focus import build_focus  # noqa: E402
import insights_data as insd  # noqa: E402
import optimization_data as optd  # noqa: E402

RUN_DIRS = [
    REPO_ROOT / "evaluation" / "artifacts" / "audits",
    REPO_ROOT / "evaluation" / "artifacts" / "scorecards",
]
SCENARIOS_ROOT = REPO_ROOT / "optimization" / "scenarios"


def known_scenario_skills() -> set[str]:
    if not SCENARIOS_ROOT.is_dir():
        return set()
    return {p.name for p in SCENARIOS_ROOT.iterdir() if p.is_dir() and any(p.glob("eval-*.json"))}


# --------------------------------------------------------------------------- #
# Context
# --------------------------------------------------------------------------- #
class ViewerContext:
    def __init__(self, scorecard_path: Path, state_dir: Path | None = None) -> None:
        self.scorecard_path = scorecard_path.resolve()
        self.scorecard = self._load_scorecard(self.scorecard_path)
        self.run_id = str(self.scorecard.get("run_id") or self.scorecard_path.stem)
        self.harness = resolve_harness(self.scorecard, self.scorecard_path)
        artifacts = self.scorecard.get("artifacts") or {}
        judge = artifacts.get("harness_judge") if isinstance(artifacts, dict) else None
        self.harness_judge = str(judge).strip() if isinstance(judge, str) and judge.strip() else ""
        self.set_state_dir(state_dir or self.scorecard_path.parent)

    def set_state_dir(self, state_dir: Path) -> None:
        self.state_dir = state_dir.resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.review_decisions_path = self.state_dir / "review-decisions.json"
        self.optimization_handoff_path = self.state_dir / "optimization-handoff.json"
        self.focus_path = self.state_dir / "focus.json"

    @staticmethod
    def _load_scorecard(path: Path) -> dict[str, Any]:
        if not path.is_file():
            raise FileNotFoundError(f"scorecard does not exist: {path}")
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if not isinstance(value, dict):
            raise ValueError(f"scorecard must be a JSON object: {path}")
        if not isinstance(value.get("cases"), list):
            raise ValueError(f"scorecard is missing a cases array: {path}")
        return value

    def config(self) -> dict[str, str]:
        return {
            "repo_root": str(REPO_ROOT),
            "scorecard_path": str(self.scorecard_path),
            "review_decisions_path": str(self.review_decisions_path),
            "optimization_handoff_path": str(self.optimization_handoff_path),
            "focus_path": str(self.focus_path),
            "run_id": self.run_id,
            "harness": self.harness,
            "harness_judge": self.harness_judge,
        }


# --------------------------------------------------------------------------- #
# Helpers (path-safety, atomic write, focus bridge — proven in evaluation-review)
# --------------------------------------------------------------------------- #
def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def resolve_repo_artifact(path_text: str) -> Path:
    raw = Path(path_text)
    resolved = raw.resolve() if raw.is_absolute() else (REPO_ROOT / raw).resolve()
    if not is_under(resolved, REPO_ROOT):
        raise PermissionError(f"artifact path escapes repository root: {path_text}")
    return resolved


def screenshot_fallback(path: Path) -> Path | None:
    if not path.name.startswith("screenshot"):
        return None
    candidates = [path.with_name(f"screenshot-{i}.png") for i in range(4)]
    candidates.extend(sorted(path.parent.glob("screenshot*.png")))
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(json_bytes(value))
    tmp.replace(path)


def repo_relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _case_key(case: dict[str, Any]) -> str:
    return f"{case.get('skill', '')}/{case.get('case_id', '')}"


def restricted_scorecard(scorecard: dict[str, Any], confirmed_keys: set[str]) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for case in scorecard.get("cases", []):
        if _case_key(case) not in confirmed_keys:
            continue
        case = copy.deepcopy(case)
        vr = case.get("visual_review")
        vr_is_dict = isinstance(vr, dict)
        if vr_is_dict:
            vr["required"] = True
            if str(vr.get("reviewer") or "unassigned") == "unassigned":
                vr["reviewer"] = "human-review"
        det_fail = any(c.get("result") == "fail" for c in case.get("checks", []))
        vis_status = str((vr if vr_is_dict else {}).get("status") or "not_reviewed")
        vis_fail = vr_is_dict and vis_status not in {"pass", "not_required", "not_applicable"}
        if not (det_fail or vis_fail):
            case.setdefault("checks", []).append(
                {
                    "check_id": "human_flagged",
                    "type": "human_review",
                    "category": "human_review",
                    "critical": False,
                    "result": "fail",
                    "weight": 1.0,
                    "tolerance": None,
                    "actual": "flagged",
                    "expected": "pass",
                    "detail": "Flagged during human review.",
                    "metadata": {},
                }
            )
        cases.append(case)
    return {
        "schema_version": scorecard.get("schema_version", "1.0"),
        "run_id": scorecard.get("run_id", ""),
        "git_commit": scorecard.get("git_commit", ""),
        "overall_result": scorecard.get("overall_result", ""),
        "overall_score": scorecard.get("overall_score", 0.0),
        "threshold": scorecard.get("threshold", 0.95),
        "category_scores": scorecard.get("category_scores", {}),
        "visual_summary": scorecard.get("visual_summary", {}),
        "cases": cases,
        "critical_failures": [
            f
            for f in scorecard.get("critical_failures", [])
            if f"{f.get('skill', '')}/{f.get('case_id', '')}" in confirmed_keys
        ],
    }


def build_focus_payload(context: ViewerContext, confirmed_keys: list[str]) -> dict[str, Any]:
    keys = {str(k) for k in confirmed_keys}
    restricted = restricted_scorecard(context.scorecard, keys)
    focus = build_focus(restricted)
    surviving = {f"{c.get('skill', '')}/{c.get('case_id', '')}" for c in focus.get("cases", [])}
    dropped = sorted(keys - surviving)
    known = known_scenario_skills()
    raw_skills = [str(item.get("skill")) for item in focus.get("skills", []) if item.get("skill")]
    skills = [s for s in raw_skills if s in known] if known else raw_skills
    focus_rel = repo_relative(context.focus_path)
    if skills:
        command = (
            "python3 optimization/scripts/run-all-evals.py \\\n"
            f"  --from-focus {focus_rel} \\\n"
            f"  --skills {','.join(skills)}"
        )
    else:
        command = "# No confirmed flags selected for optimization."
    return {
        "focus": focus,
        "command": command,
        "skills": skills,
        "dropped": dropped,
        "case_count": len(focus.get("cases", [])),
        "focus_path": str(context.focus_path),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_handoff_doc(context: ViewerContext, focus_payload: dict[str, Any], selection_mode: str) -> dict[str, Any]:
    focus = focus_payload["focus"]
    by_key = {f"{c.get('skill', '')}/{c.get('case_id', '')}": c for c in context.scorecard.get("cases", [])}

    def verdicts(case: dict[str, Any]) -> tuple[str, str]:
        src = by_key.get(f"{case.get('skill', '')}/{case.get('case_id', '')}", {})
        det = str(src.get("result") or "fail")
        if det not in {"pass", "fail"}:
            det = "fail"
        vis = str((src.get("visual_review") or {}).get("status") or "not_reviewed")
        return det, vis

    case_docs: list[dict[str, Any]] = []
    skill_case_counts: dict[str, int] = {}
    skill_categories: dict[str, set[str]] = {}
    for case in focus.get("cases", []):
        failed_checks = case.get("failed_checks") or []
        first_check = failed_checks[0] if failed_checks else {}
        skill = str(case.get("skill", ""))
        category = str(first_check.get("category", "uncategorized"))
        skill_case_counts[skill] = skill_case_counts.get(skill, 0) + 1
        skill_categories.setdefault(skill, set()).add(category)
        deterministic_result, visual_status = verdicts(case)
        case_docs.append(
            {
                "skill": skill,
                "case_id": str(case.get("case_id", "")),
                "case_name": str(case.get("case_name", "")),
                "category": category,
                "deterministic_result": deterministic_result,
                "visual_status": visual_status,
                "priority": 0,
                "summary": str(first_check.get("detail", case.get("task", ""))),
                "evidence_path": str(case.get("evidence_path", "")),
                "selection_reason": selection_mode,
            }
        )

    skill_docs = []
    for item in focus.get("skills", []):
        skill = str(item.get("skill", ""))
        if not skill:
            continue
        skill_docs.append(
            {
                "skill": skill,
                "failed_cases": skill_case_counts.get(skill, 0),
                "categories": sorted(skill_categories.get(skill, set())),
                "priority": 0,
            }
        )

    return {
        "schema_version": "1.0",
        "run_id": context.run_id,
        "scorecard_path": str(context.scorecard_path),
        "created_at": _now_iso(),
        "selection_mode": selection_mode,
        "focus_path": str(context.focus_path),
        "command": focus_payload["command"],
        "skills": skill_docs,
        "cases": case_docs,
    }


def resolve_harness(scorecard: dict[str, Any], scorecard_path: Path) -> str:
    """Resolve the codegen harness a scorecard was produced with.

    The server is the SOLE inference site (the client never sees a path). Order:
    (1) the additive top-level ``harness`` field when a new run stamped it; else
    (2) a token match on the audit DIRECTORY name, the only legacy signal; else
    (3) the first-class ``unknown`` bucket. The run_id (scorecard-<utc>-<sha>) does
    NOT encode the harness, so it is never parsed, and token-less dirs are never
    silently defaulted to the pipeline default.
    """
    field = scorecard.get("harness")
    if isinstance(field, str) and field.strip():
        return field.strip()
    name = scorecard_path.parent.name.lower()
    if "codex" in name:
        return "codex"
    if "opencode" in name:
        return "opencode"
    if "claude" in name:
        return "claude-code"
    return "unknown"


def run_summary(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            sc = json.load(handle)
    except Exception:
        return None
    if not isinstance(sc, dict) or not isinstance(sc.get("cases"), list):
        return None
    vs = sc.get("visual_summary") or {}
    artifacts = sc.get("artifacts") if isinstance(sc.get("artifacts"), dict) else {}
    cases = sc.get("cases", [])
    det_fail = sum(1 for c in cases if c.get("result") == "fail")
    score = sc.get("overall_score")
    threshold = sc.get("threshold")
    return {
        "run_id": str(sc.get("run_id") or path.stem),
        "scorecard_path": str(path.resolve()),
        "timestamp_utc": str(sc.get("timestamp_utc") or ""),
        "overall_result": str(sc.get("overall_result") or ""),
        "git_commit": str(sc.get("git_commit") or ""),
        "harness": resolve_harness(sc, path),
        # Provenance stamps are additive/optional; null means "not recorded",
        # which the client renders distinctly from any real value (P4).
        "model": artifacts.get("model") if isinstance(artifacts.get("model"), str) else None,
        "model_variant": artifacts.get("model_variant") if isinstance(artifacts.get("model_variant"), str) else None,
        "harness_judge": artifacts.get("harness_judge") if isinstance(artifacts.get("harness_judge"), str) else None,
        "overall_score": float(score) if isinstance(score, (int, float)) else None,
        "threshold": float(threshold) if isinstance(threshold, (int, float)) else None,
        "det_pass_count": len(cases) - det_fail,
        "det_fail_count": det_fail,
        "visual_review_supplied": bool(vs.get("visual_review_supplied", False)),
        "pass_count": int(vs.get("pass_count") or 0),
        "fail_count": int(vs.get("fail_count") or 0),
        "needs_review_count": int(vs.get("needs_review_count") or 0),
        "not_reviewed_count": int(vs.get("not_reviewed_count") or 0),
        "total_cases": int(vs.get("total_cases") or len(cases)),
    }


def run_cases(run_id: str) -> dict[str, Any]:
    """Light per-case rows for one run — the baseline side of a run diff."""
    path = find_run_scorecard(run_id)
    if path is None or not path.is_file():
        raise FileNotFoundError(f"run not found: {run_id}")
    with path.open("r", encoding="utf-8") as handle:
        sc = json.load(handle)
    rows = []
    for case in sc.get("cases", []):
        vr = case.get("visual_review") if isinstance(case.get("visual_review"), dict) else {}
        rows.append(
            {
                "key": _case_key(case),
                "result": case.get("result"),
                "score": case.get("score"),
                "visual_status": vr.get("status") or "not_reviewed",
                "visual_score": vr.get("overall_score", vr.get("score")),
            }
        )
    return {"run_id": run_id, "cases": rows}


def _with_provenance(summary: dict[str, Any], skill: str) -> dict[str, Any]:
    """Attach recorded codegen provenance to an iteration summary (None = unrecorded)."""
    summary["provenance"] = insd.iteration_provenance(skill, str(summary.get("iteration", "")))
    return summary


def skills_with_provenance() -> list[dict[str, Any]]:
    skills = optd.list_skills()
    for skill_overview in skills:
        skill = skill_overview["skill"]
        for summary in skill_overview["history"]:
            _with_provenance(summary, skill)
        if skill_overview.get("latest"):
            _with_provenance(skill_overview["latest"], skill)
    return skills


def list_runs() -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for base in RUN_DIRS:
        if not base.is_dir():
            continue
        for sc_path in sorted(base.glob("*/scorecard.json")):
            key = str(sc_path.resolve())
            if key in seen:
                continue
            seen.add(key)
            summary = run_summary(sc_path)
            if summary:
                runs.append(summary)
    runs.sort(key=lambda r: r["timestamp_utc"], reverse=True)
    return runs


def find_run_scorecard(run_id: str) -> Path | None:
    for run in list_runs():
        if run["run_id"] == run_id:
            return Path(run["scorecard_path"])
    return None


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    context: ViewerContext
    state_dir_override: Path | None = None
    server_version = "SkillEvalConsole/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[eval-console] {self.address_string()} - {fmt % args}", file=sys.stderr)

    # ---- GET ----
    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            route = parsed.path
            query = parse_qs(parsed.query)
            if route == "/api/config":
                self.send_json(self.context.config())
            elif route == "/api/scorecard":
                self.send_json(self.context.scorecard)
            elif route == "/api/review-decisions":
                self.send_json(self.read_optional_json(self.context.review_decisions_path))
            elif route == "/api/runs":
                self.send_json(list_runs())
            elif route == "/api/run-cases":
                self.send_json(run_cases(query.get("run_id", [""])[0]))
            elif route == "/api/registry":
                self.send_json(insd.registry())
            elif route == "/api/insights":
                self.send_json(insd.insights())
            elif route == "/api/artifact":
                self.send_artifact(query.get("path", [""])[0])
            elif route == "/api/optimization/skills":
                self.send_json(skills_with_provenance())
            elif route == "/api/optimization/skill":
                self.send_json(optd.skill_overview(query.get("skill", [""])[0]))
            elif route == "/api/optimization/iteration":
                self.send_json(
                    _with_provenance(
                        optd.iteration_detail(query.get("skill", [""])[0], query.get("iteration", [""])[0]),
                        query.get("skill", [""])[0],
                    )
                )
            elif route == "/api/optimization/active":
                self.send_json(optd.active_runs())
            else:
                self.send_static(route)
        except Exception as exc:  # pragma: no cover
            self.send_error_json(exc)

    # ---- PUT / POST ----
    def do_PUT(self) -> None:  # noqa: N802
        self._mutate()

    def do_POST(self) -> None:  # noqa: N802
        self._mutate()

    def _mutate(self) -> None:
        try:
            route = urlparse(self.path).path
            payload = self.read_json_body()
            if route == "/api/review-decisions":
                write_json_atomic(self.context.review_decisions_path, payload)
                self.send_json(payload)
            elif route == "/api/focus-preview":
                self.send_json(build_focus_payload(self.context, list(payload.get("confirmed_case_keys", []))))
            elif route == "/api/optimization-handoff":
                self.handle_handoff(payload)
            elif route == "/api/select-run":
                self.handle_select_run(payload)
            else:
                self.send_response(HTTPStatus.NOT_FOUND)
                self.end_headers()
        except Exception as exc:  # pragma: no cover
            self.send_error_json(exc)

    def handle_handoff(self, payload: dict[str, Any]) -> None:
        keys = list(payload.get("confirmed_case_keys", []))
        selection_mode = str(payload.get("selection_mode", "confirmed_flags"))
        result = build_focus_payload(self.context, keys)
        write_json_atomic(self.context.focus_path, result["focus"])
        write_json_atomic(self.context.optimization_handoff_path, build_handoff_doc(self.context, result, selection_mode))
        self.send_json(
            {
                "handoff_path": str(self.context.optimization_handoff_path),
                "focus_path": str(self.context.focus_path),
                "command": result["command"],
                "focus_preview": result,
            }
        )

    def handle_select_run(self, payload: dict[str, Any]) -> None:
        run_id = str(payload.get("run_id", ""))
        target = find_run_scorecard(run_id)
        if target is None or not target.is_file():
            raise FileNotFoundError(f"run not found: {run_id}")
        ctx = ViewerContext(target)
        if Handler.state_dir_override is not None:
            ctx.set_state_dir(Handler.state_dir_override / ctx.run_id)
        Handler.context = ctx
        self.send_json(ctx.config())

    # ---- IO helpers ----
    def read_json_body(self) -> Any:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8")) if raw else {}

    @staticmethod
    def read_optional_json(path: Path) -> Any:
        if not path.is_file():
            return None
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def send_json(self, value: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, exc: Exception) -> None:
        if isinstance(exc, FileNotFoundError):
            status = HTTPStatus.NOT_FOUND
        elif isinstance(exc, PermissionError):
            status = HTTPStatus.FORBIDDEN
        elif isinstance(exc, json.JSONDecodeError):
            status = HTTPStatus.BAD_REQUEST
        else:
            status = HTTPStatus.INTERNAL_SERVER_ERROR
        self.send_json({"error": str(exc), "type": type(exc).__name__}, status)

    def send_artifact(self, path_value: str) -> None:
        if not path_value:
            raise FileNotFoundError("missing artifact path")
        path = resolve_repo_artifact(path_value)
        if not path.is_file():
            fallback = screenshot_fallback(path)
            if fallback is None:
                raise FileNotFoundError(f"artifact does not exist: {path_value}")
            path = fallback
        self.send_file(path)

    def send_static(self, request_path: str) -> None:
        if request_path in {"", "/"}:
            static_path = DIST_ROOT / "index.html"
        else:
            relative = Path(unquote(request_path.lstrip("/")))
            static_path = (DIST_ROOT / relative).resolve()
            if not is_under(static_path, DIST_ROOT) or not static_path.is_file():
                static_path = DIST_ROOT / "index.html"
        if not static_path.is_file():
            raise FileNotFoundError(
                f"viewer build not found at {DIST_ROOT}; run `npm install && npm run build` in {VIEWER_ROOT}"
            )
        self.send_file(static_path)

    def send_file(self, path: Path) -> None:
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open the Skill Evaluation Console skill-quality console.")
    parser.add_argument("scorecard", type=Path, help="Path to scorecard.json")
    parser.add_argument("--state-dir", type=Path, help="Directory for review-decisions.json / focus.json")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8933, help="Bind port. Use 0 for an ephemeral port.")
    parser.add_argument("--open", action="store_true", help="Open the system browser after start.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    Handler.state_dir_override = args.state_dir.resolve() if args.state_dir else None
    Handler.context = ViewerContext(args.scorecard.resolve(), args.state_dir)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    host, port = server.server_address[:2]
    url = f"http://{host}:{port}/"
    print(f"Skill Evaluation Console serving {Handler.context.scorecard_path}")
    print(f"Review grades:      {Handler.context.review_decisions_path}")
    print(f"Optimization focus: {Handler.context.focus_path}")
    print(url)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Skill Evaluation Console.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
