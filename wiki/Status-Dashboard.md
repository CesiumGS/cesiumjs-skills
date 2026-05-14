# Status Dashboard

This dashboard tracks source-controlled wiki pages for the Cesium AI Evaluation Framework. The GitHub wiki is generated from the repository's `wiki/` directory.

## Current Status Overview

| Document | Status | Updated |
|---|---|---|
| [Home](Home) | ![Draft](https://img.shields.io/badge/Draft-yellow?style=flat-square) | 5/14/26 |
| [Architecture Concept Document](Architecture-Concept-Document) | ![Draft](https://img.shields.io/badge/Draft-yellow?style=flat-square) | 5/14/26 |
| [Run Skill Evaluations Locally](Run-Skill-Evaluations-Locally) | ![Draft](https://img.shields.io/badge/Draft-yellow?style=flat-square) | 5/14/26 |
| [Add an Evaluation Scenario](Add-Evaluation-Scenario) | ![Draft](https://img.shields.io/badge/Draft-yellow?style=flat-square) | 5/14/26 |
| [Public Artifact Policy](Public-Artifact-Policy) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |
| [ADR-0001: Skills-First Sequencing](ADR-0001-Skills-First-Sequencing) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |
| [ADR-0002: Pairwise Judge Protocol](ADR-0002-Pairwise-Judge-Protocol) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |
| [ADR-0003: Deterministic Decision Policy](ADR-0003-Deterministic-Decision-Policy) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |
| [ADR-0004: Browser Visual Evaluation](ADR-0004-Browser-Visual-Evaluation) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |
| [ADR-0005: CI Trigger Policy](ADR-0005-CI-Trigger-Policy) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |
| [ADR-0006: Public Artifact Policy](ADR-0006-Public-Artifact-Policy) | ![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) | 5/14/26 |

## Status Indicators

![Draft](https://img.shields.io/badge/Draft-yellow?style=flat-square) **Draft** - Being written and refined.

![In Review](https://img.shields.io/badge/In%20Review-orange?style=flat-square) **In Review** - Under review by maintainers.

![Accepted](https://img.shields.io/badge/Accepted-brightgreen?style=flat-square) **Accepted** - Decision is accepted or document is ready to use.

![Implemented](https://img.shields.io/badge/Implemented-blue?style=flat-square) **Implemented** - Complete with working implementation.

![Blocked](https://img.shields.io/badge/Blocked-red?style=flat-square) **Blocked** - Waiting on dependencies.

## Notes

```mermaid
graph LR
    Draft[Draft]
    InReview[In Review]
    Accepted[Accepted]
    Implemented[Implemented]
    Blocked[Blocked]

    Draft --> InReview
    InReview --> Accepted
    Accepted -.optional.-> Implemented
    Draft -.-> Blocked
    InReview -.-> Blocked
```
