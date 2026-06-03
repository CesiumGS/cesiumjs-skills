#!/usr/bin/env python3
"""Build a local static review UI for evaluation scorecard results."""

from __future__ import annotations

import argparse
import json
import shlex
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "evaluation" / "artifacts" / "review-ui" / "index.html"


HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scorecard Review</title>
  <style>
    :root {
      --bg: #08111c;
      --panel: #101a28;
      --panel-2: #142033;
      --panel-3: #0c1624;
      --text: #ecf3fb;
      --muted: #98a9bd;
      --border: #26354a;
      --shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
      --green: #7dd3a5;
      --green-bg: rgba(45, 212, 124, 0.13);
      --red: #ff8f83;
      --red-bg: rgba(239, 68, 68, 0.17);
      --amber: #f7c66d;
      --amber-bg: rgba(245, 158, 11, 0.14);
      --blue: #8dbdff;
      --blue-bg: rgba(59, 130, 246, 0.16);
      --violet: #c4a7ff;
      --violet-bg: rgba(139, 92, 246, 0.15);
      --link: #9bc7ff;
      --focus: #5dd4c6;
      --critical: #ff8f83;
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body[data-theme="light"] {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-2: #f8fafc;
      --panel-3: #eef4fb;
      --text: #182334;
      --muted: #64748b;
      --border: #d8e0eb;
      --shadow: 0 12px 34px rgba(28, 44, 68, 0.11);
      --green: #157347;
      --green-bg: #e6f6ee;
      --red: #b42318;
      --red-bg: #fde9e7;
      --amber: #95610a;
      --amber-bg: #fff3d6;
      --blue: #245f9f;
      --blue-bg: #e5f0fd;
      --violet: #6d48b7;
      --violet-bg: #efe9ff;
      --link: #245f9f;
      --focus: #0f766e;
      --critical: #b42318;
      color-scheme: light;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
    }

    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
      border-right: 1px solid var(--border);
      background: linear-gradient(180deg, var(--panel), var(--panel-3));
      padding: 18px;
    }

    .brand { display: grid; gap: 6px; margin-bottom: 18px; }
    .brand-kicker { color: var(--focus); font-size: 12px; font-weight: 750; text-transform: uppercase; }
    .brand-title { margin: 0; font-size: 24px; line-height: 1.1; letter-spacing: 0; }
    .brand-subtitle { color: var(--muted); font-size: 13px; line-height: 1.45; }

    .status-block {
      border: 1px solid var(--border);
      background: var(--panel-2);
      border-radius: 8px;
      padding: 12px;
      box-shadow: var(--shadow);
      margin-bottom: 14px;
    }

    .status-result { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .score-big { font-size: 34px; font-weight: 800; line-height: 1; }
    .small-label { color: var(--muted); font-size: 12px; }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
    }
    .pill.pass { color: var(--green); background: var(--green-bg); border-color: color-mix(in srgb, var(--green) 35%, var(--border)); }
    .pill.fail { color: var(--red); background: var(--red-bg); border-color: color-mix(in srgb, var(--red) 35%, var(--border)); }
    .pill.warn { color: var(--amber); background: var(--amber-bg); border-color: color-mix(in srgb, var(--amber) 35%, var(--border)); }
    .pill.info { color: var(--blue); background: var(--blue-bg); border-color: color-mix(in srgb, var(--blue) 35%, var(--border)); }
    .pill.violet { color: var(--violet); background: var(--violet-bg); border-color: color-mix(in srgb, var(--violet) 35%, var(--border)); }

    .nav { display: grid; gap: 6px; margin: 14px 0; }
    .nav button {
      width: 100%;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      border-radius: 6px;
      padding: 9px 10px;
      text-align: left;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .nav button:hover { background: var(--panel-2); color: var(--text); }
    .nav button.active { background: var(--blue-bg); color: var(--text); border-color: color-mix(in srgb, var(--blue) 30%, var(--border)); }

    .side-actions { display: grid; gap: 8px; margin-top: 16px; }
    .button {
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text);
      border-radius: 6px;
      padding: 9px 10px;
      font-size: 13px;
    }
    .button.primary { background: var(--blue); color: #06101e; border-color: var(--blue); font-weight: 800; }
    body[data-theme="light"] .button.primary { color: #ffffff; }

    .main {
      min-width: 0;
      padding: 22px;
      max-width: 1540px;
      width: 100%;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: minmax(260px, 1fr) auto auto auto;
      gap: 10px;
      align-items: center;
      margin: -22px -22px 18px;
      padding: 14px 22px;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(10px);
    }

    .search, .select {
      min-width: 0;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      padding: 9px 10px;
      outline: none;
    }
    .search:focus, .select:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent); }

    .section { display: none; }
    .section.active { display: block; }

    .grid { display: grid; gap: 14px; min-width: 0; }
    .grid > * { min-width: 0; }
    .grid.two { grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr); align-items: start; }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }

    .panel {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
      box-shadow: var(--shadow);
      min-width: 0;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      padding: 14px;
      border-bottom: 1px solid var(--border);
    }
    .panel-title { margin: 0; font-size: 16px; line-height: 1.25; }
    .panel-subtitle { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .panel-body { padding: 14px; min-width: 0; }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .metric {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
      padding: 13px;
      min-height: 92px;
      box-shadow: var(--shadow);
    }
    .metric strong { display: block; font-size: 24px; line-height: 1; margin-top: 7px; }
    .metric span { color: var(--muted); font-size: 12px; }

    .category-list { display: grid; gap: 10px; }
    .category-card {
      display: grid;
      gap: 8px;
      border: 1px solid var(--border);
      background: var(--panel-2);
      border-radius: 8px;
      padding: 12px;
    }
    .category-top { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .category-name { font-weight: 800; overflow-wrap: anywhere; }
    .bar { height: 9px; background: var(--panel-3); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--green); width: 0%; }
    .bar span.warn { background: var(--amber); }
    .bar span.fail { background: var(--red); }
    .category-meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; }

    .queue {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .case-list {
      max-height: calc(100vh - 118px);
      overflow: auto;
    }
    .case-button {
      width: 100%;
      border: 0;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      text-align: left;
      padding: 12px;
    }
    .case-button:hover { background: var(--panel-2); }
    .case-button.active { background: var(--blue-bg); box-shadow: inset 3px 0 0 var(--blue); }
    .case-title { font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
    .case-meta { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 7px; margin-top: 7px; }

    .prompt {
      border: 1px solid var(--border);
      background: var(--panel-3);
      border-radius: 8px;
      padding: 13px;
      color: var(--text);
      line-height: 1.5;
      font-size: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .check-table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 8px; max-width: 100%; }
    table { width: 100%; border-collapse: collapse; min-width: 880px; }
    th, td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; text-align: left; font-size: 13px; }
    th { color: var(--muted); background: var(--panel-2); font-size: 12px; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    .json {
      max-width: 320px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 12px;
    }

    .failure-list { display: grid; gap: 10px; }
    .failure {
      border: 1px solid color-mix(in srgb, var(--red) 30%, var(--border));
      background: var(--red-bg);
      border-radius: 8px;
      padding: 12px;
      min-width: 0;
    }
    .failure-title { font-weight: 850; overflow-wrap: anywhere; }
    .failure-detail { margin-top: 8px; color: var(--text); line-height: 1.45; overflow-wrap: anywhere; }
    .evidence { color: var(--muted); margin-top: 8px; font-size: 12px; overflow-wrap: anywhere; }

    .visual-card {
      border: 1px solid color-mix(in srgb, var(--violet) 30%, var(--border));
      background: color-mix(in srgb, var(--violet) 9%, var(--panel));
      border-radius: 8px;
      padding: 12px;
      display: grid;
      gap: 10px;
      min-width: 0;
    }
    .visual-card.fail {
      border-color: color-mix(in srgb, var(--red) 35%, var(--border));
      background: var(--red-bg);
    }
    .visual-card.warn {
      border-color: color-mix(in srgb, var(--amber) 35%, var(--border));
      background: var(--amber-bg);
    }
    .visual-card.pass {
      border-color: color-mix(in srgb, var(--green) 35%, var(--border));
      background: var(--green-bg);
    }
    .visual-copy { line-height: 1.48; color: var(--text); overflow-wrap: anywhere; }
    .visual-lists {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .visual-list {
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel) 78%, transparent);
      border-radius: 8px;
      padding: 10px;
      min-width: 0;
    }
    .visual-list ul { margin: 8px 0 0; padding-left: 18px; color: var(--muted); line-height: 1.45; }
    .visual-list li { overflow-wrap: anywhere; }
    .provenance-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .provenance-item {
      border: 1px solid var(--border);
      background: var(--panel-3);
      border-radius: 8px;
      padding: 10px;
      min-width: 0;
    }
    .provenance-value {
      margin-top: 5px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .evidence-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
    }
    .evidence-panel {
      border: 1px solid var(--border);
      background: var(--panel-3);
      border-radius: 8px;
      padding: 10px;
      min-width: 0;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 8px;
    }
    .evidence-chip {
      display: inline-flex;
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 5px 9px;
      background: var(--panel);
      color: var(--text);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .screenshot-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .screenshot-frame {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-3);
      overflow: hidden;
      min-width: 0;
    }
    .screenshot-frame img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      background: var(--panel-3);
    }
    .screenshot-frame img.missing {
      display: none;
    }
    .screenshot-caption {
      padding: 8px 9px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .screenshot-missing {
      display: none;
      padding: 20px;
      color: var(--amber);
      background: var(--amber-bg);
      min-height: 120px;
      align-items: center;
    }
    .screenshot-frame img.missing + .screenshot-missing {
      display: flex;
    }
    .screenshot-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .screenshot-chip {
      display: inline-flex;
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 5px 9px;
      color: var(--link);
      background: var(--panel-3);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .focus-list { display: grid; gap: 10px; }
    .focus-item {
      border: 1px solid color-mix(in srgb, var(--focus) 35%, var(--border));
      background: color-mix(in srgb, var(--focus) 12%, var(--panel));
      border-radius: 8px;
      padding: 12px;
    }

    .empty {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      color: var(--muted);
      background: var(--panel);
    }

    .command-box {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-3);
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .command-box pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--text);
      font-size: 12px;
      line-height: 1.5;
    }
    .command-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .footer-note { margin-top: 20px; color: var(--muted); font-size: 12px; }

    @media (max-width: 1120px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: relative; height: auto; }
      .toolbar { grid-template-columns: 1fr 1fr; position: relative; margin-top: 0; }
      .grid.two, .queue { grid-template-columns: 1fr; }
      .case-list { max-height: none; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 640px) {
      .main { padding: 14px; }
      .toolbar { margin: -14px -14px 14px; padding: 12px 14px; grid-template-columns: 1fr; }
      .metric-grid, .grid.three { grid-template-columns: 1fr; }
      .panel-head { display: grid; }
    }
  </style>
