# PRD: Cesium AI Evaluation Framework

## 1. Introduction / Overview

The Cesium AI Evaluation Framework measures how effectively AI coding agents generate, revise, and reason about CesiumJS code when guided by skill documents. It exists to (a) catch regressions whenever a skill, prompt, model, or example changes, and (b) drive a **fully autonomous** improvement loop that proposes skill changes, evaluates them, and decides whether to keep them — without requiring a maintainer in the loop.

The framework's first concrete target is the `CesiumGS/cesiumjs-skills` repository. Skill evaluations execute generated JavaScript in a browser-backed Cesium scene, capture evidence, run deterministic checks, and use a three-judge pairwise A/B/TIE protocol for visual comparison. The architecture preserves a clean extension point for future MCP/tool-call evaluations.

A maintainer **may** opt in to review specific decisions, but routine operation requires no human gate. Tie outcomes, regressions, and accept/reject decisions all resolve deterministically.

## 2. Goals

- Detect regressions in generated CesiumJS output triggered by changes to skills, docs, examples, models, or APIs — before publication.
- Run an autonomous iteration loop: propose a candidate skill change → evaluate against a frozen scenario set → decide → record → propose the next iteration, with no required human intervention.
- Produce reproducible, public-safe evidence (manifests, sanitized summaries, curated screenshots, decision records) that contributors can inspect without access to private traces or credentials.
- Keep deterministic correctness gates cheap enough to run on every PR; reserve expensive multi-judge visual suites for scheduled or release workflows.
- Provide a designed extension point for MCP/tool-call evaluation without blocking skills-first delivery.
- Make every keep/reject decision auditable by separating deterministic decision policy from numeric report scores.

## 3. User Stories

### US-001: Scenario manifest schema and validator
**Description:** As an evaluator (human or agent), I need a versioned JSON schema for scenarios so every scenario is machine-checkable and reviewable.

**Acceptance Criteria:**
- [ ] `optimization/schemas/scenario.schema.json` exists with required fields: `id`, `name`, `difficulty`, `description`, `prompt`, `expected_behaviors`, `visual_expectations`, `programmatic_checks`, `screenshots`, `regression_critical`, optional `runner_mode`.
- [ ] `optimization/scripts/validate-evals.py` validates every manifest under `optimization/scenarios/<skill>/*.json` against the schema.
- [ ] Validator fails the build on missing required fields, invalid `runner_mode` values, or malformed check specs.
- [ ] CLI exits non-zero on any validation failure; prints actionable diagnostics.

### US-002: Frozen scenario catalog with re-baseline rule
**Description:** As the framework, I need scenarios to be frozen within a comparison window so candidate-vs-baseline judgments are fair.

**Acceptance Criteria:**
- [ ] Scenario manifests carry a `version` (or content hash) recorded with each run.
- [ ] When a scenario's version changes, the next run for that scenario flags itself as "re-baseline required" and is excluded from win/loss totals until re-baselined.
- [ ] A documented procedure (script or CLI) marks a scenario as re-baselined and updates `optimization/results/public-status.json` accordingly.

### US-003: Agent adapter for skills mode
**Description:** As the runner, I need to invoke an AI agent with a candidate skill context and a scenario prompt so I can capture the generated CesiumJS output.

**Acceptance Criteria:**
- [ ] Adapter takes inputs: scenario id, candidate skill path, model id, temperature/generation settings.
- [ ] Outputs: generated JS body saved to `optimization/generated/<skill>/<iteration>/<eval-id>.js` plus a metadata sidecar (model id, settings, skill version hash, timestamp).
- [ ] Adapter interface is runtime-agnostic so a future MCP adapter can drop in without changing the runner.
- [ ] Generated traces never contain Ion tokens or local filesystem paths (verified by post-generation scan).

### US-004: Browser-backed Cesium evaluation environment
**Description:** As the runner, I need a controlled browser environment to execute generated JavaScript against a real Cesium scene.

