#!/usr/bin/env python3
"""
Propose a revised skill based on evaluation history and coverage analysis.

This script:
1. Reads the current best skill content
2. Reads the last decision record
3. Reads per-scenario verdicts and rationales for last N iterations
4. Reads the coverage report
5. Calls the selected agent CLI with a versioned prompt template
6. Outputs candidate skill file, hypothesis, and metadata

Requires the selected agent CLI on PATH (handles auth itself).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from optimization.framework.adapters.agent_cli import (  # noqa: E402
    AgentCLIError,
    AgentCLINotFoundError,
    default_agent_harness,
    default_agent_model,
    default_agent_variant,
    ensure_agent_cli_available,
    invoke_agent,
    resolve_agent_harness,
    resolve_agent_model,
    resolve_agent_variant,
)

ensure_cli_available = ensure_agent_cli_available

DEFAULT_HARNESS = default_agent_harness("proposer")
DEFAULT_MODEL_ID = default_agent_model("proposer", DEFAULT_HARNESS)
DEFAULT_MODEL_VARIANT = default_agent_variant("proposer", DEFAULT_HARNESS)


def load_skill(skill_path: Path) -> str:
    """Load skill markdown content from file."""
    if not skill_path.exists():
        raise FileNotFoundError(f"Skill file not found: {skill_path}")
    return skill_path.read_text(encoding="utf-8")


def load_decision(decision_path: Path) -> dict[str, Any]:
    """Load the last decision record."""
    if not decision_path.exists():
        # No previous decision - return empty baseline
        return {
            "decision": "BASELINE",
            "rule_fired": "initial",
            "rationale": "No previous evaluations",
            "counts": {"wins": 0, "losses": 0, "ties": 0},
        }
    with open(decision_path, encoding="utf-8") as f:
        return json.load(f)


def load_evaluation_history(
    skill: str,
    max_iterations: int,
    results_dir: Path,
    runs_root: Path | None = None,
) -> list[dict[str, Any]]:
    """
    Load per-scenario verdicts, rationales, and checks from the last N iterations.

    Walks ``<runs_root>/<skill>/<iter>/<scenario-slug>/`` (the canonical bundle
    layout the runner writes) for each iteration, reading every bundle's
    ``judge-verdicts.json`` and ``programmatic-checks.json``. ``results_dir``
    is kept for backward compatibility but the layout under it is no longer
    expected to contain consolidated verdict files.

    If ``runs_root`` is ``None``, derives it from ``results_dir`` by replacing
    the trailing ``results`` component with ``runs`` (e.g. ``optimization/results`` ->
    ``optimization/runs``), falling back to ``optimization/runs`` when no parent matches.

    Returns list of iteration records, each with:
    - iteration: iteration number (e.g. "001")
    - scenarios: list of {eval_id, verdict, rationale, checks}
    """
    history: list[dict[str, Any]] = []

    if runs_root is None:
        if results_dir.name == "results" and results_dir.parent != Path("."):
            runs_root = results_dir.parent / "runs"
        else:
            runs_root = Path("optimization/runs")

    runs_skill_root = runs_root / skill
    if not runs_skill_root.exists():
        return history

    iteration_dirs = sorted(
        [d for d in runs_skill_root.iterdir() if d.is_dir() and d.name.isdigit()],
        key=lambda d: int(d.name),
        reverse=True,  # newest first
    )

    for iteration_dir in iteration_dirs[:max_iterations]:
        iteration_name = iteration_dir.name
        scenarios: list[dict[str, Any]] = []

        for bundle_dir in sorted(iteration_dir.iterdir()):
            if not bundle_dir.is_dir():
                continue

            judge_path = bundle_dir / "judge-verdicts.json"
            checks_path = bundle_dir / "programmatic-checks.json"
            if not judge_path.exists():
                continue

            try:
                judge_data = json.loads(judge_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue

            eval_id = judge_data.get("scenario_id", bundle_dir.name.split("-", 1)[0])
            verdict = judge_data.get("verdict") or "TIE"
            individual = judge_data.get("individual_verdicts", []) or []
            rationale = ""
            for entry in individual:
                if entry.get("rationale"):
                    rationale = entry["rationale"]
                    break

            checks: list[dict[str, Any]] = []
            if checks_path.exists():
                try:
                    checks_data = json.loads(checks_path.read_text(encoding="utf-8"))
                    checks = checks_data.get("checks", []) or []
                except json.JSONDecodeError:
                    pass

            scenarios.append({
                "eval_id": eval_id,
                "verdict": verdict,
                "rationale": rationale,
                "checks": checks,
            })

        if scenarios:
            history.append({
                "iteration": iteration_name,
                "scenarios": scenarios,
            })

    return history


def load_coverage(coverage_path: Path, skill: str) -> dict[str, Any]:
    """Load coverage analysis for the specified skill."""
    if not coverage_path.exists():
        return {
            "uncovered_sections": [],
            "uncovered_apis": [],
        }

    with open(coverage_path, encoding="utf-8") as f:
        coverage = json.load(f)

    skill_coverage = coverage.get("skills", {}).get(skill, {})
    return {
        "uncovered_sections": skill_coverage.get("uncovered_sections", []),
        "uncovered_apis": skill_coverage.get("uncovered_apis", []),
    }


def format_evaluation_history(history: list[dict[str, Any]]) -> str:
    """Format evaluation history for prompt."""
    if not history:
        return "No evaluation history available."

    lines = []
    for iteration in history:
        iter_name = iteration["iteration"]
        lines.append(f"### Iteration {iter_name}\n")

        for scenario in iteration["scenarios"]:
            eval_id = scenario["eval_id"]
            verdict = scenario["verdict"]
            rationale = scenario["rationale"]
            checks = scenario["checks"]

            # Format check results
            check_status = "all passing" if all(c.get("result") == "pass" for c in checks) else "some failures"
            failed_checks = [c for c in checks if c.get("result") == "fail"]

            lines.append(f"**{eval_id}** - Verdict: {verdict}")
            lines.append(f"Checks: {check_status}")
            if failed_checks:
                for check in failed_checks:
                    lines.append(f"  - FAIL: {check.get('type')} - {check.get('detail', '')}")
            lines.append(f"Rationale: {rationale}")
            lines.append("")

        lines.append("---\n")

    return "\n".join(lines)


def format_coverage_gaps(coverage: dict[str, Any]) -> tuple[str, str]:
    """Format uncovered sections and APIs for prompt."""
    sections = coverage.get("uncovered_sections", [])
    apis = coverage.get("uncovered_apis", [])

    section_list = "\n".join(f"- {s}" for s in sections[:20])  # Limit to top 20
    if len(sections) > 20:
        section_list += f"\n... and {len(sections) - 20} more"

    api_list = "\n".join(f"- {a}" for a in apis[:30])  # Limit to top 30
    if len(apis) > 30:
        api_list += f"\n... and {len(apis) - 30} more"

    return section_list or "None", api_list or "None"


def build_prompt(
    template_path: Path,
    current_skill: str,
    decision: dict[str, Any],
    history: list[dict[str, Any]],
    coverage: dict[str, Any],
) -> str:
    """Build the proposer prompt from template and inputs."""
    template = template_path.read_text(encoding="utf-8")

    # Format coverage gaps
    uncovered_sections, uncovered_apis = format_coverage_gaps(coverage)

    # Format evaluation history
    history_text = format_evaluation_history(history)

    # Fill template
    prompt = template.format(
        current_skill=current_skill,
        last_decision=decision.get("decision", "UNKNOWN"),
        last_rule=decision.get("rule_fired", "unknown"),
        last_rationale=decision.get("rationale", "No rationale provided"),
        wins=decision.get("counts", {}).get("wins", 0),
        losses=decision.get("counts", {}).get("losses", 0),
        ties=decision.get("counts", {}).get("ties", 0),
        history_count=len(history),
        evaluation_history=history_text,
        uncovered_section_count=len(coverage.get("uncovered_sections", [])),
        uncovered_sections=uncovered_sections,
        uncovered_api_count=len(coverage.get("uncovered_apis", [])),
        uncovered_apis=uncovered_apis,
    )

    return prompt


def _strip_preamble(text: str) -> str:
    """Strip any thinking/analysis preamble before the YAML frontmatter.

    When tools are enabled the model often narrates its research before
    writing the skill. SKILL.md must start with the YAML frontmatter
    delimiter (`---`) so the agent-skills loader can parse it. We locate
    the first `---` line whose YAML block contains `name:` or
    `description:` and discard everything before it.
    """
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.strip() != "---":
            continue
        # Peek up to 6 lines after the delimiter for a frontmatter field.
        block = lines[i + 1 : i + 7]
        if any(
            l.strip().startswith("name:") or l.strip().startswith("description:")
            for l in block
        ):
            return "\n".join(lines[i:])
    return text


def call_proposer(
    prompt: str,
    model_id: str | None,
    model_variant: str | None,
    temperature: float,
    harness: str | None = None,
) -> str:
    """Invoke the configured agent harness with the proposer prompt.

    Grants read-only local research tools so the proposer can perform the
    research pass described in the prompt template — cross-checking related
    skills, recent run artifacts, and repo docs before proposing edits.
    The `temperature` argument is recorded in metadata for reproducibility but
    is not exposed by the CLI; the CLI uses its own defaults.
    """
    try:
        research_dirs = [
            path
            for path in ["skills", "optimization", "wiki"]
            if Path(path).exists()
        ]
        resolved_harness = resolve_agent_harness(harness, "proposer")
        raw = invoke_agent(
            prompt=prompt,
            harness=resolved_harness,
            role="proposer",
            model=model_id,
            variant=model_variant,
            allowed_tools=["Read", "Grep", "Glob"],
            add_dirs=research_dirs,
            title="skill optimization proposer",
        )
        return _strip_preamble(raw)
    except AgentCLIError as e:
        raise RuntimeError(f"Proposer CLI call failed: {e}") from e


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def write_outputs(
    output_dir: Path,
    candidate_skill: str,
    hypothesis: str,
    metadata: dict[str, Any],
) -> None:
    """Write candidate skill, hypothesis, and metadata to output directory."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Write candidate skill
    skill_path = output_dir / "SKILL.md"
    skill_path.write_text(candidate_skill, encoding="utf-8")

    # Write hypothesis
    hypothesis_path = output_dir / "hypothesis.md"
    hypothesis_path.write_text(hypothesis, encoding="utf-8")

    # Write metadata
    metadata_path = output_dir / "proposer-metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"Candidate skill written to: {skill_path}")
    print(f"Hypothesis written to: {hypothesis_path}")
    print(f"Metadata written to: {metadata_path}")


