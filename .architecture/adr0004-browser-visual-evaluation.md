# ADR-0004: Use Browser-Backed Visual Evaluation

## Status

Accepted

## Context

Many CesiumJS failures cannot be detected from generated code alone. Examples include wrong camera distance, reversed longitude sign, missing terrain, invisible imagery, flat city scenes where 3D buildings were expected, or asynchronous loading that never completes.

Code-pattern checks are necessary but insufficient.

## Decision

Use a browser-backed Cesium evaluation environment for CesiumJS scenarios.

The runner should execute generated code in a controlled page, capture console output, page errors, screenshots, and, where useful, scene state. Visual scenarios should use recognizable landmarks or controlled fixtures to make judgment reliable.

## Consequences

- The framework measures rendered behavior, not just code shape.
- Screenshots and scene evidence help maintainers debug failures.
- Browser automation adds setup cost and potential flakiness.
- Scenarios need careful timing and stable viewport settings.
- Some checks should use scene state in addition to screenshots when visual evidence alone is ambiguous.
