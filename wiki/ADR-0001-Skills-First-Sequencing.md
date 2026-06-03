# ADR-0001: Use Skills-First Sequencing

## Context

The long-term goal is a reusable Cesium AI evaluation framework that can evaluate skills, documentation, examples, MCP tools, and Cesium ion workflows. The near-term implementation evidence exists in `CesiumGS/cesiumjs-skills`, where skill documents already have representative scenarios, browser execution helpers, and iteration history.

Two sequencing options were considered:

- **Suite-first:** design a generic benchmark framework first, then apply it to skills.
- **Skills-first:** prove the framework in `cesiumjs-skills`, then generalize reusable components.

## Decision

Use skills-first sequencing.

The initial canonical implementation should focus on `CesiumGS/cesiumjs-skills` because the target artifacts, scenarios, and runner already exist there. The architecture must still preserve extension points for MCP and tool-call evaluations.

## Consequences

- The first ACD and ADR set can be grounded in real branch artifacts.
- The framework can produce useful value before MCP/tool runtimes are mature.
- Some abstractions may need to be extracted later.
- Scenario and runner design must avoid hard-coding assumptions that make future MCP evaluation impossible.
