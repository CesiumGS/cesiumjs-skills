#!/usr/bin/env python3
"""
Run CesiumJS eval traces for a tuned skill iteration.

This script expects generated JavaScript snippets to already exist under:

  tuning/<skill>/iterations/<iteration>/traces/<eval-id>-<eval-name>/generated-code.js

It then:
1. Builds eval.html from the target's eval template
2. Serves the repo over localhost so Cesium CDN assets load correctly
3. Executes each eval in headless Chromium via Playwright
4. Captures screenshots, console output, and page errors
5. Runs the eval JSON's programmatic checks

Environment:
  - Set CESIUM_ION_TOKEN to a valid token before running
  - Install Playwright separately, e.g.
      python3 -m venv .venv
      source .venv/bin/activate
      pip install playwright
      python -m playwright install chromium
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
except ImportError as exc:  # pragma: no cover - runtime dependency
    print(
        "Missing dependency: playwright. Install it and the Chromium browser first.\n"
        "Example:\n"
        "  python3 -m venv .venv\n"
        "  source .venv/bin/activate\n"
        "  pip install playwright\n"
        "  python -m playwright install chromium",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class EvalArtifact:
    eval_data: dict[str, Any]
    trace_dir: Path
    code_path: Path
    html_path: Path
    screenshot_paths: list[Path]


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
            raise RuntimeError("Server not started")
        return f"http://127.0.0.1:{self.port}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target_dir",
        help="Path like tuning/cesiumjs-imagery",
    )
    parser.add_argument(
        "--iteration",
        default="000-baseline",
        help="Iteration directory name under iterations/ (default: 000-baseline)",
    )
    parser.add_argument(
        "--only",
        default="",
        help="Comma-separated eval ids to run, e.g. eval-001,eval-002",
    )
    parser.add_argument(
        "--skill-path",
        default="",
        help="Override skill path used in generated prompt files",
    )
    parser.add_argument(
        "--overwrite-html",
        action="store_true",
        help="Regenerate eval.html even if it already exists",
    )
    parser.add_argument(
        "--overwrite-prompts",
        action="store_true",
        help="Regenerate generation-prompt.md even if it already exists",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=60000,
        help="Page navigation timeout in milliseconds",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    with path.open() as fh:
        return json.load(fh)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def trace_dir_name(eval_data: dict[str, Any]) -> str:
    return f"{eval_data['id']}-{eval_data['name']}"


def build_generation_prompt(skill_path: str, eval_data: dict[str, Any], code_path: Path, prompt_path: Path) -> str:
    task = eval_data["prompt"]
    return (
        "You are a CesiumJS developer. You have the following skill document as your reference. "
        "Use it to produce correct code.\n\n"
        f"Read the skill file at: {skill_path}\n\n"
        "Then generate JavaScript code for this task:\n\n"
        f'TASK: "{task}"\n\n'
        "IMPORTANT CONSTRAINTS:\n"
        "- CesiumJS is already loaded globally as `Cesium` via CDN script tag "
        "(use `Cesium.Viewer`, `Cesium.ImageryLayer`, etc. — NOT ES module imports)\n"
        "- A `<div id=\"cesiumContainer\">` already exists in the page with 100% width/height\n"
        "- The Cesium Ion access token is ALREADY SET via `Cesium.Ion.defaultAccessToken` — do NOT set it again\n"
        "- Write ONLY the JavaScript code body — no HTML, no imports, no script tags, no comments explaining what you're doing\n"
        "- The code will run inside an async IIFE, so you can use `await`\n\n"
        f"Write the generated JavaScript to: {code_path}\n\n"
        f"Also save the full prompt you used (this message) to: {prompt_path}\n"
    )


def materialize_eval_html(template: str, ion_token: str, generated_code: str) -> str:
    return (
        template.replace("%%CESIUM_ACCESS_TOKEN%%", ion_token).replace("%%GENERATED_CODE%%", generated_code)
    )


def run_programmatic_checks(
    eval_data: dict[str, Any],
    generated_code: str,
    eval_errors: list[dict[str, Any]],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    for check in eval_data.get("programmatic_checks", []):
        check_type = check["type"]
        passed = False
        detail = ""

        if check_type == "no_console_errors":
            passed = len(eval_errors) == 0
            detail = "errors array is empty" if passed else f"errors array contains {len(eval_errors)} item(s)"
        elif check_type == "code_runs":
            passed = len(eval_errors) == 0
            detail = "no runtime exceptions detected" if passed else "runtime errors captured in page state"
        elif check_type == "pattern_present":
            pattern = check["pattern"]
            match = re.search(pattern, generated_code, re.MULTILINE)
            passed = match is not None
            detail = (
                f"matched {match.group(0)!r} at index {match.start()}"
                if match
                else f"Pattern {pattern!r} not found in generated code"
            )
        elif check_type == "pattern_absent":
            pattern = check["pattern"]
            match = re.search(pattern, generated_code, re.MULTILINE)
            passed = match is None
            detail = (
                f"Pattern {pattern!r} not found in generated code"
                if passed
                else f"Unexpected match {match.group(0)!r} at index {match.start()}"
            )
        else:
            raise ValueError(f"Unsupported check type: {check_type}")

        checks.append(
            {
                "name": check.get("description", check_type),
                "type": check_type,
                **({"pattern": check["pattern"]} if "pattern" in check else {}),
                "passed": passed,
                "detail": detail,
            }
        )

    pass_count = sum(1 for check in checks if check["passed"])
    total_count = len(checks)
    return {
        "eval_id": eval_data["id"],
        "checks": checks,
        "pass_count": pass_count,
        "total_count": total_count,
        "pass_rate": (pass_count / total_count) if total_count else 1.0,
    }


def repo_relative(path: Path) -> str:
    return str(path.resolve().relative_to(REPO_ROOT))


def load_artifacts(
    target_dir: Path,
    iteration: str,
    only_eval_ids: set[str],
    skill_path_override: str,
    overwrite_html: bool,
    overwrite_prompts: bool,
    ion_token: str,
) -> tuple[list[EvalArtifact], str]:
    template_path = target_dir / "eval-template.html"
    template = template_path.read_text()
    search_config = read_json(target_dir / "search-config.json")
    skill_path = skill_path_override or str((REPO_ROOT / search_config["skill_path"]).resolve())
    artifacts: list[EvalArtifact] = []

    for rel_eval_path in search_config["eval_scenarios"]:
        eval_path = target_dir / rel_eval_path
        eval_data = read_json(eval_path)
        if only_eval_ids and eval_data["id"] not in only_eval_ids:
            continue

        trace_dir = target_dir / "iterations" / iteration / "traces" / trace_dir_name(eval_data)
        code_path = trace_dir / "generated-code.js"
        html_path = trace_dir / "eval.html"
        prompt_path = trace_dir / "generation-prompt.md"

        if not code_path.exists():
            raise FileNotFoundError(f"Missing generated code for {eval_data['id']}: {code_path}")

        generated_code = code_path.read_text()
        prompt = build_generation_prompt(skill_path, eval_data, code_path, prompt_path)
        if overwrite_prompts or not prompt_path.exists():
            write_text(prompt_path, prompt)

        if overwrite_html or not html_path.exists():
            html = materialize_eval_html(template, ion_token, generated_code)
            write_text(html_path, html)

        screenshot_paths = [
            trace_dir / f"screenshot-{shot['timing']}.png"
            for shot in eval_data.get("screenshots", [])
        ]
        artifacts.append(
            EvalArtifact(
                eval_data=eval_data,
                trace_dir=trace_dir,
                code_path=code_path,
                html_path=html_path,
                screenshot_paths=screenshot_paths,
            )
        )

    return artifacts, skill_path


def execute_artifact(
    artifact: EvalArtifact,
    base_url: str,
    timeout_ms: int,
) -> dict[str, Any]:
    rel_html = repo_relative(artifact.html_path)
    url = f"{base_url}/{rel_html}"
    console_messages: list[dict[str, Any]] = []
    page_errors: list[dict[str, Any]] = []
    request_failures: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on(
            "console",
            lambda msg: console_messages.append(
                {
                    "type": msg.type,
                    "text": msg.text,
                    "location": msg.location,
                }
            ),
        )
        page.on(
            "pageerror",
            lambda error: page_errors.append({"message": str(error)}),
        )
        page.on(
            "requestfailed",
            lambda request: request_failures.append(
                {
                    "url": request.url,
                    "method": request.method,
                    "failure": request.failure,
                }
            ),
        )

        page.goto(url, wait_until="load", timeout=timeout_ms)

        for shot in artifact.eval_data.get("screenshots", []):
            page.wait_for_timeout(int(shot.get("delay_ms", 5000)))
            out_path = artifact.trace_dir / f"screenshot-{shot['timing']}.png"
            page.screenshot(path=str(out_path))

        eval_errors = page.evaluate("() => window.__evalErrors || []")
        eval_warnings = page.evaluate("() => window.__evalWarnings || []")
        browser.close()

    console_payload = {
        "eval_id": artifact.eval_data["id"],
        "url": url,
        "console_messages": console_messages,
        "page_errors": page_errors,
        "request_failures": request_failures,
        "eval_errors": eval_errors,
        "eval_warnings": eval_warnings,
    }
    write_json(artifact.trace_dir / "console.json", console_payload)

    checks_payload = run_programmatic_checks(
        artifact.eval_data,
        artifact.code_path.read_text(),
        eval_errors,
    )
    write_json(artifact.trace_dir / "programmatic-checks.json", checks_payload)
    return checks_payload


def main() -> int:
    args = parse_args()
    target_dir = (REPO_ROOT / args.target_dir).resolve()
    ion_token = os.environ.get("CESIUM_ION_TOKEN", "").strip()

    if not ion_token:
        print("CESIUM_ION_TOKEN is required", file=sys.stderr)
        return 2

    only_eval_ids = {part.strip() for part in args.only.split(",") if part.strip()}

    artifacts, skill_path = load_artifacts(
        target_dir=target_dir,
        iteration=args.iteration,
        only_eval_ids=only_eval_ids,
        skill_path_override=args.skill_path,
        overwrite_html=args.overwrite_html,
        overwrite_prompts=args.overwrite_prompts,
        ion_token=ion_token,
    )

    if not artifacts:
        print("No evals selected", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "target_dir": str(target_dir),
                "iteration": args.iteration,
                "skill_path": skill_path,
                "eval_count": len(artifacts),
            },
            indent=2,
        )
    )

    with LocalHTTPServer(REPO_ROOT) as server:
        summaries = []
        for artifact in artifacts:
            print(f"Running {artifact.eval_data['id']} ({artifact.eval_data['name']})")
            checks = execute_artifact(
                artifact=artifact,
                base_url=server.base_url,
                timeout_ms=args.timeout_ms,
            )
            summaries.append(
                {
                    "eval_id": artifact.eval_data["id"],
                    "name": artifact.eval_data["name"],
                    "pass_count": checks["pass_count"],
                    "total_count": checks["total_count"],
                    "pass_rate": checks["pass_rate"],
                }
            )

    print(json.dumps({"results": summaries}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
