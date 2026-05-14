#!/usr/bin/env python3
"""Run public CesiumJS skill scenarios against generated JavaScript snippets.

This is the public v1 local runner. It intentionally writes raw generated HTML,
console logs, and screenshots under gitignored output directories.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
import threading
from dataclasses import dataclass
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - optional local dependency
    sync_playwright = None


REPO_ROOT = Path(__file__).resolve().parents[1]
CESIUM_VERSION = "1.139"


@dataclass
class ScenarioRun:
    scenario: dict[str, Any]
    code_path: Path
    run_dir: Path


class LocalHTTPServer:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.httpd: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.port: int | None = None

    def __enter__(self) -> "LocalHTTPServer":
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()

        handler = partial(SimpleHTTPRequestHandler, directory=str(self.root))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.httpd is not None:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self.thread is not None:
            self.thread.join(timeout=2)

    @property
    def base_url(self) -> str:
        if self.port is None:
            raise RuntimeError("server was not started")
        return f"http://127.0.0.1:{self.port}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill", help="Skill id, for example cesiumjs-camera")
    parser.add_argument(
        "--generated-root",
        default="evals/generated",
        help="Directory containing generated JS snippets grouped by skill/iteration",
    )
    parser.add_argument(
        "--iteration",
        default="candidate",
        help="Generated-code iteration under generated-root/<skill>/",
    )
    parser.add_argument(
        "--output-root",
        default="evals/runs",
        help="Gitignored directory for raw run outputs",
    )
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated scenario ids to run, for example eval-001,eval-002",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=60000,
        help="Page navigation timeout in milliseconds",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def scenario_slug(scenario: dict[str, Any]) -> str:
    return f"{scenario['id']}-{scenario['name']}"


def find_code_path(generated_dir: Path, scenario: dict[str, Any]) -> Path:
    exact = generated_dir / f"{scenario['id']}.js"
    if exact.exists():
        return exact
    slug = generated_dir / f"{scenario_slug(scenario)}.js"
    if slug.exists():
        return slug
    exact_display = exact.relative_to(REPO_ROOT)
    slug_display = slug.relative_to(REPO_ROOT)
    raise FileNotFoundError(
        f"Missing generated code for {scenario['id']}. Expected {exact_display} or {slug_display}"
    )


def render_html(ion_token: str, generated_code: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CesiumJS public eval</title>
  <script src="https://cesium.com/downloads/cesiumjs/releases/{CESIUM_VERSION}/Build/Cesium/Cesium.js"></script>
  <link href="https://cesium.com/downloads/cesiumjs/releases/{CESIUM_VERSION}/Build/Cesium/Widgets/widgets.css" rel="stylesheet">
  <style>
    html, body, #cesiumContainer {{
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }}
  </style>
</head>
<body>
  <div id="cesiumContainer"></div>
  <script>
    window.__CESIUM_EVAL_ERRORS__ = [];
    window.addEventListener("error", event => {{
      window.__CESIUM_EVAL_ERRORS__.push({{ message: event.message, source: event.filename, line: event.lineno }});
    }});
    window.addEventListener("unhandledrejection", event => {{
      window.__CESIUM_EVAL_ERRORS__.push({{ message: String(event.reason) }});
    }});
    Cesium.Ion.defaultAccessToken = {json.dumps(ion_token)};
    (async () => {{
      try {{
{generated_code}
      }} catch (error) {{
        window.__CESIUM_EVAL_ERRORS__.push({{ message: error && error.message ? error.message : String(error) }});
        throw error;
      }}
    }})();
  </script>
</body>
</html>
"""