def generate_hypothesis(
    decision: dict[str, Any],
    history: list[dict[str, Any]],
    coverage: dict[str, Any],
) -> str:
    """
    Generate a hypothesis document describing the proposed changes.

    This is a simple summary of the evidence that motivated the proposal.
    The actual changes are in the candidate skill itself.
    """
    lines = [
        "# Candidate Skill Hypothesis",
        "",
        "## Motivation",
        "",
        f"Last decision: {decision.get('decision', 'UNKNOWN')}",
        f"Rule fired: {decision.get('rule_fired', 'unknown')}",
        f"Counts: {decision.get('counts', {})}",
        "",
        "### Last Decision Rationale",
        "",
        decision.get("rationale", "No rationale provided"),
        "",
    ]

    # Summarize losses from history
    if history:
        lines.append("## Recent Evaluation Losses")
        lines.append("")

        losses_found = False
        for iteration in history:
            iter_losses = [
                s for s in iteration["scenarios"]
                if s["verdict"] == "BASELINE"  # BASELINE won means CANDIDATE lost
            ]
            if iter_losses:
                losses_found = True
                lines.append(f"### Iteration {iteration['iteration']}")
                for scenario in iter_losses:
                    lines.append(f"- **{scenario['eval_id']}**: {scenario['rationale'][:200]}...")
                lines.append("")

        if not losses_found:
            lines.append("No significant losses in recent history.")
            lines.append("")

    # Summarize coverage gaps
    uncovered_sections = coverage.get("uncovered_sections", [])
    uncovered_apis = coverage.get("uncovered_apis", [])

    if uncovered_sections or uncovered_apis:
        lines.append("## Coverage Gaps")
        lines.append("")
        lines.append(f"- {len(uncovered_sections)} uncovered sections")
        lines.append(f"- {len(uncovered_apis)} uncovered APIs")
        lines.append("")
        lines.append("Note: Coverage gaps are informational. The proposer should only add content if it addresses specific evaluation failures.")
        lines.append("")

    lines.append("## Proposed Changes")
    lines.append("")
    lines.append("The candidate skill has been revised to address the above evidence.")
    lines.append("Specific changes are embedded in the skill markdown itself.")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Propose a revised skill based on evaluation history and coverage analysis."
    )
    parser.add_argument("skill", help="Skill name (e.g., cesiumjs-camera)")
    parser.add_argument(
        "--skill-path",
        type=Path,
        help="Path to current best skill file (default: skills/<skill>/SKILL.md)",
    )
    parser.add_argument(
        "--decision-path",
        type=Path,
        help="Path to last decision record (default: optimization/results/<skill>/latest/decision.json)",
    )
    parser.add_argument(
        "--results-dir",
        type=Path,
        default=Path("optimization/results"),
        help="Directory containing evaluation results (default: optimization/results)",
    )
    parser.add_argument(
        "--coverage-path",
        type=Path,
        default=Path("optimization/results/coverage.json"),
        help="Path to coverage report (default: optimization/results/coverage.json)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Output directory for candidate (default: optimization/candidates/<skill>/<iteration>)",
    )
    parser.add_argument(
        "--iteration",
        help="Iteration number (default: auto-increment from last)",
    )
    parser.add_argument(
        "--max-history",
        type=int,
        default=3,
        help="Maximum number of iterations to include in history (default: 3)",
    )
    parser.add_argument(
        "--harness",
        default=DEFAULT_HARNESS,
        choices=["opencode", "codex"],
        help="Agent CLI harness for proposer (default: env or opencode)",
    )
    parser.add_argument(
        "--model-id",
        default=DEFAULT_MODEL_ID,
        help="Model ID for proposer (default: OpenCode GPT-5.5, or Codex CLI default when harness=codex)",
    )
    parser.add_argument(
        "--model-variant",
        default=DEFAULT_MODEL_VARIANT,
        help="Model variant/reasoning effort (used by OpenCode; ignored by Codex unless configured externally)",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=1.0,
        help="Temperature for proposer model (default: 1.0)",
    )
    parser.add_argument(
        "--prompt-version",
        default="propose-v1",
        help="Prompt template version (default: propose-v1)",
    )

    args = parser.parse_args()
    args.harness = resolve_agent_harness(args.harness, "proposer")
    args.model_id = resolve_agent_model(args.model_id, "proposer", args.harness)
    args.model_variant = resolve_agent_variant(args.model_variant, "proposer", args.harness)

    # Ensure the selected CLI is available — proposer calls it directly.
    try:
        ensure_cli_available(args.harness, "proposer")
    except AgentCLINotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Resolve paths
    skill_path = args.skill_path or Path(f"skills/{args.skill}/SKILL.md")
    decision_path = args.decision_path or Path(f"optimization/results/{args.skill}/latest/decision.json")

    # Determine iteration number
    if args.iteration:
        iteration = args.iteration
    else:
        # Auto-increment from last iteration
        candidates_dir = Path(f"optimization/candidates/{args.skill}")
        if candidates_dir.exists():
            existing = sorted([d.name for d in candidates_dir.iterdir() if d.is_dir()])
            if existing:
                last = existing[-1].split("-")[0]  # Extract number from "NNN-name"
                try:
                    iteration = f"{int(last) + 1:03d}"
                except ValueError:
                    iteration = "001"
            else:
                iteration = "001"
        else:
            iteration = "001"

    output_dir = args.output_dir or Path(f"optimization/candidates/{args.skill}/{iteration}")

    # Load inputs
    print(f"Loading skill from: {skill_path}")
    current_skill = load_skill(skill_path)

    print(f"Loading decision from: {decision_path}")
    decision = load_decision(decision_path)

    print(f"Loading evaluation history (last {args.max_history} iterations)")
    history = load_evaluation_history(args.skill, args.max_history, args.results_dir)

    print(f"Loading coverage from: {args.coverage_path}")
    coverage = load_coverage(args.coverage_path, args.skill)

    # Build prompt
    template_path = Path(f"optimization/framework/proposer/prompts/{args.prompt_version}.txt")
    if not template_path.exists():
        print(f"Error: Prompt template not found: {template_path}", file=sys.stderr)
        return 1

    print(f"Building prompt from template: {template_path}")
    prompt = build_prompt(template_path, current_skill, decision, history, coverage)

    # Call proposer through the selected agent harness.
    display_model = args.model_id or f"{args.harness}-default"
    print(
        f"Calling proposer (harness={args.harness}, model={display_model}, "
        f"variant={args.model_variant}, temperature={args.temperature})..."
    )
    candidate_skill = call_proposer(
        prompt,
        args.model_id,
        args.model_variant,
        args.temperature,
        harness=args.harness,
    )

    # Generate hypothesis
    hypothesis = generate_hypothesis(decision, history, coverage)

    # Prepare metadata
    metadata = {
        "skill": args.skill,
        "iteration": iteration,
        "harness": args.harness,
        "model_id": display_model,
        "model_variant": args.model_variant,
        "temperature": args.temperature,
        "prompt_version": args.prompt_version,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "current_skill_hash": compute_content_hash(current_skill),
        "candidate_skill_hash": compute_content_hash(candidate_skill),
        "decision_summary": {
            "decision": decision.get("decision"),
            "rule_fired": decision.get("rule_fired"),
            "counts": decision.get("counts"),
        },
        "history_iterations": len(history),
        "uncovered_sections_count": len(coverage.get("uncovered_sections", [])),
        "uncovered_apis_count": len(coverage.get("uncovered_apis", [])),
    }

    # Write outputs
    write_outputs(output_dir, candidate_skill, hypothesis, metadata)

    print(f"\nProposal complete for iteration {iteration}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