**Acceptance Criteria:**
- [ ] `optimization/scripts/run-public-eval.py` materializes `eval.html` with the CesiumJS CDN script, `cesiumContainer` div, and Ion token injection from `CESIUM_ION_TOKEN` env var.
- [ ] Fixed viewport size used for every run of the same scenario (recorded in run metadata).
- [ ] Playwright (or equivalent) executes the page, waits for scenario-specified ready conditions, takes screenshots at scenario-specified timings.
- [ ] Console messages and page errors captured in full to `console.json`.
- [ ] Scenarios marked `runner_mode: "review-only"` are listed but skipped, not failed.

### US-005: Evidence bundle capture
**Description:** As the runner, I need to capture a complete, reproducible evidence bundle per run so checks and judges can reason about it.

**Acceptance Criteria:**
- [ ] Per-run directory `optimization/runs/<skill>/<iteration>/<eval-id>-<name>/` contains: `eval.html`, `screenshot.png` (or numbered series), `console.json`, `programmatic-checks.json`, `scene-state.json`, `metadata.json`.
- [ ] `metadata.json` records: scenario version, candidate skill version, model id, temperature, runner version, browser viewport, judge protocol version, artifact hashes.
- [ ] `optimization/runs/` is gitignored.

### US-006: Deterministic check engine
**Description:** As the framework, I need pass/fail correctness checks that run without LLM judgment so critical regressions are caught cheaply on every run.

**Acceptance Criteria:**
- [ ] Implements check types: `code_runs`, `no_console_errors`, `pattern_present`, `pattern_absent`, `schema_match`, `api_present`.
- [ ] Each check returns `{ check_id, type, result: "pass" | "fail", detail }`.
- [ ] Results written to `programmatic-checks.json` in the run directory.
- [ ] Re-running the engine on the same evidence bundle and scenario version produces identical results (deterministic).
- [ ] Runs in under 5 seconds per scenario on a typical contributor machine.

### US-007: Pairwise A/B/TIE judge protocol
**Description:** As the framework, I need three independent LLM judges to vote pairwise on baseline vs candidate visual evidence so visual decisions are robust to single-judge noise.

**Acceptance Criteria:**
- [ ] Judge call takes: scenario, baseline evidence bundle, candidate evidence bundle, judge protocol version.
- [ ] Each of three judges independently returns `BASELINE | CANDIDATE | TIE` with a rationale string.
- [ ] Judge order, role labels (which side is A vs B), and prompt template are randomized per judge to reduce position bias.
- [ ] Per-scenario verdict = majority of three (ties between three votes resolve to `TIE`).
- [ ] Verdict + all three rationales + protocol version written to `judge-verdicts.json`.
- [ ] Failure to obtain three verdicts marks scenario as `judge_unavailable`, not as a loss.

### US-008: Autonomous decision engine
**Description:** As the framework, I need a rule-based engine that decides keep/reject for a candidate without human intervention, even on ties.

**Acceptance Criteria:**
- [ ] Decision rules applied in order:
  1. Any `programmatic_checks` failure on a `regression_critical: true` scenario → **REJECT**.
  2. Any judge loss on a `regression_critical: true` scenario → **REJECT**.
  3. Aggregate candidate wins > baseline wins across non-critical scenarios → **KEEP**.
  4. Aggregate baseline wins > candidate wins → **REJECT**.
  5. Aggregate tie → **KEEP CURRENT BEST** (no maintainer required; default rule applies).
- [ ] Optional maintainer override is supported but **not required**: a CLI flag `--override` with a written rationale flips the decision and records the rationale.
- [ ] Decision record written to `optimization/results/<skill>/<iteration>/decision.json` with rule that fired, win/loss/tie counts, and rationale if overridden.

### US-009: Artifact store with public-safety partitioning
**Description:** As the framework, I need to keep public-safe artifacts in the repo and credential-bearing raw traces out of it.

