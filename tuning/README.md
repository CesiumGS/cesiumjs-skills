# `tuning/` — CesiumJS Skill Eval & Optimization Suite

This directory contains the eval scenarios, scoring artifacts, and optimization-loop history for the CesiumJS skills shipped from this repo. Start with `cesiumjs-skills-eval-methodology.md`.

## Layout

- `cesiumjs-skills-eval-methodology.md` — methodology document
- `RESEARCH-DIARY.md` — historical notes from harness development
- `tools/` — `run_eval_suite.py` (browser execution helper) and `coverage-analyzer.py` (SKILL.md section coverage)
- `examples/screenshots/` — curated 8-image gallery (see `examples/README.md` for captions)
- `cesiumjs-<skill>/` — per-skill eval suite, one directory per shipped skill:
  - `search-config.json` — eval set definition, scoring weights, viewport
  - `evals/eval-NNN-<landmark>.json` — individual eval scenarios
  - `iterations/<n>/` — per-iteration history with scores, judge verdicts, proposer reasoning
  - `best.json` — pointer to the current-best iteration
  - `coverage-report.json` — section coverage analysis
- `.claude/` — agent prompts and hooks used to drive the optimization loop (proposer skill lives here)

## What is the eval harness, exactly?

The eval and optimization workflow is **driven by Claude Code (or another agentic coding assistant)** loading the methodology document and the proposer skill in `.claude/skills/cesiumjs-skill-optimizer/`. The agent is the harness: it orchestrates the propose → evaluate → decide loop with full filesystem access to prior iterations, forms hypotheses, writes a new SKILL.md version, and judges the result.

`tools/run_eval_suite.py` is **a small browser execution helper that the harness invokes** per eval scenario. Given a generated CesiumJS code snippet and an eval JSON, it materializes a per-eval HTML page from a template, runs it under headless Chrome, captures screenshots and console output, and writes the trace artifacts back to disk. It is a subroutine inside the broader workflow, not the harness itself.

When running the full local workflow, the agent reads scores, judge verdicts, proposer reasoning, and traces from prior iterations. **Note:** raw traces are not committed to this branch (see "What is NOT on this branch" below), so reading prior traces requires re-running the helper locally to materialize them. Scores, decisions, judge verdicts, and proposer reasoning ARE committed and readable as-is.

This separation matters because the runner does not depend on a plugin runtime — see "Design — runtime-independent runner" below.

## What is NOT on this branch

The materialized per-eval traces under `iterations/<n>/traces/` are not committed. They contain run-time artifacts (HTML with embedded tokens, console captures, generation prompts with local file paths, generated code, raw screenshots). The curated gallery in `examples/screenshots/` is the only visual output published here.

## Invoking the helper directly

If you want to call `run_eval_suite.py` outside of an agentic workflow:

```bash
export CESIUM_ION_TOKEN=<your-cesium-ion-token>
python3 tools/run_eval_suite.py --help
```

Refer to `--help` for the actual argument structure rather than assuming a specific flag form.

## Methodology overview

See `cesiumjs-skills-eval-methodology.md`. Short version: propose → evaluate → decide loop driven by a coding agent with full filesystem access to prior iterations. Pairwise visual comparison with 3 independent parallel judges + majority vote per eval. Programmatic checks gate code-correctness regressions. Coverage analyzer enforces ≥90% SKILL.md section coverage.

## Design — runtime-independent runner

Eval scenarios, the runner, scoring config, and historical results all live with the plugin in this repo. The runner does not depend on the plugin having a runtime — it executes generated CesiumJS code against a generic browser harness, not against plugin-provided MCP tools. This is intentional: the plugin currently ships pure markdown skills with no runtime, and coupling the runner to a future MCP server would block iteration today.

When the plugin eventually gains its own MCP server, the runner can grow a second mode that evaluates tool-call sequences (the `cesium-ai-integrations`-style pattern of agents calling structured MCP tools rather than emitting raw code). It will not require that mode to function.

## Roadmap

This branch is **Tier 1**: an archive of the methodology + scenarios + scores + judge verdicts + curated visual gallery. It is read-only history, not an active iteration loop.

- **Tier 2 (planned, separate plan).** A faster localhost iteration harness: a single CDN-loaded `index.html` + small `http-server` + Playwright/Chrome-DevTools MCP, replacing the materialize-per-eval-HTML pipeline. Same scenario JSON schema, same scoring config, faster dev loop.
- **Tier 3 (later, depends on plugin runtime).** MCP-native evals that drive the plugin's own MCP tools. Evaluates tool-call sequences against expected viewport state queried back through the same MCP tools. Skill content shifts from "patterns the agent emits as code" to "patterns the agent emits as tool calls."

Tier 1 stays usable through all subsequent tiers as the source of truth for scenarios and methodology.
