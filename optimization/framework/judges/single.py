"""Single pairwise judge for CesiumJS skills evaluation.

This module implements a single judge that compares baseline and candidate
evidence pairwise and returns a structured verdict. The judge runs through
the selected local agent CLI, which handles provider authentication itself.

    The judge attaches browser screenshot PNGs to the agent CLI and uses direct
    visual inspection as the primary qualitative comparison signal, with
    deterministic checks, console output, and scene state as corroboration.
"""

import json
import random
from pathlib import Path
from typing import Any, Dict, List

from optimization.framework.adapters.agent_cli import (
    AgentCLIError,
    AgentCLINotFoundError,
    ensure_agent_cli_available,
    invoke_agent,
    resolve_agent_harness,
    resolve_agent_model,
    resolve_agent_variant,
)
from optimization.framework.adapters.opencode_cli import (  # compatibility for older callers/tests
    OpenCodeCLIError,
    OpenCodeCLINotFoundError,
)

ensure_cli_available = ensure_agent_cli_available
invoke_opencode = invoke_agent


def judge(
    scenario: Dict[str, Any],
    baseline_bundle: Dict[str, Any],
    candidate_bundle: Dict[str, Any],
    judge_model_id: str | None,
    judge_protocol_version: str = 'pairwise-v1',
    seed: int = 42,
    *,
    judge_harness: str | None = None,
    judge_model_variant: str | None = None,
) -> Dict[str, Any]:
    """
    Compare baseline and candidate evidence pairwise and return a structured verdict.

    Args:
        scenario: The scenario manifest dict
        baseline_bundle: Dict with keys: 'path' (str, bundle directory path)
        candidate_bundle: Dict with keys: 'path' (str, bundle directory path)
        judge_model_id: Optional model ID.
        judge_harness: Optional agent CLI harness, ``opencode`` or ``codex``.
        judge_model_variant: Optional model variant/reasoning effort.
        judge_protocol_version: Protocol version (e.g., 'pairwise-v1')
        seed: Random seed for label randomization

    Returns:
        Dict with keys:
            - verdict: 'BASELINE' | 'CANDIDATE' | 'TIE'
            - rationale: str explanation
            - model_id: str
            - protocol_version: str
            - label_mapping: dict showing which bundle was presented as A vs B
            - seed: int

    Raises:
        AgentCLINotFoundError: If the selected CLI is not on PATH.
        ValueError: If required files are missing or invalid.
        RuntimeError: If the CLI call fails.
    """
    resolved_harness = resolve_agent_harness(judge_harness, "judge")
    ensure_cli_available(resolved_harness, "judge")
    resolved_model_id = resolve_agent_model(judge_model_id, "judge", resolved_harness)
    resolved_model_variant = resolve_agent_variant(judge_model_variant, "judge", resolved_harness)

    # Validate protocol version
    if judge_protocol_version != 'pairwise-v1':
        raise ValueError(
            f"Unsupported protocol version: {judge_protocol_version}. "
            "Only 'pairwise-v1' is currently supported."
        )

    # Load prompt template
    prompt_path = Path(__file__).parent / 'prompts' / f'{judge_protocol_version}.txt'
    if not prompt_path.exists():
        raise ValueError(f"Prompt template not found: {prompt_path}")

    with open(prompt_path, 'r') as f:
        prompt_template = f.read()

    # Randomize which side is A vs B
    rng = random.Random(seed)
    if rng.random() < 0.5:
        bundle_a = baseline_bundle
        bundle_b = candidate_bundle
        label_mapping = {'A': 'BASELINE', 'B': 'CANDIDATE'}
    else:
        bundle_a = candidate_bundle
        bundle_b = baseline_bundle
        label_mapping = {'A': 'CANDIDATE', 'B': 'BASELINE'}

    # Load evidence from bundles (this validates that bundles exist and have screenshots)
    evidence_a = _load_evidence(bundle_a['path'])
    evidence_b = _load_evidence(bundle_b['path'])
    screenshot_files = evidence_a['screenshots'] + evidence_b['screenshots']

    # Format prompt
    prompt = _format_prompt(
        prompt_template,
        scenario,
        evidence_a,
        evidence_b,
    )

    try:
        response_text = invoke_opencode(
            prompt=prompt,
            harness=resolved_harness,
            role="judge",
            model=resolved_model_id,
            variant=resolved_model_variant,
            files=screenshot_files,
            disable_tools=True,
            title=f"{scenario['id']} pairwise judge",
        )
    except AgentCLIError as e:
        raise RuntimeError(f"Judge CLI call failed: {e}") from e

    verdict_json = _parse_verdict(response_text)

    ab_verdict = verdict_json['verdict']
    if ab_verdict == 'TIE':
        final_verdict = 'TIE'
    elif ab_verdict in ('A', 'B'):
        final_verdict = label_mapping[ab_verdict]
    else:
        raise ValueError(f"Invalid verdict value: {ab_verdict}")

    return {
        'verdict': final_verdict,
        'rationale': verdict_json['rationale'],
        'harness': resolved_harness,
        'model_id': resolved_model_id or f"{resolved_harness}-default",
        'model_variant': resolved_model_variant,
        'screenshot_input_mode': 'attached_image_files',
        'screenshots_attached': len(screenshot_files),
        'protocol_version': judge_protocol_version,
        'label_mapping': label_mapping,
        'seed': seed
    }