**Acceptance Criteria:**
- [ ] `.gitignore` excludes `optimization/runs/`, `optimization/generated/`, raw HTML, raw screenshots before curation.
- [ ] Public-safe source and aggregate artifacts (`optimization/scenarios/`, `optimization/results/*.json`, ADRs, wiki) remain tracked.
- [ ] `optimization/scripts/check-public-artifacts.py` scans all tracked eval files for: Ion token patterns, absolute filesystem paths, email addresses, private URLs, and other configurable patterns; exits non-zero on any hit.
- [ ] `optimization/scripts/check-secrets.sh` runs a secret scanner on the staged diff before publication.

### US-010: Report generator
**Description:** As a maintainer or contributor, I need a sanitized, human-readable summary of each evaluation iteration.

**Acceptance Criteria:**
- [ ] Generates `optimization/results/public-status.json` with: current-best skill version, last decision, per-scenario win/loss/tie counts, regression-critical status, timestamp.
- [ ] Generates a Markdown summary that lists each scenario with its verdict, check status, and a curated screenshot reference (relative path).
- [ ] Output files contain no absolute paths, tokens, or private model transcripts (verified by `check-public-artifacts.py`).
- [ ] Numeric "report scores" (programmatic correctness %, API accuracy %, visual win rate, coverage delta) are computed from structured evidence and shown alongside the decision but never replace it.

### US-011: Coverage analyzer
**Description:** As the optimization proposer, I need to know which skill sections and APIs have scenario coverage so I can prioritize gaps.

**Acceptance Criteria:**
- [ ] Reads skill markdown headings and code-block API references.
- [ ] Reads scenario manifests' declared `target_skill_sections` (new optional field) and `expected_behaviors`.
- [ ] Outputs a coverage report mapping each skill section / public API to scenarios that exercise it, flagging uncovered sections.
- [ ] Report saved to `optimization/results/coverage.json`.

### US-012: Optimization proposer
**Description:** As the framework, I need an agent that reads the full prior history and proposes a revised skill so the system improves itself autonomously.

**Acceptance Criteria:**
- [ ] Proposer receives: current best skill content, last decision record, all per-scenario verdicts + rationales for last N iterations, coverage report, recent failure taxonomy.
- [ ] Proposer outputs: a candidate skill file (full content), a `hypothesis.md` explaining the change, the specific scenario evidence the change addresses.
- [ ] Proposer is a pure function of inputs (same inputs → reproducible candidate, or a recorded seed/temperature).
- [ ] Candidate is written to ignored local output under `optimization/candidates/<skill>/<iteration>/` and ready for the runner without manual edits.

### US-013: Autonomous iteration loop
**Description:** As an operator, I want to start the framework and have it run iteration after iteration without intervention until a stopping condition is met.

**Acceptance Criteria:**
- [ ] CLI: `optimization/scripts/run-loop.py <skill> --max-iterations N --stop-on <plateau|regression|max>`.
- [ ] Loop sequence per iteration: proposer → adapter (all scenarios) → runner → checks → judges → decision → report → write history.
- [ ] If decision is KEEP: candidate becomes new current best and next iteration starts.
- [ ] If decision is REJECT: candidate is discarded; next proposer call sees the rejection and rationale.
- [ ] Loop terminates on: max iterations reached, plateau (N consecutive ties), unrecoverable runner error, or operator signal.
- [ ] No prompt for confirmation, no maintainer-blocking gate, no interactive pause anywhere in the loop.
- [ ] Full iteration history persisted as ignored local output and uploaded as a workflow artifact when run in CI.

### US-014: PR CI workflow (deterministic gates only)
**Description:** As a contributor, I want fast PR feedback that doesn't burn LLM judge cost.

**Acceptance Criteria:**
- [ ] `.github/workflows/evals.yml` runs on every PR: `validate-evals.py`, `check-public-artifacts.py`, `check-secrets.sh`.
- [ ] No LLM judge calls in the PR path.
- [ ] Workflow completes in under 2 minutes on a public runner.
- [ ] Failures produce actionable annotations on the PR.

