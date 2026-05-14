# Home

> For a document status overview, see the [Status Dashboard](Status-Dashboard).

The CesiumJS Skills wiki is generated from source-controlled Markdown in the `wiki/` directory of the `CesiumGS/cesiumjs-skills` repository. Changes should be proposed through pull requests to the source repository rather than edited directly in the GitHub wiki.

## What This Wiki Covers

This wiki currently focuses on the Cesium AI Evaluation Framework: the architecture, decisions, and operating model for evaluating AI-assisted Cesium development workflows.

The framework starts with `CesiumGS/cesiumjs-skills`, where skill documents guide coding agents that generate CesiumJS code. The same approach is designed to grow toward MCP/tool-call evaluations, Cesium ion workflow evaluations, and broader benchmarks for AI-assisted geospatial development.

## Start Here

1. [Architecture Concept Document](Architecture-Concept-Document) - Goals, constraints, building blocks, runtime views, decisions, risks, and glossary.
2. [Status Dashboard](Status-Dashboard) - Current status of the wiki pages.
3. [Run Skill Evaluations Locally](Run-Skill-Evaluations-Locally) - How to validate manifests and reproduce selected browser scenarios.
4. [Add an Evaluation Scenario](Add-Evaluation-Scenario) - How to add public-safe scenario manifests.
5. [Public Artifact Policy](Public-Artifact-Policy) - Which eval artifacts can be committed publicly.
6. [ADR-0001: Skills-First Sequencing](ADR-0001-Skills-First-Sequencing) - Why the initial implementation starts in `cesiumjs-skills`.
7. [ADR-0002: Pairwise Judge Protocol](ADR-0002-Pairwise-Judge-Protocol) - Why visual evaluation uses A/B/TIE comparison with three independent judges.
8. [ADR-0003: Deterministic Decision Policy](ADR-0003-Deterministic-Decision-Policy) - How gates, verdicts, and report scores are separated.

## Architecture Overview

```mermaid
flowchart TD
    Scenario[Versioned scenario manifest] --> Runner[Evaluation runner]
    Candidate[Candidate skill or tool context] --> Adapter[Agent or tool adapter]
    Adapter --> Runner
    Runner --> Browser[Browser-backed Cesium environment]
    Browser --> Evidence[Runtime evidence and artifacts]
    Evidence --> Checks[Deterministic checks]
    Evidence --> Judges[Pairwise judges]
    Checks --> Decision[Decision engine]
    Judges --> Decision
    Decision --> Report[Report and history]
```

## External Links

- [Source repository](https://github.com/CesiumGS/cesiumjs-skills)
- [CesiumJS](https://github.com/CesiumGS/cesium)
- [CesiumJS documentation](https://cesium.com/learn/cesiumjs/ref-doc/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