def _load_evidence(bundle_path: str) -> Dict[str, Any]:
    """
    Load all evidence files from a bundle directory.

    Args:
        bundle_path: Path to bundle directory

    Returns:
        Dict with keys: console, checks, scene_state, screenshots (list of paths)
    """
    bundle_dir = Path(bundle_path)

    if not bundle_dir.exists():
        raise ValueError(f"Bundle directory not found: {bundle_path}")

    console_path = bundle_dir / 'console.json'
    if not console_path.exists():
        raise ValueError(f"console.json not found in bundle: {bundle_path}")
    with open(console_path, 'r') as f:
        console_data = json.load(f)

    checks_path = bundle_dir / 'programmatic-checks.json'
    if not checks_path.exists():
        raise ValueError(f"programmatic-checks.json not found in bundle: {bundle_path}")
    with open(checks_path, 'r') as f:
        checks_data = json.load(f)

    scene_state_path = bundle_dir / 'scene-state.json'
    if scene_state_path.exists():
        with open(scene_state_path, 'r') as f:
            scene_state_data = json.load(f)
    else:
        scene_state_data = {"available": False}

    screenshots = sorted(bundle_dir.glob('screenshot*.png'))

    if not screenshots:
        raise ValueError(f"No screenshots found in bundle: {bundle_path}")

    return {
        'console': console_data,
        'checks': checks_data,
        'scene_state': scene_state_data,
        'screenshots': [str(s.resolve()) for s in screenshots]
    }


def _format_prompt(
    template: str,
    scenario: Dict[str, Any],
    evidence_a: Dict[str, Any],
    evidence_b: Dict[str, Any]
) -> str:
    """Format the prompt template with scenario and evidence data."""
    expected_behaviors = '\n'.join(
        f"- {behavior}" for behavior in scenario.get('expected_behaviors', [])
    )

    console_a_str = _format_console(evidence_a['console'])
    console_b_str = _format_console(evidence_b['console'])

    checks_a_str = _format_checks(evidence_a['checks'])
    checks_b_str = _format_checks(evidence_b['checks'])

    scene_state_a_str = json.dumps(evidence_a['scene_state'], indent=2)
    scene_state_b_str = json.dumps(evidence_b['scene_state'], indent=2)

    # Render screenshot paths so the CLI agent can Read them itself.
    screenshots_a_str = _describe_screenshots(evidence_a['screenshots'], side='A')
    screenshots_b_str = _describe_screenshots(evidence_b['screenshots'], side='B')

    prompt = template.format(
        scenario_id=scenario['id'],
        scenario_name=scenario['name'],
        scenario_description=scenario['description'],
        scenario_prompt=scenario['prompt'],
        expected_behaviors=expected_behaviors,
        visual_expectations=scenario.get('visual_expectations', 'N/A'),
        screenshots_a=screenshots_a_str,
        console_a=console_a_str,
        checks_a=checks_a_str,
        scene_state_a=scene_state_a_str,
        screenshots_b=screenshots_b_str,
        console_b=console_b_str,
        checks_b=checks_b_str,
        scene_state_b=scene_state_b_str
    )

    return prompt