def run_programmatic_checks(
    scenario: dict[str, Any],
    generated_code: str,
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for check in scenario.get("programmatic_checks", []):
        check_type = check["type"]
        passed = False
        detail = ""

        if check_type == "no_console_errors":
            passed = len(errors) == 0
            detail = "no console or page errors captured" if passed else f"{len(errors)} error(s) captured"
        elif check_type == "code_runs":
            passed = len(errors) == 0
            detail = "code completed without captured errors" if passed else "runtime errors captured"
        elif check_type == "pattern_present":
            match = re.search(check["pattern"], generated_code, re.MULTILINE)
            passed = match is not None
            detail = "pattern matched" if passed else "pattern not found"
        elif check_type == "pattern_absent":
            match = re.search(check["pattern"], generated_code, re.MULTILINE)
            passed = match is None
            detail = "pattern not found" if passed else "unexpected pattern matched"
        else:
            raise ValueError(f"Unsupported check type: {check_type}")

        checks.append(
            {
                "type": check_type,
                "description": check.get("description", check_type),
                "passed": passed,
                "detail": detail,
            }
        )

    pass_count = sum(1 for check in checks if check["passed"])
    return {
        "scenario_id": scenario["id"],
        "checks": checks,
        "pass_count": pass_count,
        "total_count": len(checks),
        "pass_rate": pass_count / len(checks) if checks else 1.0,
    }


def load_runs(args: argparse.Namespace) -> list[ScenarioRun]:
    scenarios_dir = REPO_ROOT / "evals" / "scenarios" / args.skill
    if not scenarios_dir.is_dir():
        raise SystemExit(f"Unknown skill or missing scenario directory: {args.skill}")

    only = {item.strip() for item in args.only.split(",") if item.strip()}
    generated_dir = REPO_ROOT / args.generated_root / args.skill / args.iteration
    output_dir = REPO_ROOT / args.output_root / args.skill / args.iteration

    runs: list[ScenarioRun] = []
    for scenario_path in sorted(scenarios_dir.glob("eval-*.json")):
        scenario = load_json(scenario_path)
        if only and scenario["id"] not in only:
            continue
        if scenario.get("runner_mode", "global-js") == "review-only":
            print(f"[run-public-eval] skipping review-only scenario {scenario['id']}")
            continue
        try:
            code_path = find_code_path(generated_dir, scenario)
        except FileNotFoundError as exc:
            raise SystemExit(str(exc)) from exc
        runs.append(
            ScenarioRun(
                scenario=scenario,
                code_path=code_path,
                run_dir=output_dir / scenario_slug(scenario),
            )
        )
    return runs


def main() -> None:
    args = parse_args()
    runs = load_runs(args)
    if not runs:
        raise SystemExit("No runnable scenarios selected")

    if sync_playwright is None:
        print(
            "Missing dependency: playwright. Install locally with:\n"
            "  python3 -m venv .venv\n"
            "  source .venv/bin/activate\n"
            "  pip install playwright\n"
            "  python -m playwright install chromium",
            file=sys.stderr,
        )
        raise SystemExit(2)

    ion_token = os.environ.get("CESIUM_ION_TOKEN")
    if not ion_token:
        raise SystemExit("Set CESIUM_ION_TOKEN before running browser evals")

    with LocalHTTPServer(REPO_ROOT) as server:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for run in runs:
                    generated_code = run.code_path.read_text()
                    run.run_dir.mkdir(parents=True, exist_ok=True)
                    html_path = run.run_dir / "eval.html"
                    html_path.write_text(render_html(ion_token, generated_code))

                    console_messages: list[dict[str, Any]] = []
                    page = browser.new_page(viewport={"width": 1280, "height": 720})
                    page.on(
                        "console",
                        lambda msg: console_messages.append(
                            {"type": msg.type, "text": msg.text}
                        ),
                    )
                    page.goto(
                        f"{server.base_url}/{html_path.relative_to(REPO_ROOT)}",
                        wait_until="networkidle",
                        timeout=args.timeout_ms,
                    )
                    page.wait_for_timeout(
                        max(s["delay_ms"] for s in run.scenario.get("screenshots", [{"delay_ms": 3000}]))
                    )
                    page.screenshot(path=str(run.run_dir / "screenshot.png"), full_page=True)
                    errors = page.evaluate("window.__CESIUM_EVAL_ERRORS__ || []")
                    page.close()

                    write_json(
                        run.run_dir / "console.json",
                        {
                            "scenario_id": run.scenario["id"],
                            "console_messages": console_messages,
                            "errors": errors,
                        },
                    )
                    write_json(
                        run.run_dir / "programmatic-checks.json",
                        run_programmatic_checks(run.scenario, generated_code, errors),
                    )
                    print(f"[run-public-eval] wrote {run.run_dir.relative_to(REPO_ROOT)}")
            finally:
                browser.close()


if __name__ == "__main__":
    main()