### US-015: Scheduled / manual visual judge workflow
**Description:** As a maintainer, I want to trigger or schedule a full multi-judge visual run without it blocking PRs.

**Acceptance Criteria:**
- [ ] Separate `.github/workflows/evals-visual.yml` triggered on `workflow_dispatch`, on a schedule (e.g. nightly or weekly), and on release tags.
- [ ] Runs full pipeline including judges; uploads sanitized report as workflow artifact and to `optimization/results/`.
- [ ] Uses CI secrets for Ion token and judge model API key; never echoes them to logs.

### US-016: MCP / tool-call adapter extension point
**Description:** As an architect, I need the adapter interface designed so a future MCP runtime can be added without rewriting the runner.

**Acceptance Criteria:**
- [ ] Adapter base class / interface documented with required methods: `prepare(scenario, candidate)`, `invoke()`, `collect_output()`, `runtime_metadata()`.
- [ ] Skills adapter implements the interface as the reference implementation.
- [ ] A stub MCP adapter exists with raised `NotImplementedError` and a brief docstring describing the future shape (tool call sequence, tool selection metadata, scene-state checks after each call).
- [ ] No MCP runtime code is required to build, test, or run the skills pipeline.

### US-017: Reproducibility metadata
**Description:** As an auditor, I need to reconstruct the exact conditions of any past run.

**Acceptance Criteria:**
- [ ] Every run's `metadata.json` includes: scenario version hash, candidate skill content hash, runner git commit, browser version, viewport, model id + version, temperature/seed, judge protocol version, judge model ids, timestamp (UTC).
- [ ] Decision records reference the run metadata hashes for each scenario.
- [ ] Re-running with the same inputs (within model nondeterminism bounds) produces matching deterministic-check results.

### US-018: Local reproduction quickstart
**Description:** As a contributor, I want to reproduce any public decision locally with documented commands.

**Acceptance Criteria:**
- [ ] `wiki/Run-Skill-Evaluations-Locally.md` covers: install, token setup, single-scenario run, full skill loop run.
- [ ] All commands in the wiki are copy-paste runnable from a clean checkout (verified by a smoke-test script).
- [ ] Local runner respects the same public-safety scans before aggregate result files are staged for publication.

## 4. Functional Requirements

- **FR-1**: The system MUST define every evaluation scenario as a versioned JSON manifest under `optimization/scenarios/<skill>/eval-NNN-*.json` conforming to `optimization/schemas/scenario.schema.json`.
- **FR-2**: The system MUST execute generated CesiumJS code in a browser-backed Cesium environment with a fixed viewport, capturing screenshots at scenario-defined timings, console messages, page errors, and scene state.
- **FR-3**: The system MUST run deterministic checks (`code_runs`, `no_console_errors`, `pattern_present`, `pattern_absent`, `schema_match`, `api_present`) independently of any LLM judgment, with reproducible pass/fail outputs.
- **FR-4**: The system MUST run pairwise A/B/TIE visual comparison using three independent LLM judges per scenario, with randomized position labels and majority-vote aggregation.
- **FR-5**: The system MUST apply a deterministic decision policy in this order: (1) critical programmatic-check fail → REJECT, (2) critical judge loss → REJECT, (3) candidate wins > baseline wins → KEEP, (4) baseline wins > candidate wins → REJECT, (5) tie → KEEP CURRENT BEST. All five rules MUST resolve without human input.
- **FR-6**: The system MUST support optional maintainer override via an explicit CLI flag plus written rationale, but MUST NOT require maintainer input during routine operation.
- **FR-7**: The system MUST run an autonomous iteration loop where the Optimization Proposer reads prior history, proposes a candidate skill change, the runner evaluates it, the decision engine decides, and the next iteration starts — with no interactive pauses.
- **FR-8**: The system MUST persist a complete reproducibility metadata record (scenario hash, candidate hash, runner commit, model id, temperature, judge protocol version, viewport) with every run.
- **FR-9**: The system MUST keep raw evidence (generated HTML, console captures, generated JS, raw screenshots) out of public git history by default and MUST only publish sanitized summaries, curated screenshots, scenario manifests, decision records, and ADRs.
- **FR-10**: The system MUST scan all publicly tracked eval artifacts for tokens, absolute paths, private URLs, and email addresses on every publication path (local script + PR CI).
- **FR-11**: The system MUST provide a PR CI workflow that runs only deterministic gates and completes in under 2 minutes.
- **FR-12**: The system MUST provide a separate scheduled / manual / release workflow that runs the full pipeline including LLM judges.
- **FR-13**: The system MUST expose a Coverage Analyzer that maps skill sections and public APIs to scenarios that exercise them, flagging uncovered surfaces.
- **FR-14**: The Agent/Tool Adapter MUST conform to a runtime-agnostic interface so a future MCP/tool-call adapter can be added without modifying the runner, checks, judges, decision engine, or report generator.
- **FR-15**: Scenarios marked `regression_critical: true` MUST block candidate acceptance on any loss; this rule MUST be machine-checked, not policy-enforced by review.
- **FR-16**: When a scenario's content/version changes, it MUST be flagged "re-baseline required" and excluded from win/loss tallies until explicitly re-baselined.
- **FR-17**: The system MUST compute numeric report scores (programmatic correctness, API accuracy, visual win rate, coverage delta) from structured evidence for dashboards, but these scores MUST NOT be inputs to the keep/reject decision.

