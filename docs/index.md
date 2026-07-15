# CesiumJS Agent Skills

<img src="assets/ty-calm2.png" alt="Ty, the Cesium mascot" class="doc-illustration" />

Curated, open-standard agent skills that help coding assistants build correct, performant
CesiumJS applications. The collection turns a large API surface into focused guidance an
agent can discover only when the task needs it.

<div class="skills-hero">
  <span class="eyebrow" style="color: #9de9ff;">CesiumJS knowledge, ready for agents</span>
  <h2>From globe setup to production-grade 3D workflows</h2>
  <p>Route each request to one focused domain, apply Cesium-specific implementation patterns, and verify generated scenes with deterministic and browser-backed evidence.</p>
  <div class="hero-metrics">
    <span>14 domain skills</span>
    <span>1 orientation skill</span>
    <span>Open Agent Skills format</span>
  </div>
</div>

## Start here

<div class="feature-grid">
  <div class="feature-card">
    <h3>Install the collection</h3>
    <p>Add the Claude Code marketplace or copy the skills into any Agent Skills-compatible environment.</p>
    <p><a href="getting-started/">Open Getting Started →</a></p>
  </div>
  <div class="feature-card">
    <h3>Choose the right domain</h3>
    <p>Find the owning skill for viewer, camera, entity, tiles, terrain, shader, model, or interaction work.</p>
    <p><a href="skills-catalog/">Browse the Skills Catalog →</a></p>
  </div>
  <div class="feature-card">
    <h3>Understand the system</h3>
    <p>See how orientation, domain ownership, progressive disclosure, and cross-skill routing fit together.</p>
    <p><a href="architecture/">Explore the Architecture →</a></p>
  </div>
  <div class="feature-card">
    <h3>Trust, then verify</h3>
    <p>Use deterministic contracts, browser rendering, visual review, and controlled optimization to prevent regressions.</p>
    <p><a href="evaluation-optimization/">Review the Evaluation Model →</a></p>
  </div>
</div>

## How the collection works

<div class="workflow-strip">
  <div class="workflow-step"><strong>Orient</strong><span>Identify the CesiumJS domains involved in the request.</span></div>
  <div class="workflow-step"><strong>Route</strong><span>Load only the owning domain skill and required references.</span></div>
  <div class="workflow-step"><strong>Implement</strong><span>Apply current APIs, lifecycle rules, and performance patterns.</span></div>
  <div class="workflow-step"><strong>Validate</strong><span>Check source contracts, runtime state, and rendered output.</span></div>
</div>

## Designed for the Cesium AI ecosystem

This site deliberately shares the navigation, Cesium globe palette, typography, mascot
artwork, and light/dark presentation used by the
[CesiumJS AI Starter App](https://github.com/CesiumGS/cesiumjs-ai-starter-app).
Together, the starter app and this collection provide complementary paths: one supplies a
ready-to-run AI application, while the other supplies reusable CesiumJS knowledge for
coding agents.

## Source

[github.com/CesiumGS/cesiumjs-skills](https://github.com/CesiumGS/cesiumjs-skills)