def _describe_screenshots(paths: List[str], side: str) -> str:
    """Render screenshot artifact paths for traceability."""
    if not paths:
        return f"(no screenshots captured for Candidate {side})"
    lines = []
    for idx, path in enumerate(paths):
        lines.append(f"- Candidate {side}, frame {idx + 1}: {path}")
    return '\n'.join(lines)


def _format_console(console_data: Dict[str, Any]) -> str:
    """Format console data as a readable string."""
    errors = console_data.get('errors', [])
    messages = console_data.get('console_messages', [])

    parts = []

    if errors:
        parts.append(f"**Errors ({len(errors)})**:")
        for err in errors[:5]:
            parts.append(f"  - {err.get('text', err.get('message', 'Unknown error'))}")
        if len(errors) > 5:
            parts.append(f"  ... and {len(errors) - 5} more errors")
    else:
        parts.append("**Errors**: None")

    if messages:
        parts.append(f"\n**Console Messages ({len(messages)})**:")
        for msg in messages[:10]:
            parts.append(f"  - [{msg.get('type', 'log')}] {msg.get('text', '')}")
        if len(messages) > 10:
            parts.append(f"  ... and {len(messages) - 10} more messages")
    else:
        parts.append("\n**Console Messages**: None")

    return '\n'.join(parts)


def _format_checks(checks_data: Dict[str, Any]) -> str:
    """Format programmatic checks as a readable string."""
    checks = checks_data.get('checks', [])

    if not checks:
        return "No programmatic checks"

    parts = []
    for check in checks:
        status = "PASS" if check.get('result') == 'pass' else "FAIL"
        parts.append(
            f"[{status}] {check.get('check_id', check.get('type'))} ({check.get('type')}): {check.get('detail', '')}"
        )

    summary = checks_data.get('summary', {})
    total = summary.get('total', 0)
    passed = summary.get('passed', 0)
    failed = summary.get('failed', 0)

    parts.append(f"\n**Summary**: {passed}/{total} passed, {failed} failed")

    return '\n'.join(parts)


def _parse_verdict(response_text: str) -> Dict[str, Any]:
    """
    Parse the judge's response to extract verdict and rationale.

    Args:
        response_text: Raw response from judge CLI

    Returns:
        Dict with 'verdict' and 'rationale' keys

    Raises:
        ValueError: If response cannot be parsed
    """
    # First try: direct JSON parse
    try:
        verdict = json.loads(response_text.strip())
        if 'verdict' in verdict and 'rationale' in verdict:
            if verdict['verdict'] not in ('A', 'B', 'TIE'):
                raise ValueError(f"Invalid verdict value: {verdict['verdict']}")
            return verdict
    except json.JSONDecodeError:
        pass

    # Second try: extract from code block
    if '```json' in response_text:
        start = response_text.find('```json') + 7
        end = response_text.find('```', start)
        if end > start:
            json_str = response_text[start:end].strip()
            try:
                verdict = json.loads(json_str)
                if 'verdict' in verdict and 'rationale' in verdict:
                    if verdict['verdict'] not in ('A', 'B', 'TIE'):
                        raise ValueError(f"Invalid verdict value: {verdict['verdict']}")
                    return verdict
            except json.JSONDecodeError:
                pass

    # Third try: regex match for inline JSON
    import re
    json_pattern = r'\{[^}]*"verdict"[^}]*"rationale"[^}]*\}'
    matches = re.findall(json_pattern, response_text, re.DOTALL)
    for match in matches:
        try:
            verdict = json.loads(match)
            if 'verdict' in verdict and 'rationale' in verdict:
                if verdict['verdict'] not in ('A', 'B', 'TIE'):
                    raise ValueError(f"Invalid verdict value: {verdict['verdict']}")
                return verdict
        except json.JSONDecodeError:
            continue

    raise ValueError(
        f"Could not parse verdict from judge response. "
        f"Response must contain JSON with 'verdict' and 'rationale' keys. "
        f"Got: {response_text[:200]}"
    )