## 5. Non-Goals (Out of Scope)

- **NOT** a replacement for CesiumJS unit or integration tests.
- **NOT** a rendering performance benchmark.
- **NOT** a model leaderboard — the unit under test is skill content quality, not model rankings.
- **NOT** a production monitoring service or SLA.
- **NOT** a store for private traces, customer data, credentials, or local machine paths — these never enter public git.
- **NOT** dependent on human review for routine iteration. Maintainer override exists but is opt-in; the system runs end-to-end without it.
- **NOT** an MCP/tool-call evaluator in v1 — only the adapter interface is delivered; the MCP runtime evaluator is future work.
- **NOT** running expensive multi-judge LLM evaluation on every PR — only on schedule, manual dispatch, and release.
- **NOT** trusting absolute LLM scores for visual decisions — only pairwise A/B/TIE with three independent judges.

## 6. Design Considerations

- **Repo layout** (build on existing v1):
  - `optimization/scenarios/<skill>/*.json` — manifests (tracked)
  - `optimization/schemas/*.json` — schemas (tracked)
  - `optimization/results/*.json` — aggregate baselines, public status, and coverage reports (tracked)
  - `optimization/results/<skill>/<iteration>/` — per-iteration summaries and decisions (gitignored; CI artifact)
  - `optimization/history/<skill>/iteration-NNN/` — per-iteration archive (gitignored; CI artifact)
  - `optimization/candidates/<skill>/<iteration>/` — candidate skill files (gitignored; CI artifact)
  - `optimization/generated/`, `optimization/runs/` — raw outputs (gitignored)
  - `optimization/scripts/` — self-optimization CLIs: `validate-evals.py`, `check-public-artifacts.py`, `check-secrets.sh`, `run-public-eval.py`, `run-loop.py`
  - `evaluation/scripts/` — pure deterministic evaluation CLIs.
  - `.github/workflows/evals.yml` (PR fast path), `.github/workflows/evals-visual.yml` (full path)
- **Reuse the building-block boundaries** from ACD §5.1: Catalog, Coverage, Proposer, Adapter, Runner, Environment, Checks, Judges, Decision, Store, Report. One module per block keeps responsibilities clean.
- **Adapter interface** must be the only place that knows whether the candidate is a skill or a future MCP tool sequence. Everything downstream of the adapter (Runner → Decision) is runtime-agnostic.
- **Decision engine** is a pure function of (programmatic check results, judge verdicts, scenario criticality flags). Easy to unit test, easy to audit.
- **Optimization Proposer** consumes full per-scenario rationales, not just compressed scores — ACD §8.5 calls this out explicitly.