</head>
<body data-theme="dark">
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-kicker">Evaluation review</div>
        <h1 class="brand-title">Scorecard Review</h1>
        <div class="brand-subtitle">Local workflow for reviewing deterministic scorecard health and first-class qualitative visual assessment before this becomes CI/CD-driven.</div>
      </div>

      <div class="status-block">
        <div class="status-result">
          <div>
            <div class="small-label">Overall score</div>
            <div class="score-big" id="scoreBig">0%</div>
          </div>
          <span id="resultPill" class="pill">Result</span>
        </div>
        <div class="category-meta" style="margin-top: 12px;">
          <span id="thresholdText">Threshold</span>
          <span id="caseCountText">Cases</span>
        </div>
      </div>

      <nav class="nav" aria-label="Review sections">
        <button class="active" data-section="overview">Overview <span id="navOverview">0</span></button>
        <button data-section="queue">Review Queue <span id="navQueue">0</span></button>
        <button data-section="visual">Visual Review <span id="navVisual">0</span></button>
        <button data-section="failures">Critical Failures <span id="navFailures">0</span></button>
        <button data-section="focus">Optimization Focus <span id="navFocus">0</span></button>
        <button data-section="launch">Launch <span id="navLaunch">0</span></button>
      </nav>

      <div class="side-actions">
        <button class="button primary" id="openFailing">Open first failure</button>
        <button class="button" id="toggleTheme">Light mode</button>
      </div>
    </aside>

    <main class="main">
      <div class="toolbar">
        <input class="search" id="search" type="search" placeholder="Search skill, case, category, prompt, check detail">
        <select class="select" id="resultFilter">
          <option value="all">All results</option>
          <option value="fail">Failed only</option>
          <option value="pass">Passed only</option>
        </select>
        <select class="select" id="categoryFilter">
          <option value="all">All categories</option>
        </select>
        <button class="button" id="resetFilters">Reset</button>
      </div>

      <section id="overview" class="section active">
        <div class="metric-grid">
          <div class="metric"><span>Cases</span><strong id="metricCases">0</strong></div>
          <div class="metric"><span>Skills covered</span><strong id="metricSkills">0</strong></div>
          <div class="metric"><span>Critical failures</span><strong id="metricCritical">0</strong></div>
          <div class="metric"><span>Failed checks</span><strong id="metricFailedChecks">0</strong></div>
          <div class="metric"><span>Visual review</span><strong id="metricVisual" style="font-size: 20px;">none</strong></div>
          <div class="metric"><span>Git commit</span><strong id="metricCommit" style="font-size: 16px;">unknown</strong></div>
        </div>

        <div class="grid two">
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Category Health</h2>
                <div class="panel-subtitle">Deterministic checks answer whether exact scene-state contracts passed. Critical failures override aggregate score.</div>
              </div>
              <span class="pill info" id="runIdPill">run</span>
            </div>
            <div class="panel-body">
              <div class="category-list" id="categoryList"></div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Review Priorities</h2>
                <div class="panel-subtitle">Failed deterministic checks and visual review gaps that should guide the next local iteration.</div>
              </div>
            </div>
            <div class="panel-body">
              <div id="prioritySummary" class="focus-list"></div>
            </div>
          </div>
        </div>
      </section>

      <section id="queue" class="section">
        <div class="queue">
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Cases</h2>
                <div class="panel-subtitle"><span id="visibleCaseCount">0</span> visible after filters</div>
              </div>
            </div>
            <div class="case-list" id="caseList"></div>
          </div>
          <div class="grid" id="caseDetail"></div>
        </div>
      </section>

      <section id="failures" class="section">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Critical Failures</h2>
              <div class="panel-subtitle">Gate-blocking failures with evidence paths and actual-vs-expected values.</div>
            </div>
          </div>
          <div class="panel-body">
            <div class="failure-list" id="failureList"></div>
          </div>
        </div>
      </section>

      <section id="visual" class="section">
        <div class="grid two">
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Qualitative Visual Review</h2>
                <div class="panel-subtitle">This lane answers whether the render looks correct, legible, framed, and free of obvious visual artifacts. It is separate from deterministic numeric correctness.</div>
              </div>
              <span class="pill violet" id="visualResultPill">not required</span>
            </div>
            <div class="panel-body">
              <div class="metric-grid">
                <div class="metric"><span>Reviewed</span><strong id="visualReviewed">0/0</strong></div>
                <div class="metric"><span>Required</span><strong id="visualRequired">0</strong></div>
                <div class="metric"><span>Needs review</span><strong id="visualNeeds">0</strong></div>
                <div class="metric"><span>Blocking</span><strong id="visualBlocking">0</strong></div>
              </div>
              <div id="visualSummaryList" class="failure-list"></div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">How To Read This</h2>
                <div class="panel-subtitle">Use the two lanes together, not interchangeably.</div>
              </div>
            </div>
            <div class="panel-body">
              <div class="visual-card">
                <div class="visual-copy">Deterministic checks are CI-safe assertions over captured state: exact distances, axes, mutation contracts, and camera geometry. Visual review is the qualitative inspection of the produced render: framing, occlusion, readability, visual intent, and whether the scene looks like the requested outcome.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="focus" class="section">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Optimization Focus</h2>
              <div class="panel-subtitle">Optional local development hints derived from the scorecard. Evaluation remains the source of truth.</div>
            </div>
          </div>
          <div class="panel-body">
            <div class="focus-list" id="focusList"></div>
          </div>
        </div>
      </section>

      <section id="launch" class="section">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Start Optimization From This Scorecard</h2>
              <div class="panel-subtitle">Use the scorecard-derived focus to select affected skills and seed the proposer with deterministic failure context.</div>
            </div>
          </div>
          <div class="panel-body">
            <div class="grid" id="launchList"></div>
          </div>
        </div>
      </section>

      <div class="footer-note">Generated locally from deterministic scorecard JSON. This UI does not mutate skills, baselines, optimization history, or CI state.</div>
    </main>
  </div>

  <script id="scorecard-data" type="application/json">__SCORECARD_JSON__</script>
  <script id="focus-data" type="application/json">__FOCUS_JSON__</script>
  <script id="launch-data" type="application/json">__LAUNCH_JSON__</script>
  <script>
    const scorecard = JSON.parse(document.getElementById('scorecard-data').textContent);
    const focus = JSON.parse(document.getElementById('focus-data').textContent);
    const launch = JSON.parse(document.getElementById('launch-data').textContent);
    const state = {
      section: 'overview',
      selectedCaseKey: '',
      search: '',
      result: 'all',
      category: 'all',
    };

    const $ = (id) => document.getElementById(id);
    const pct = (value) => `${Math.round((Number(value) || 0) * 1000) / 10}%`;
    const text = (value) => value === null || value === undefined || value === '' ? 'none' : String(value);
    const jsonText = (value) => {
      if (value === null || value === undefined) return 'null';
      if (typeof value === 'string') return value;
      return JSON.stringify(value, null, 2);
    };
    const assetUrl = (path) => {
      if (!path) return '';
      if (/^(https?:|file:|data:|blob:)/.test(path)) return path;
      if (path.startsWith('/')) return path;
      return `/${path}`;
    };
    const caseKey = (item) => `${item.skill}/${item.case_id}`;
    const failedChecks = (item) => item.checks.filter((check) => check.result === 'fail');
    const visualReview = (item) => item.visual_review || {
      status: 'not_reviewed',
      required: false,
      blocking: false,
      score: null,
      reviewer: 'unassigned',
      reviewed_at: null,
      summary: 'No qualitative visual assessment has been recorded for this case.',
      dimensions: {},
      observations: [],
      risks: [],
      screenshots: item.screenshots || [],
      artifact_path: '',
    };
    const caseSearchText = (item) => [
      item.skill, item.case_id, item.case_name, item.task, item.category,
      ...(item.probe_contract?.capture || []),
      item.source_context?.source_scenario_id, item.source_context?.source_name,
      ...(item.source_context?.expected_behaviors || []),
      item.source_context?.visual_expectations,
      visualReview(item).status,
      visualReview(item).summary,
      ...visualReview(item).observations,
      ...visualReview(item).risks,
      ...item.checks.flatMap((check) => [check.check_id, check.type, check.category, check.detail])
    ].join(' ').toLowerCase();

    function resultClass(result) {
      return result === 'pass' ? 'pass' : 'fail';
    }

    function visualClass(status) {
      if (status === 'pass' || status === 'not_applicable') return 'pass';
      if (status === 'fail') return 'fail';
      if (status === 'needs_review' || status === 'not_reviewed') return 'warn';
      return 'violet';
    }

    function visualLabel(status) {
      return String(status || 'not_reviewed').replaceAll('_', ' ').toUpperCase();
    }

    function dimensionLabel(key) {
      return String(key || '').replaceAll('_', ' ');
    }

    function thresholdClass(score) {
      if (score >= scorecard.threshold) return '';
      if (score >= Math.max(0, scorecard.threshold - 0.15)) return 'warn';
      return 'fail';
    }

    function renderShell() {
      const visual = scorecard.visual_summary || {};
      $('scoreBig').textContent = pct(scorecard.overall_score);
      $('resultPill').textContent = scorecard.overall_result.toUpperCase();
      $('resultPill').className = `pill ${resultClass(scorecard.overall_result)}`;
      $('thresholdText').textContent = `Threshold ${pct(scorecard.threshold)}`;
      $('caseCountText').textContent = `${scorecard.cases.length} cases`;
      $('metricCases').textContent = scorecard.cases.length;
      $('metricSkills').textContent = new Set(scorecard.cases.map((item) => item.skill)).size;
      $('metricCritical').textContent = scorecard.critical_failures.length;
      $('metricFailedChecks').textContent = scorecard.cases.reduce((sum, item) => sum + failedChecks(item).length, 0);
      $('metricVisual').textContent = visualLabel(visual.result || 'not_required');
      $('metricCommit').textContent = String(scorecard.git_commit || 'unknown').slice(0, 12);
      $('runIdPill').textContent = scorecard.run_id || 'scorecard run';
      $('navOverview').textContent = Object.keys(scorecard.category_scores || {}).length;
      $('navQueue').textContent = scorecard.cases.length;
      $('navVisual').textContent = `${visual.reviewed_count || 0}/${visual.total_cases || scorecard.cases.length}`;
      $('navFailures').textContent = scorecard.critical_failures.length;
      $('navFocus').textContent = focus.focus_required ? focus.categories.length : 0;
      $('navLaunch').textContent = (launch.recommended_skills || []).length;
    }

    function renderCategoryOptions() {
      const categories = Object.keys(scorecard.category_scores || {}).sort();
      $('categoryFilter').innerHTML = '<option value="all">All categories</option>' +
        categories.map((category) => `<option value="${category}">${category}</option>`).join('');
    }

    function renderCategories() {
      const entries = Object.entries(scorecard.category_scores || {}).sort((a, b) => a[0].localeCompare(b[0]));
      $('categoryList').innerHTML = entries.map(([category, data]) => {
        const score = Number(data.score) || 0;
        const fillClass = thresholdClass(score);
        return `
          <div class="category-card">
            <div class="category-top">
              <div class="category-name">${category}</div>
              <span class="pill ${fillClass || 'pass'}">${pct(score)}</span>
            </div>
            <div class="bar"><span class="${fillClass}" style="width: ${Math.max(0, Math.min(100, score * 100))}%"></span></div>
            <div class="category-meta">
              <span>${data.passed_checks}/${data.total_checks} checks</span>
              <span>${data.passed_weight}/${data.total_weight} weight</span>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderPriorities() {
      const visual = scorecard.visual_summary || {};
      const visualIssues = visual.blocking_failures || [];
      if (!scorecard.critical_failures.length && !visualIssues.length && scorecard.overall_result === 'pass') {
        $('prioritySummary').innerHTML = '<div class="empty">No gate-blocking failures. Deterministic checks are clean and visual review has no blocking issues.</div>';
        return;
      }
      const categories = focus.categories && focus.categories.length
        ? focus.categories
        : Object.entries(scorecard.category_scores || {})
            .filter(([, data]) => data.score < scorecard.threshold)
            .map(([category, data]) => ({ category, score: data.score, failed_checks: 0, critical_failures: 0, affected_cases: [] }));
      const visualHtml = visualIssues.map((item) => `
        <div class="visual-card ${visualClass(item.status)}">
          <div class="category-top">
            <div class="category-name">${item.skill} / ${item.case_id}</div>
            <span class="pill ${visualClass(item.status)}">${visualLabel(item.status)}</span>
          </div>
          <div class="visual-copy">${item.summary}</div>
        </div>
      `).join('');
      $('prioritySummary').innerHTML = visualHtml + categories.map((item) => `
        <div class="focus-item">
          <div class="category-top">
            <div class="category-name">${item.category}</div>
            <span class="pill ${item.critical_failures ? 'fail' : 'warn'}">${pct(item.score)}</span>
          </div>
          <div class="category-meta" style="margin-top: 8px;">
            <span>${item.failed_checks} failed checks</span>
            <span>${item.critical_failures} critical</span>
            <span>${(item.affected_cases || []).join(', ') || 'no cases listed'}</span>
          </div>
        </div>
      `).join('');
    }

    function filteredCases() {
      const query = state.search.trim().toLowerCase();
      return scorecard.cases
        .filter((item) => state.result === 'all' || item.result === state.result)
        .filter((item) => state.category === 'all' || item.category === state.category || item.checks.some((check) => check.category === state.category))
        .filter((item) => !query || caseSearchText(item).includes(query))
        .sort((a, b) => {
          const aFail = failedChecks(a).length;
          const bFail = failedChecks(b).length;
          if (aFail !== bFail) return bFail - aFail;
          return caseKey(a).localeCompare(caseKey(b));
        });
    }

    function renderCaseList() {
      const cases = filteredCases();
      $('visibleCaseCount').textContent = cases.length;
      if (!cases.length) {
        $('caseList').innerHTML = '<div class="empty">No cases match the current filters.</div>';
        $('caseDetail').innerHTML = '';
        return;
      }
      if (!state.selectedCaseKey || !cases.some((item) => caseKey(item) === state.selectedCaseKey)) {
        state.selectedCaseKey = caseKey(cases[0]);
      }
      $('caseList').innerHTML = cases.map((item) => {
        const failed = failedChecks(item).length;
        const review = visualReview(item);
        return `
          <button class="case-button ${caseKey(item) === state.selectedCaseKey ? 'active' : ''}" data-case="${caseKey(item)}">
            <div class="case-title">${item.skill} / ${item.case_id}</div>
            <div class="case-meta">
              <span>${item.case_name}</span>
              <span class="pill ${resultClass(item.result)}">${item.result.toUpperCase()}</span>
              <span class="pill ${visualClass(review.status)}">${visualLabel(review.status)}</span>
              <span>${pct(item.score)}</span>
              ${failed ? `<span class="pill fail">${failed} failed</span>` : '<span class="pill pass">clean</span>'}
            </div>
          </button>
        `;
      }).join('');
      document.querySelectorAll('.case-button').forEach((button) => {
        button.addEventListener('click', () => {
          state.selectedCaseKey = button.dataset.case;
          renderCaseList();
          renderCaseDetail();
        });
      });
      renderCaseDetail();
    }

    function listItems(items, emptyText) {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      if (!list.length) return `<div class="small-label">${emptyText}</div>`;
      return `<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`;
    }

    function screenshotChips(paths) {
      const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
      if (!list.length) return '<div class="small-label">No screenshots attached.</div>';
      return `<div class="screenshot-list">${list.map((path) => `<span class="screenshot-chip">${path}</span>`).join('')}</div>`;
    }

    function chips(items, emptyText) {
      const list = Array.isArray(items) ? items.filter(Boolean) : [];
      if (!list.length) return `<div class="small-label">${emptyText}</div>`;
      return `<div class="chip-row">${list.map((item) => `<span class="evidence-chip mono">${item}</span>`).join('')}</div>`;
    }

    function screenshotGallery(paths) {
      const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
      if (!list.length) return '<div class="empty">No render screenshot is attached to this visual review.</div>';
      return `
        <div class="screenshot-gallery">
          ${list.map((path) => `
            <figure class="screenshot-frame">
              <img src="${assetUrl(path)}" alt="Render screenshot for ${path}" loading="lazy" onerror="this.classList.add('missing')">
              <div class="screenshot-missing">Screenshot file is referenced but not available at this path.</div>
              <figcaption class="screenshot-caption">${path}</figcaption>
            </figure>
          `).join('')}
        </div>
      `;
    }

    function visualCard(item) {
      const review = visualReview(item);
      const dimensions = review.dimensions || {};
      const dimensionKeys = ['nonblank_render', 'target_visible', 'framing', 'occlusion', 'clutter', 'prompt_match'];
      return `
        <div class="visual-card ${visualClass(review.status)}">
          <div class="category-top">
            <div>
              <div class="category-name">Qualitative visual review</div>
              <div class="panel-subtitle">${review.reviewer || 'unassigned'}${review.reviewed_at ? ` / ${review.reviewed_at}` : ''}</div>
            </div>
            <span class="pill ${visualClass(review.status)}">${visualLabel(review.status)}</span>
          </div>
          <div class="visual-copy">${review.summary}</div>
          <div class="category-meta">
            <span>${review.required ? 'required' : 'optional'}</span>
            <span>${review.blocking ? 'blocking' : 'non-blocking'}</span>
            <span>score ${review.score === null || review.score === undefined ? 'not scored' : pct(review.score)}</span>
            ${review.artifact_path ? `<span>${review.artifact_path}</span>` : ''}
          </div>
          <div class="visual-list">
            <div class="small-label">Visual dimensions</div>
            <div class="chip-row">
              ${dimensionKeys.map((key) => {
                const dimension = dimensions[key] || { status: 'needs_review', note: '' };
                return `<span class="evidence-chip ${visualClass(dimension.status)}" title="${dimension.note || ''}">${dimensionLabel(key)}: ${visualLabel(dimension.status)}</span>`;
              }).join('')}
            </div>
          </div>
          <div class="visual-lists">
            <div class="visual-list">
              <div class="small-label">Observations</div>
              ${listItems(review.observations, 'No observations recorded.')}
            </div>
            <div class="visual-list">
              <div class="small-label">Risks</div>
              ${listItems(review.risks, 'No visual risks recorded.')}
            </div>
          </div>
          <div>
            <div class="small-label" style="margin-bottom: 7px;">Render screenshot being evaluated</div>
            ${screenshotGallery(review.screenshots)}
            <div style="margin-top: 8px;">${screenshotChips(review.screenshots)}</div>
          </div>
        </div>
      `;
    }

    function provenanceCard(item) {
      const source = item.source_context || {};
      const evidence = item.evidence_summary || {};
      const expected = source.expected_behaviors || [];
      return `
        <div class="panel" style="box-shadow: none;">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">Expected vs Actual Provenance</h3>
              <div class="panel-subtitle">Expected values come from the case/scenario contract. Actual values come from observed evidence artifacts.</div>
            </div>
          </div>
          <div class="panel-body grid">
            <div class="provenance-grid">
              <div class="provenance-item">
                <div class="small-label">Expected source</div>
                <div class="provenance-value">${source.source || 'evaluation/cases'}</div>
              </div>
              <div class="provenance-item">
                <div class="small-label">Source scenario</div>
                <div class="provenance-value">${source.source_scenario_id || item.case_id}${source.source_name ? ` / ${source.source_name}` : ''}</div>
              </div>
              <div class="provenance-item">
                <div class="small-label">Actual source</div>
                <div class="provenance-value">${evidence.actual_source_path || evidence.evidence_path || item.evidence_path}</div>
              </div>
              <div class="provenance-item">
                <div class="small-label">Observed run</div>
                <div class="provenance-value">${evidence.run_artifact_path || 'synthetic fixture'}</div>
              </div>
            </div>
            ${expected.length ? `
              <div class="visual-list">
                <div class="small-label">Expected behaviors</div>
                ${listItems(expected, 'No expected behaviors recorded.')}
              </div>
            ` : ''}
            ${source.visual_expectations ? `
              <div class="visual-list">
                <div class="small-label">Visual expectation</div>
                <div class="visual-copy">${source.visual_expectations}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    function evidenceCard(item) {
      const evidence = item.evidence_summary || {};
      const probe = item.probe_contract || {};
      const checksByCategory = {};
      for (const check of item.checks || []) {
        checksByCategory[check.category] = (checksByCategory[check.category] || 0) + 1;
      }
      const checkSummary = Object.entries(checksByCategory)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, count]) => `${category}: ${count}`);
      const triggerText = [
        probe.snapshot_before_and_after ? 'before+after snapshots' : '',
        probe.snapshot_after ? 'after snapshot' : '',
        probe.before_trigger ? `before: ${probe.before_trigger}` : '',
        probe.after_trigger ? `after: ${probe.after_trigger}` : '',
      ].filter(Boolean);
      return `
        <div class="panel" style="box-shadow: none;">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">Captured Evidence</h3>
              <div class="panel-subtitle">Declared probe paths, observed artifact metadata, and deterministic checks that consumed this evidence.</div>
            </div>
            <span class="pill ${evidence.expected_result === 'fail' ? 'warn' : 'info'}">${evidence.expected_result || 'observed'}</span>
          </div>
          <div class="panel-body grid">
            <div class="evidence-grid">
              <div class="evidence-panel">
                <div class="small-label">Probe capture contract</div>
                ${chips(probe.capture || [], 'No probe paths declared.')}
              </div>
              <div class="evidence-panel">
                <div class="small-label">Snapshot timing</div>
                ${chips(triggerText, 'Default after-run evidence only.')}
              </div>
              <div class="evidence-panel">
                <div class="small-label">Evidence metadata</div>
                <div class="category-meta" style="margin-top: 8px;">
                  <span>source: ${text(evidence.evidence_source)}</span>
                  <span>generated code: ${evidence.has_generated_code ? 'yes' : 'no'}</span>
                  <span>observed from: ${text(evidence.observed_from)}</span>
                </div>
              </div>
              <div class="evidence-panel">
                <div class="small-label">Checks by category</div>
                ${chips(checkSummary, 'No deterministic checks recorded.')}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function renderCaseDetail() {
      const item = scorecard.cases.find((candidate) => caseKey(candidate) === state.selectedCaseKey);
      if (!item) {
        $('caseDetail').innerHTML = '<div class="empty">Select a case to review.</div>';
        return;
      }
      const failed = failedChecks(item);
      $('caseDetail').innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">${item.skill} / ${item.case_id} - ${item.case_name}</h2>
              <div class="panel-subtitle">${item.category} / ${item.duration_ms} ms / ${item.evidence_path}</div>
            </div>
            <span class="pill ${resultClass(item.result)}">${item.result.toUpperCase()} ${pct(item.score)}</span>
          </div>
          <div class="panel-body grid">
            <div>
              <div class="small-label" style="margin-bottom: 7px;">Prompt</div>
              <div class="prompt">${item.task || 'No prompt recorded.'}</div>
            </div>
            ${provenanceCard(item)}
            ${evidenceCard(item)}
            ${visualCard(item)}
            ${failed.length ? `
              <div>
                <div class="small-label" style="margin-bottom: 7px;">Failed checks</div>
                <div class="failure-list">
                  ${failed.map((check) => `
                    <div class="failure">
                      <div class="failure-title">${check.check_id} / ${check.category}</div>
                      <div class="failure-detail">${check.detail}</div>
                      <div class="evidence">actual=${jsonText(check.actual)} / expected=${jsonText(check.expected)} / tolerance=${jsonText(check.tolerance)}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            <div>
              <div class="small-label" style="margin-bottom: 7px;">All deterministic checks</div>
              <div class="check-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Category</th>
                      <th>Critical</th>
                      <th>Result</th>
                      <th>Actual</th>
                      <th>Expected</th>
                      <th>Tolerance</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${item.checks.map((check) => `
                      <tr>
                        <td><span class="mono">${check.check_id}</span><div class="small-label">${check.type}</div></td>
                        <td>${check.category}</td>
                        <td>${check.critical ? '<span class="pill fail">critical</span>' : '<span class="pill info">advisory</span>'}</td>
                        <td><span class="pill ${resultClass(check.result)}">${check.result}</span></td>
                        <td><div class="json">${jsonText(check.actual)}</div></td>
                        <td><div class="json">${jsonText(check.expected)}</div></td>
                        <td><div class="json">${jsonText(check.tolerance)}</div></td>
                        <td>${check.detail}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function renderFailures() {
      const failures = scorecard.critical_failures || [];
      if (!failures.length) {
        $('failureList').innerHTML = '<div class="empty">No critical failures in this scorecard.</div>';
        return;
      }
      $('failureList').innerHTML = failures.map((failure) => `
        <div class="failure">
          <div class="failure-title">${failure.skill} / ${failure.case_id} / ${failure.check_id}</div>
          <div class="category-meta" style="margin-top: 7px;">
            <span class="pill fail">${failure.category}</span>
            <span>${failure.case_name}</span>
          </div>
          <div class="failure-detail">${failure.detail}</div>
          <div class="evidence">Evidence: ${failure.evidence_path}</div>
          <div class="evidence">Actual: ${jsonText(failure.actual)}</div>
          <div class="evidence">Expected: ${jsonText(failure.expected)}</div>
          <div class="evidence">Tolerance: ${jsonText(failure.tolerance)}</div>
        </div>
      `).join('');
    }

    function renderVisualReview() {
      const summary = scorecard.visual_summary || {};
      const result = summary.result || 'not_required';
      $('visualResultPill').textContent = visualLabel(result);
      $('visualResultPill').className = `pill ${visualClass(result)}`;
      $('visualReviewed').textContent = `${summary.reviewed_count || 0}/${summary.total_cases || scorecard.cases.length}`;
      $('visualRequired').textContent = summary.required_count || 0;
      $('visualNeeds').textContent = (summary.needs_review_count || 0) + (summary.not_reviewed_count || 0);
      $('visualBlocking').textContent = (summary.blocking_failures || []).length;

      const cases = scorecard.cases
        .slice()
        .sort((a, b) => {
          const aStatus = visualReview(a).status;
          const bStatus = visualReview(b).status;
          const rank = { fail: 0, needs_review: 1, not_reviewed: 2, pass: 3, not_applicable: 4 };
          return (rank[aStatus] ?? 5) - (rank[bStatus] ?? 5) || caseKey(a).localeCompare(caseKey(b));
        });

      if (!summary.visual_review_supplied && result === 'not_required') {
        $('visualSummaryList').innerHTML = `
          <div class="empty">No qualitative visual review has been attached yet. Run the scorecard with --visual-review to make render assessment part of this evaluation artifact.</div>
          ${cases.map((item) => visualCard(item)).join('')}
        `;
        return;
      }

      $('visualSummaryList').innerHTML = cases.map((item) => visualCard(item)).join('');
    }

    function renderFocus() {
      if (!focus || !focus.focus_required) {
        $('focusList').innerHTML = '<div class="empty">No optimization focus hints were supplied or required for this scorecard.</div>';
        return;
      }
      const categoryHtml = (focus.categories || []).map((category) => `
        <div class="focus-item">
          <div class="category-top">
            <div class="category-name">${category.category}</div>
            <span class="pill ${category.critical_failures ? 'fail' : 'warn'}">${pct(category.score)}</span>
          </div>
          <div class="category-meta" style="margin-top: 8px;">
            <span>${category.failed_checks} failed checks</span>
            <span>${category.critical_failures} critical</span>
            <span>${(category.affected_cases || []).join(', ') || 'no affected cases listed'}</span>
          </div>
        </div>
      `).join('');
      const caseHtml = (focus.cases || []).map((item) => `
        <div class="panel" style="box-shadow: none;">
          <div class="panel-head">
            <div>
              <h3 class="panel-title">${item.skill} / ${item.case_id} - ${item.case_name}</h3>
              <div class="panel-subtitle">${item.evidence_path}</div>
            </div>
            <span class="pill warn">${pct(item.score)}</span>
          </div>
          <div class="panel-body">
            <div class="failure-list">
              ${item.failed_checks.map((check) => `
                <div class="failure">
                  <div class="failure-title">${check.check_id} / ${check.category}</div>
                  <div class="failure-detail">${check.detail}</div>
                  <div class="evidence">actual=${jsonText(check.actual)} / expected=${jsonText(check.expected)} / tolerance=${jsonText(check.tolerance)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('');
      $('focusList').innerHTML = categoryHtml + caseHtml;
    }

    function commandBlock(title, command, note) {
      if (!command) return '';
      return `
        <div class="command-box">
          <div class="category-top">
            <div>
              <div class="category-name">${title}</div>
              <div class="panel-subtitle">${note || ''}</div>
            </div>
            <button class="button" data-copy="${command.replaceAll('"', '&quot;')}">Copy</button>
          </div>
          <pre><code>${command}</code></pre>
        </div>
      `;
    }

    function renderLaunch() {
      const skills = launch.recommended_skills || [];
      const skillText = skills.length ? skills.join(', ') : 'none';
      $('launchList').innerHTML = `
        <div class="focus-item">
          <div class="category-top">
            <div>
              <div class="category-name">Recommended skills</div>
              <div class="panel-subtitle">${skillText}</div>
            </div>
            <span class="pill ${skills.length ? 'warn' : 'pass'}">${skills.length} selected</span>
          </div>
        </div>
        ${commandBlock('Dry-run launcher', launch.dry_run_command, 'Validates selected skills and writes proposer decision seeds without invoking the optimization loop.')}
        ${commandBlock('Live optimization launcher', launch.live_command, 'Starts the autonomous local optimization loop for the scorecard-recommended skills.')}
      `;
      document.querySelectorAll('[data-copy]').forEach((button) => {
        button.addEventListener('click', async () => {
          await navigator.clipboard.writeText(button.dataset.copy);
          button.textContent = 'Copied';
          setTimeout(() => { button.textContent = 'Copy'; }, 1200);
        });
      });
    }

    function setSection(section) {
      state.section = section;
      document.querySelectorAll('.section').forEach((el) => el.classList.toggle('active', el.id === section));
      document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.section === section));
    }

    function renderAll() {
      renderShell();
      renderCategoryOptions();
      renderCategories();
      renderPriorities();
      renderCaseList();
      renderFailures();
      renderVisualReview();
      renderFocus();
      renderLaunch();
    }

    document.querySelectorAll('.nav button').forEach((button) => {
      button.addEventListener('click', () => setSection(button.dataset.section));
    });
    $('search').addEventListener('input', (event) => { state.search = event.target.value; renderCaseList(); });
    $('resultFilter').addEventListener('change', (event) => { state.result = event.target.value; renderCaseList(); });
    $('categoryFilter').addEventListener('change', (event) => { state.category = event.target.value; renderCaseList(); });
    $('resetFilters').addEventListener('click', () => {
      state.search = '';
      state.result = 'all';
      state.category = 'all';
      $('search').value = '';
      $('resultFilter').value = 'all';
      $('categoryFilter').value = 'all';
      renderCaseList();
    });
    $('openFailing').addEventListener('click', () => {
      const failed = scorecard.cases.find((item) => item.result === 'fail') ||
        scorecard.cases.find((item) => ['fail', 'needs_review', 'not_reviewed'].includes(visualReview(item).status));
      if (failed) state.selectedCaseKey = caseKey(failed);
      setSection('queue');
      state.result = failed && failed.result === 'fail' ? 'fail' : 'all';
      $('resultFilter').value = state.result;
      renderCaseList();
    });
    $('toggleTheme').addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = next;
      $('toggleTheme').textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
    });

    renderAll();
  </script>
</body>
</html>
"""


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_json_script(data: Any) -> str:
    return json.dumps(data, ensure_ascii=True).replace("</", "<\\/")


def display_path(path_value: str | None) -> str | None:
    if not path_value:
        return None
    path = Path(path_value)
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except (OSError, ValueError):
        return path.as_posix()


def shell_arg(value: str) -> str:
    return shlex.quote(value)


def recommended_skills_from_focus(focus: dict[str, Any] | None) -> list[str]:
    if not focus:
        return []
    skills = [str(item["skill"]) for item in focus.get("skills", []) if item.get("skill")]
    if not skills:
        skills = [str(case["skill"]) for case in focus.get("cases", []) if case.get("skill")]
    out = []
    for skill in skills:
        if skill not in out:
            out.append(skill)
    return out


def launch_payload(
    scorecard_path: str | None,
    focus_path: str | None,
    focus: dict[str, Any] | None,
) -> dict[str, Any]:
    scorecard_ref = display_path(scorecard_path)
    focus_ref = display_path(focus_path)
    source_flag = "--from-scorecard"
    source_ref = scorecard_ref
    if focus_ref:
        source_flag = "--from-focus"
        source_ref = focus_ref

    base = (
        f"python3 optimization/scripts/run-all-evals.py {source_flag} {shell_arg(source_ref)} "
        "--max-iterations 1 --stop-on regression"
    ) if source_ref else ""
    return {
        "recommended_skills": recommended_skills_from_focus(focus),
        "dry_run_command": f"{base} --dry-run" if base else "",
        "live_command": base if base else "",
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scorecard", help="Path to scorecard.json")
    parser.add_argument("--focus", help="Optional optimization focus JSON")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output HTML path")
    return parser.parse_args(argv)


def build_html(
    scorecard: dict[str, Any],
    focus: dict[str, Any] | None,
    launch: dict[str, Any] | None = None,
) -> str:
    focus_payload = focus or {
        "schema_version": "1.0",
        "source_run_id": scorecard.get("run_id", ""),
        "focus_required": False,
        "categories": [],
        "cases": [],
    }
    return (
        HTML_TEMPLATE
        .replace("__SCORECARD_JSON__", safe_json_script(scorecard))
        .replace("__FOCUS_JSON__", safe_json_script(focus_payload))
        .replace("__LAUNCH_JSON__", safe_json_script(launch or launch_payload(None, None, focus)))
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    scorecard = load_json(Path(args.scorecard))
    focus = load_json(Path(args.focus)) if args.focus else None
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    launch = launch_payload(args.scorecard, args.focus, focus)
    output.write_text(build_html(scorecard, focus, launch), encoding="utf-8")
    print(f"[build-review-ui] wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