## 7. Technical Considerations

- **Language**: Python for orchestration scripts (continues v1 convention). Generated CesiumJS code is plain JS executed in Chromium via Playwright.
- **Browser automation**: Playwright + headless Chromium for runner. Pinned versions recorded in metadata.
- **Judge models**: Use multiple distinct LLMs (or distinct prompts/seeds with the same model) to reduce correlated bias. Record judge model id per verdict.
- **Determinism**: Programmatic checks must be byte-deterministic on the same evidence. Model and judge calls record temperature/seed but cannot be fully deterministic — this is acceptable because pairwise + majority absorbs noise.
- **Reproducibility**: Every run records all inputs needed to re-derive it; manifests and skills are content-hashed.
- **Cost control**: PR CI deterministic-only; full multi-judge runs gated behind schedule/dispatch/release.
- **Security**: `CESIUM_ION_TOKEN` injected from env or CI secrets, never written to tracked artifacts. Secret scan on every publication path.
- **Public-safety scanner** must be configurable (regex list) so new sensitive patterns can be added without code changes.
- **Iteration loop persistence**: history is append-only; rejected candidates are kept (not deleted) so the proposer can learn from failures.

## 8. Success Metrics

- **Autonomy**: The optimization loop can run for 10+ iterations on a single skill with no human input and produce a defensible decision trail.
- **Reproducibility**: Any maintainer can clone, install, set a token, and reproduce a published decision on the same scenario in under 15 minutes.
- **PR feedback latency**: PR CI workflow completes in under 2 minutes for deterministic gates.
- **Regression catch rate**: Every intentionally injected regression in a `regression_critical` scenario is caught and rejected in the next iteration (verified by a test harness).
- **Public safety**: Zero tokens, absolute paths, or private URLs ever land in the tracked tree across all runs (verified continuously by `check-public-artifacts.py`).
- **Coverage growth**: Coverage report shows monotonically increasing scenario coverage of skill sections over time, with a known list of uncovered areas at any moment.
- **Judge stability**: Re-running the same baseline-vs-candidate comparison with three judges yields the same majority verdict ≥ 90% of the time on a stability test set.
- **Extensibility**: A stub MCP adapter exists and the test suite proves the runner does not depend on the skills adapter concretely.

## 9. Open Questions

- **Judge model diversity**: Should the three judges be three different models, three different prompts of the same model, or three different seeds? Initial answer: prefer model diversity when budget allows; fall back to prompt diversity.
- **Plateau detection**: What counts as a plateau for the iteration loop's stopping condition — N consecutive TIE decisions, or a more nuanced no-improvement signal across report scores?
- **Re-baseline policy**: When a `regression_critical` scenario's expected behavior changes intentionally, who or what authorizes the re-baseline? A CLI command is sufficient for the autonomous path, but does the policy need a human-attested record for audit?
- **Cross-skill effects**: If a proposer changes one skill, should the loop also run scenarios for adjacent skills (e.g., `cesiumjs-camera` change might affect `cesiumjs-entities` scenarios)? Default: same-skill only in v1; cross-skill regression suite as a future enhancement.
- **Catastrophic-failure detection**: What signals a "broken runner" vs. a "bad candidate"? The decision engine must distinguish runner errors from candidate failures so the loop doesn't reject good candidates due to infrastructure flakes.
- **Judge cost budget**: What is the per-iteration LLM judge spend ceiling, and how does the framework gracefully degrade (skip judging on non-critical scenarios?) when near the ceiling?
- **Maintainer override audit trail**: Should overrides require a PR-tracked rationale file, a signed commit, or just a CLI flag with a string? Suggested: rationale file checked into `optimization/overrides/` with a timestamp and reference to the decision.
