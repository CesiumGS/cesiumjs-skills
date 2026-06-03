#!/usr/bin/env python3
"""Build the BASELINE-AUDIT static review UI from an evaluation scorecard.

This is a self-contained, single-file HTML generator (no build step). The
scorecard JSON is embedded inline, and render screenshots are referenced as
``../../<repo-relative path>`` so the page works when served from the repo root
(or opened directly from ``evaluation/artifacts/review-ui/``).

The UI models proven scorecard/observability designs and makes BASELINE AUDIT
the primary task:

  - Datadog-style header KPI strip + Lighthouse-style radial health gauge.
  - Worst-first Audit Board with Accept / Flag-for-optimization toggles
    (score-based auto-suggest, else Pending) persisted to localStorage and
    exportable as JSON.
  - Skill x Category dual-heat matrix (deterministic pass-rate + qualitative).
  - Test-report style case drill-down (qualitative 0-10 card + full
    deterministic check table + large baseline screenshot).
  - Critical-failures list and a two-lane legend (deterministic gating,
    qualitative advisory; never averaged).

Two lanes, never averaged: deterministic checks are the binding gate;
the 0-10 qualitative judge is advisory and can only downgrade, never upgrade.

CLI:
    build-audit-ui.py <scorecard.json> [--output <path>]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "evaluation" / "artifacts" / "review-ui" / "audit.html"


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skill Evaluation Dashboard</title>
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
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr); }

    .sidebar {
      position: sticky; top: 0; height: 100vh; overflow: auto;
      border-right: 1px solid var(--border);
      background: linear-gradient(180deg, var(--panel), var(--panel-3));
      padding: 18px;
    }
    .brand { display: grid; gap: 6px; margin-bottom: 16px; }
    .brand-kicker { color: var(--focus); font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; }
    .brand-title { margin: 0; font-size: 23px; line-height: 1.1; }
    .brand-subtitle { color: var(--muted); font-size: 12.5px; line-height: 1.45; }

    .nav { display: grid; gap: 6px; margin: 14px 0; }
    .nav button {
      width: 100%; border: 1px solid transparent; background: transparent; color: var(--muted);
      border-radius: 6px; padding: 9px 10px; text-align: left;
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
    }
    .nav button:hover { background: var(--panel-2); color: var(--text); }
    .nav button.active { background: var(--blue-bg); color: var(--text); border-color: color-mix(in srgb, var(--blue) 30%, var(--border)); }
    .nav .count { font-size: 11px; color: var(--muted); }

    .side-actions { display: grid; gap: 8px; margin-top: 16px; }
    .button {
      border: 1px solid var(--border); background: var(--panel-2); color: var(--text);
      border-radius: 6px; padding: 9px 10px; font-size: 13px;
    }
    .button.primary { background: var(--blue); color: #06101e; border-color: var(--blue); font-weight: 800; }
    body[data-theme="light"] .button.primary { color: #ffffff; }

    .pill {
      display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border);
      border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 750; white-space: nowrap;
    }
    .pill.pass { color: var(--green); background: var(--green-bg); border-color: color-mix(in srgb, var(--green) 35%, var(--border)); }
    .pill.fail { color: var(--red); background: var(--red-bg); border-color: color-mix(in srgb, var(--red) 35%, var(--border)); }
    .pill.warn { color: var(--amber); background: var(--amber-bg); border-color: color-mix(in srgb, var(--amber) 35%, var(--border)); }
    .pill.info { color: var(--blue); background: var(--blue-bg); border-color: color-mix(in srgb, var(--blue) 35%, var(--border)); }
    .pill.violet { color: var(--violet); background: var(--violet-bg); border-color: color-mix(in srgb, var(--violet) 35%, var(--border)); }
    .pill.muted { color: var(--muted); }

    .main { min-width: 0; padding: 22px; max-width: 1640px; width: 100%; }

    /* ---- KPI strip ---- */
    .kpi-strip {
      display: grid; gap: 12px; margin-bottom: 18px;
      grid-template-columns: 1.1fr 1.1fr 1fr 1fr 1fr;
    }
    .kpi {
      border: 1px solid var(--border); background: var(--panel); border-radius: 10px;
      padding: 14px; box-shadow: var(--shadow); display: grid; gap: 6px; align-content: start; min-height: 118px;
    }
    .kpi .kpi-label { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; }
    .kpi .kpi-value { font-size: 30px; font-weight: 800; line-height: 1; }
    .kpi .kpi-sub { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
    .kpi.gauge-kpi { grid-row: span 1; align-items: center; }
    .gauge-wrap { display: flex; gap: 14px; align-items: center; }
    .gauge { position: relative; width: 96px; height: 96px; flex: 0 0 auto; }
    .gauge svg { transform: rotate(-90deg); display: block; }
    .gauge .gauge-text {
      position: absolute; inset: 0; display: grid; place-items: center;
      font-size: 22px; font-weight: 850;
    }
    .gauge-meta { display: grid; gap: 6px; }

    .context-line {
      display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
      color: var(--muted); font-size: 12.5px; margin-bottom: 16px;
      padding: 10px 12px; border: 1px solid var(--border); background: var(--panel-3); border-radius: 8px;
    }
    .context-line .mono { color: var(--text); }

    /* ---- toolbar ---- */
    .toolbar {
      position: sticky; top: 0; z-index: 10; display: grid;
      grid-template-columns: minmax(200px, 1.4fr) repeat(5, auto) auto;
      gap: 9px; align-items: center; margin: -4px -22px 18px; padding: 12px 22px;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      border-bottom: 1px solid var(--border); backdrop-filter: blur(10px);
    }
    .search, .select {
      min-width: 0; border: 1px solid var(--border); background: var(--panel); color: var(--text);
      border-radius: 6px; padding: 8px 10px; outline: none; font-size: 13px;
    }
    .search:focus, .select:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent); }

    .section { display: none; }
    .section.active { display: block; }

    .panel {
      border: 1px solid var(--border); background: var(--panel); border-radius: 10px;
      box-shadow: var(--shadow); min-width: 0;
    }
    .panel-head {
      display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;
      padding: 14px; border-bottom: 1px solid var(--border);
    }
    .panel-title { margin: 0; font-size: 16px; line-height: 1.25; }
    .panel-subtitle { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .panel-body { padding: 14px; min-width: 0; }

    .grid { display: grid; gap: 14px; min-width: 0; }
    .grid > * { min-width: 0; }
    .grid.two { grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr); align-items: start; }

    /* ---- audit board ---- */
    .audit-list { display: grid; gap: 12px; }
    .audit-card {
      display: grid; grid-template-columns: 132px minmax(0,1fr) auto; gap: 14px;
      border: 1px solid var(--border); background: var(--panel); border-radius: 10px; padding: 12px;
      box-shadow: var(--shadow); scroll-margin-top: 80px;
    }
    .audit-card.cursor { outline: 2px solid var(--focus); outline-offset: 1px; }
    .audit-card.decided-accept { border-left: 4px solid var(--green); }
    .audit-card.decided-flag { border-left: 4px solid var(--red); }
    .thumb {
      position: relative; width: 132px; height: 88px; border-radius: 8px; overflow: hidden;
      background: var(--panel-3); border: 1px solid var(--border); display: grid; place-items: center;
    }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb img.missing { display: none; }
    .thumb .thumb-missing { display: none; color: var(--muted); font-size: 10.5px; text-align: center; padding: 6px; }
    .thumb img.missing ~ .thumb-missing { display: block; }
    .audit-body { display: grid; gap: 8px; align-content: start; }
    .audit-head-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .audit-key { font-weight: 800; overflow-wrap: anywhere; }
    .audit-name { color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
    .audit-pills { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
    .audit-controls { display: grid; gap: 8px; align-content: start; min-width: 188px; }
    .toggle-2 { display: grid; gap: 3px; justify-items: start; }
    .toggle-3 { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .toggle-3 button {
      border: 0; background: var(--panel-2); color: var(--muted); padding: 7px 9px; font-size: 12px;
      font-weight: 700; border-right: 1px solid var(--border); white-space: nowrap;
    }
    .toggle-3 button:last-child { border-right: 0; }
    .toggle-3 button.on-accept { background: var(--green-bg); color: var(--green); }
    .toggle-3 button.on-flag { background: var(--red-bg); color: var(--red); }
    /* suggested (auto, not yet confirmed): outlined + dimmed, not solid */
    .toggle-3 button.suggested { opacity: 0.78; background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }
    .toggle-3 button.suggested.on-accept { color: var(--green); }
    .toggle-3 button.suggested.on-flag { color: var(--red); }
    .suggest-tag { font-size: 10.5px; color: var(--muted); font-style: italic; }
    .note-field {
      width: 100%; border: 1px solid var(--border); background: var(--panel); color: var(--text);
      border-radius: 6px; padding: 6px 8px; font-size: 12px; resize: vertical; min-height: 34px;
    }
    .score-chip { font-variant-numeric: tabular-nums; }

    /* ---- matrix ---- */
    .matrix-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
    table.matrix { border-collapse: collapse; width: 100%; min-width: 760px; }
    table.matrix th, table.matrix td { border: 1px solid var(--border); padding: 0; text-align: center; font-size: 12px; }
    table.matrix th { background: var(--panel-2); color: var(--muted); padding: 8px 6px; position: sticky; top: 0; }
    table.matrix th.rowhead, table.matrix td.rowhead {
      text-align: left; padding: 8px 10px; position: sticky; left: 0; background: var(--panel-2);
      color: var(--text); font-weight: 700; z-index: 1; white-space: nowrap;
    }
    .heat-cell { width: 100%; height: 100%; min-height: 42px; display: grid; gap: 2px; padding: 5px 4px; cursor: pointer; }
    .heat-cell:hover { outline: 2px solid var(--focus); outline-offset: -2px; }
    .heat-cell.empty { cursor: default; color: var(--muted); }
    .heat-num { font-weight: 800; font-variant-numeric: tabular-nums; }
    .heat-strip { height: 5px; border-radius: 999px; background: var(--border); overflow: hidden; }
    .heat-strip span { display: block; height: 100%; }
    .matrix-legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; color: var(--muted); font-size: 12px; }
    .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--border); vertical-align: middle; margin-right: 5px; }

    /* ---- drill-down ---- */
    .drill-list { max-height: calc(100vh - 150px); overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
    .drill-row {
      width: 100%; border: 0; border-bottom: 1px solid var(--border); background: var(--panel);
      color: var(--text); text-align: left; padding: 11px 12px;
    }
    .drill-row:hover { background: var(--panel-2); }
    .drill-row.active { background: var(--blue-bg); box-shadow: inset 3px 0 0 var(--blue); }
    .drill-row .k { font-weight: 800; overflow-wrap: anywhere; }
    .drill-row .m { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .drill-cols { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 14px; align-items: start; }

    .prompt {
      border: 1px solid var(--border); background: var(--panel-3); border-radius: 8px; padding: 12px;
      line-height: 1.5; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .big-shot { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--panel-3); position: relative; }
    .big-shot img { display: block; width: 100%; max-height: 520px; object-fit: contain; background: var(--panel-3); }
    .big-shot img.missing { display: none; }
    .big-shot .shot-missing {
      display: none; padding: 40px; text-align: center; color: var(--amber); background: var(--amber-bg); min-height: 160px;
      place-items: center;
    }
    .big-shot img.missing ~ .shot-missing { display: grid; }
    .shot-caption { padding: 8px 10px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }

    .qual-card { border: 1px solid color-mix(in srgb, var(--violet) 30%, var(--border)); background: color-mix(in srgb, var(--violet) 9%, var(--panel)); border-radius: 10px; padding: 14px; display: grid; gap: 12px; }
    .qual-card.fail { border-color: color-mix(in srgb, var(--red) 35%, var(--border)); background: var(--red-bg); }
    .qual-card.warn { border-color: color-mix(in srgb, var(--amber) 35%, var(--border)); background: var(--amber-bg); }
    .qual-card.pass { border-color: color-mix(in srgb, var(--green) 35%, var(--border)); background: var(--green-bg); }
    .qual-top { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .dim-grid { display: grid; gap: 8px; }
    .dim-row { display: grid; grid-template-columns: 220px 56px 1fr; gap: 10px; align-items: center; padding: 7px 0; border-top: 1px solid var(--border); }
    .dim-row:first-child { border-top: 0; }
    .dim-name { font-weight: 700; font-size: 13px; }
    .dim-score { font-weight: 800; font-variant-numeric: tabular-nums; text-align: right; }
    .dim-bar { height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
    .dim-bar span { display: block; height: 100%; }
    .dim-note { color: var(--muted); font-size: 12px; line-height: 1.4; margin-top: 3px; grid-column: 1 / -1; }
    .badge-row { display: flex; flex-wrap: wrap; gap: 7px; }
    .flag-badge { border: 1px solid color-mix(in srgb, var(--red) 35%, var(--border)); background: var(--red-bg); color: var(--red); border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 700; }

    .check-table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 10px; max-width: 100%; }
    table.checks { width: 100%; border-collapse: collapse; min-width: 940px; }
    table.checks th, table.checks td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; text-align: left; font-size: 12.5px; }
    table.checks th { color: var(--muted); background: var(--panel-2); font-size: 11.5px; text-transform: uppercase; position: sticky; top: 0; }
    table.checks tr.failrow { background: var(--red-bg); }
    table.checks tr.failrow.critical td:first-child { box-shadow: inset 3px 0 0 var(--red); }
    code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    .json { max-width: 280px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); font-size: 12px; }

    .failure-list { display: grid; gap: 10px; }
    .failure {
      border: 1px solid color-mix(in srgb, var(--red) 30%, var(--border)); background: var(--red-bg);
      border-radius: 8px; padding: 12px; min-width: 0;
    }
    .failure-title { font-weight: 850; overflow-wrap: anywhere; }
    .failure-detail { margin-top: 8px; line-height: 1.45; overflow-wrap: anywhere; }
    .evidence { color: var(--muted); margin-top: 7px; font-size: 12px; overflow-wrap: anywhere; }

    .lane-legend { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
    .lane {
      border: 1px solid var(--border); border-radius: 10px; padding: 14px; background: var(--panel-2); display: grid; gap: 8px;
    }
    .lane.det { border-color: color-mix(in srgb, var(--blue) 35%, var(--border)); }
    .lane.qual { border-color: color-mix(in srgb, var(--violet) 35%, var(--border)); }
    .lane h3 { margin: 0; font-size: 15px; }
    .lane p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .lane .tag { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }

    /* ---- optimization handoff ---- */
    .handoff-headline { font-size: 19px; font-weight: 800; line-height: 1.25; }
    .handoff-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .handoff-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .handoff-chip {
      border: 1px solid color-mix(in srgb, var(--blue) 30%, var(--border)); background: var(--blue-bg);
      color: var(--text); border-radius: 999px; padding: 5px 11px; font-size: 12.5px; font-weight: 700;
    }
    .handoff-chip .chip-count { color: var(--muted); font-weight: 600; margin-left: 4px; }
    .handoff-chip:hover { border-color: var(--focus); }
    .handoff-controls { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; margin: 8px 0 16px; }
    .handoff-controls label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    .handoff-controls input[type="number"], .handoff-controls select {
      border: 1px solid var(--border); background: var(--panel); color: var(--text);
      border-radius: 6px; padding: 7px 9px; font-size: 13px; min-width: 110px;
    }
    .cmd-block { margin-top: 14px; }
    .cmd-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 6px; }
    .cmd-label { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; font-weight: 750; }
    .cmd-pre {
      margin: 0; border: 1px solid var(--border); background: var(--panel-3); border-radius: 8px;
      padding: 12px; overflow: auto; max-width: 100%;
    }
    .cmd-pre code { font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); }
    .copy-btn { padding: 5px 11px; font-size: 12px; }
    .copy-btn.copied { color: var(--green); border-color: color-mix(in srgb, var(--green) 35%, var(--border)); background: var(--green-bg); }

    .empty { border: 1px dashed var(--border); border-radius: 8px; padding: 24px; text-align: center; color: var(--muted); background: var(--panel); }
    .small-label { color: var(--muted); font-size: 12px; }
    .footer-note { margin-top: 22px; color: var(--muted); font-size: 12px; }
    .kbd { display: inline-block; border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 11px; background: var(--panel-3); font-family: ui-monospace, monospace; }

    @media (max-width: 1240px) {
      .kpi-strip { grid-template-columns: repeat(2, 1fr); }
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: relative; height: auto; }
    }
    @media (max-width: 880px) {
      .toolbar { grid-template-columns: 1fr 1fr; position: relative; margin: 0 0 14px; }
      .grid.two, .drill-cols, .lane-legend { grid-template-columns: 1fr; }
      .audit-card { grid-template-columns: 1fr; }
      .thumb { width: 100%; height: 150px; }
      .drill-list { max-height: none; }
    }
  </style>
</head>
<body data-theme="dark">
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-kicker">Skill evaluation</div>
        <h1 class="brand-title">Skill Evaluation Dashboard</h1>
        <div class="brand-subtitle">Two lanes per render: Programmatic checks gate the result; the 0-10 Visual quality judge is advisory. Review every rendered baseline and decide Accept or Flag for optimization (borderline cases stay Pending).</div>
      </div>

      <nav class="nav" aria-label="Evaluation sections">
        <button class="active" data-section="board">Review Queue <span class="count" id="navBoard">0</span></button>
        <button data-section="handoff">Optimization handoff <span class="count" id="navHandoff">0</span></button>
        <button data-section="matrix">Skill x Category Matrix <span class="count" id="navMatrix">0</span></button>
        <button data-section="drill">Case Drill-down <span class="count" id="navDrill">0</span></button>
        <button data-section="failures">Critical Failures <span class="count" id="navFailures">0</span></button>
        <button data-section="help">How to read this</button>
      </nav>

      <div class="side-actions">
        <button class="button primary" id="jumpNext">Jump to next unreviewed</button>
        <button class="button" id="exportDecisions">Export review decisions (JSON)</button>
        <button class="button" id="toggleTheme">Light mode</button>
      </div>
      <div class="footer-note" style="margin-top:14px;">Keyboard on board: <span class="kbd">j</span>/<span class="kbd">k</span> move, <span class="kbd">a</span> accept, <span class="kbd">f</span> flag for optimization.</div>
    </aside>

    <main class="main">
      <div class="kpi-strip">
        <div class="kpi">
          <div class="kpi-label">Review progress</div>
          <div class="kpi-value" id="kpiAuditCount">0/0</div>
          <div class="kpi-sub">
            <span class="pill pass" id="kpiAccepted">0 accepted</span>
            <span class="pill fail" id="kpiFlagged">0 flagged for optimization</span>
            <span class="pill warn" id="kpiPending">0 pending</span>
          </div>
        </div>
        <div class="kpi gauge-kpi">
          <div class="gauge-wrap">
            <div class="gauge" id="healthGauge"></div>
            <div class="gauge-meta">
              <div class="kpi-label">Programmatic score</div>
              <span class="pill" id="kpiOverallPill">RESULT</span>
              <div class="small-label" id="kpiOverallSub">combined gate (programmatic + visual)</div>
            </div>
          </div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Programmatic pass-rate</div>
          <div class="kpi-value" id="kpiPassRate">0%</div>
          <div class="kpi-sub"><span id="kpiPassRateSub">0/0 categories</span></div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Mean visual quality</div>
          <div class="kpi-value" id="kpiMeanQual">-</div>
          <div class="kpi-sub"><span id="kpiMeanQualSub">0-10 advisory</span></div>
        </div>
        <div class="kpi" id="kpiBaselinesFlaggedTile" style="cursor:pointer" title="Open optimization handoff">
          <div class="kpi-label">Baselines flagged</div>
          <div class="kpi-value" id="kpiBaselinesFlagged">0</div>
          <div class="kpi-sub"><span id="kpiBaselinesFlaggedSub">for optimization</span></div>
        </div>
      </div>

      <div class="context-line" id="contextLine"></div>

      <div class="toolbar">
        <input class="search" id="search" type="search" placeholder="Search skill, case, prompt, flag, check detail">
        <select class="select" id="resultFilter"><option value="all">All results</option><option value="fail">Programmatic: Fail</option><option value="pass">Programmatic: Pass</option></select>
        <select class="select" id="qualFilter"><option value="all">All visual quality</option><option value="fail">Visual quality: Fail</option><option value="needs_review">Needs review</option><option value="pass">Visual quality: Pass</option><option value="not_reviewed">Not reviewed</option></select>
        <select class="select" id="categoryFilter"><option value="all">All categories</option></select>
        <select class="select" id="auditFilter"><option value="all">Any review state</option><option value="pending">Pending</option><option value="accept">Accepted</option><option value="flag">Flagged for optimization</option></select>
        <select class="select" id="skillFilter"><option value="all">All skills</option></select>
        <button class="button" id="resetFilters">Reset</button>
      </div>

      <section id="board" class="section active">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Review Queue</h2>
              <div class="panel-subtitle">Worst-first: programmatic fail, then visual-quality fail / needs-review, then lowest score. <span id="boardVisible">0</span> visible.</div>
            </div>
          </div>
          <div class="panel-body"><div class="audit-list" id="auditList"></div></div>
        </div>
      </section>

      <section id="handoff" class="section" data-section="handoff">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Optimization handoff</h2>
              <div class="panel-subtitle">These are the skills whose baselines you flagged. Hand this batch to the optimization loop to improve their guidance, then re-run the evaluation.</div>
            </div>
            <label class="small-label" style="display:flex;align-items:center;gap:7px;white-space:nowrap">
              <input type="checkbox" id="handoffConfirmedOnly"> Only confirmed decisions
            </label>
          </div>
          <div class="panel-body" id="handoffBody"></div>
        </div>
      </section>

      <section id="matrix" class="section">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Skill x Category Matrix</h2>
              <div class="panel-subtitle">Dual heat: programmatic pass-rate color + visual-quality 0-10 strip. Click a cell to drill into those cases.</div>
            </div>
            <select class="select" id="matrixMode"><option value="det">Color: programmatic</option><option value="qual">Color: visual quality</option></select>
          </div>
          <div class="panel-body">
            <div class="matrix-wrap"><table class="matrix" id="matrixTable"></table></div>
            <div class="matrix-legend" id="matrixLegend"></div>
          </div>
        </div>
      </section>

      <section id="drill" class="section">
        <div class="drill-cols">
          <div class="panel">
            <div class="panel-head"><div><h2 class="panel-title">Cases</h2><div class="panel-subtitle"><span id="drillVisible">0</span> visible</div></div></div>
            <div class="drill-list" id="drillList"></div>
          </div>
          <div id="drillDetail"></div>
        </div>
      </section>

      <section id="failures" class="section">
        <div class="panel">
          <div class="panel-head"><div><h2 class="panel-title">Critical Failures</h2><div class="panel-subtitle">Gate-blocking programmatic failures with evidence and actual-vs-expected.</div></div></div>
          <div class="panel-body"><div class="failure-list" id="failureList"></div></div>
        </div>
      </section>

      <section id="help" class="section">
        <div class="panel">
          <div class="panel-head"><div><h2 class="panel-title">How to read this</h2><div class="panel-subtitle">Two lanes, never averaged.</div></div></div>
          <div class="panel-body">
            <div class="lane-legend">
              <div class="lane det">
                <span class="tag" style="color:var(--blue)">Programmatic checks - gating</span>
                <h3>Programmatic checks</h3>
                <p>CI-safe assertions over captured scene state: distances, axes, mutation contracts, camera geometry, asset/provider safety. A single critical failure fails the gate. This lane is binding and Python-owned. <code>overall_result = pass</code> requires the programmatic lane to pass.</p>
              </div>
              <div class="lane qual">
                <span class="tag" style="color:var(--violet)">Visual quality - advisory</span>
                <h3>Static 0-10 visual judge</h3>
                <p>A single-render rubric (render liveness, subject presence, framing, fidelity, artifacts, legibility) scored 0-10. PASS&nbsp;&ge;&nbsp;7.0 &middot; BORDERLINE 4.5-6.9 &middot; FAIL &lt;&nbsp;4.5. It can <strong>downgrade</strong> a programmatically passing run (blocking flag) but can <strong>never upgrade</strong> a programmatic failure. The two scores are never averaged.</p>
              </div>
            </div>
            <div style="margin-top:14px;" class="lane">
              <h3>The review task</h3>
              <p>Go case-by-case (worst-first) on the Review Queue. Look at the baseline render and the two lanes, then decide: <strong>Accept</strong> (the render looks good), or <strong>Flag for optimization</strong> (the render is poor — route this skill back through the optimization loop to improve its guidance). Cases you have not yet decided are <strong>Pending</strong>. Each card carries a score-based suggestion (shown outlined/dimmed with a "suggested" caption): Visual quality <em>pass</em> suggests Accept, <em>fail</em> suggests Flag. The Visual quality "needs review" band (borderline) is a signal shown on the card, not a button — those borderline cases are left Pending (un-suggested) for you to decide. A suggestion is only counted as progress once you confirm it (click); clicking the already-selected button again clears it back to Pending. Decisions persist in your browser (localStorage, keyed by run id) and export to JSON.</p>
            </div>
          </div>
        </div>
      </section>

      <div class="footer-note">Generated locally from the evaluation scorecard JSON. This UI is read-only over the scorecard; review decisions live only in your browser until exported.</div>
    </main>
  </div>

  <script id="scorecard-data" type="application/json">__SCORECARD_JSON__</script>
  <script>
    const scorecard = JSON.parse(document.getElementById('scorecard-data').textContent);
    const RUN_ID = scorecard.run_id || 'unknown-run';
    const STORE_KEY = 'baseline-audit:' + RUN_ID;
    const cases = Array.isArray(scorecard.cases) ? scorecard.cases : [];

    const RUBRIC = [
      ['render_liveness', 'Render liveness'],
      ['subject_presence_and_recognizability', 'Subject presence'],
      ['framing_and_composition', 'Framing & composition'],
      ['prompt_and_behavior_fidelity', 'Prompt fidelity'],
      ['visual_correctness_and_artifacts', 'Visual correctness'],
      ['legibility_and_clarity', 'Legibility & clarity'],
    ];

    const state = {
      section: 'board',
      search: '',
      result: 'all',
      qual: 'all',
      category: 'all',
      audit: 'all',
      skill: 'all',
      matrixMode: 'det',
      selectedKey: '',
      cursor: 0,
      handoffConfirmedOnly: false,
    };

    let decisions = {};
    try { decisions = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { decisions = {}; }
    function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(decisions)); } catch (e) {} }

    const $ = (id) => document.getElementById(id);
    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pct = (v) => `${Math.round((Number(v) || 0) * 1000) / 10}%`;
    const jsonText = (v) => v == null ? 'null' : (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    const caseKey = (c) => `${c.skill}/${c.case_id}`;

    // Screenshots are referenced as ABSOLUTE-from-server-root paths (/optimization/
    // runs/...) so the page resolves them regardless of how deep the HTML lives,
    // when served from the repo root (matches build-review-ui.py).
    function assetUrl(p) {
      if (!p) return '';
      if (/^(https?:|file:|data:|blob:)/.test(p)) return p;
      let rel = String(p);
      const marker = rel.indexOf('cesiumjs-skills/');
      if (marker !== -1) rel = rel.slice(marker + 'cesiumjs-skills/'.length);
      rel = rel.replace(/^\/+/, '');
      return '/' + rel;
    }

    function failedChecks(c) { return (c.checks || []).filter((x) => x.result === 'fail'); }
    function criticalFails(c) { return failedChecks(c).filter((x) => x.critical); }

    function vr(c) {
      const r = c.visual_review || {};
      return {
        status: r.status || 'not_reviewed',
        score01: num(r.score),
        overall_score: num(r.overall_score),
        dimensions: r.dimensions || {},
        failure_flags: Array.isArray(r.failure_flags) ? r.failure_flags : [],
        observations: Array.isArray(r.observations) ? r.observations : [],
        risks: Array.isArray(r.risks) ? r.risks : [],
        screenshots: Array.isArray(r.screenshots) ? r.screenshots : (c.screenshots || []),
        summary: r.summary || '',
        reviewer: r.reviewer || '',
        reviewed_at: r.reviewed_at || '',
        reviewed: !!(r.status && r.status !== 'not_reviewed'),
      };
    }

    // Qualitative 0-10: prefer overall_score, fall back to score*10.
    function qual10(c) {
      const v = vr(c);
      if (v.overall_score != null) return v.overall_score;
      if (v.score01 != null) return Math.round(v.score01 * 100) / 10;
      return null;
    }
    // A dimension may be {score:0-10,...} (new) or {status,note} (old).
    function dim10(d) {
      if (!d) return null;
      if (num(d.score) != null) return d.score;
      if (d.status === 'pass') return 9;
      if (d.status === 'needs_review') return 5.5;
      if (d.status === 'fail') return 2;
      return null;
    }

    function resultClass(r) { return r === 'pass' ? 'pass' : 'fail'; }
    function qualClass(status) {
      if (status === 'pass' || status === 'not_applicable') return 'pass';
      if (status === 'fail') return 'fail';
      if (status === 'needs_review' || status === 'not_reviewed') return 'warn';
      return 'violet';
    }
    function label(s) { return String(s || '').replace(/_/g, ' ').toUpperCase(); }
    function scoreColor(t) { return t >= 7 ? 'var(--green)' : (t >= 4.5 ? 'var(--amber)' : 'var(--red)'); }
    function rateColor(r) { return r >= 0.95 ? 'var(--green)' : (r >= 0.8 ? 'var(--amber)' : 'var(--red)'); }

    function decisionOf(c) { return (decisions[caseKey(c)] || {}).decision || ''; }
    function noteOf(c) { return (decisions[caseKey(c)] || {}).note || ''; }
    // Score-based auto-suggestion from the Visual quality status.
    // pass => suggest accept; fail => suggest flag; everything else (needs_review,
    // not_reviewed, null/borderline) => no suggestion (pending).
    function suggestionOf(c) {
      const s = vr(c).status;
      if (s === 'pass') return 'accept';
      if (s === 'fail') return 'flag';
      return '';
    }
    // Effective decision = user's stored choice if present (source 'user'),
    // else the suggestion if any (source 'suggested'), else none (pending).
    function effectiveDecision(c) {
      const u = decisionOf(c);
      if (u) return { decision: u, source: 'user' };
      const s = suggestionOf(c);
      if (s) return { decision: s, source: 'suggested' };
      return { decision: '', source: null };
    }
    function setDecision(c, d) {
      const k = caseKey(c);
      const cur = decisions[k] || {};
      decisions[k] = { ...cur, decision: cur.decision === d ? '' : d, updated_at: new Date().toISOString() };
      persist();
    }
    function setNote(c, note) {
      const k = caseKey(c);
      decisions[k] = { ...(decisions[k] || {}), note, updated_at: new Date().toISOString() };
      persist();
    }

    // worst-first severity rank (lower = worse)
    function severity(c) {
      if (criticalFails(c).length) return 0;
      if (c.result === 'fail') return 1;
      const v = vr(c);
      if (v.status === 'fail') return 2;
      if (v.status === 'needs_review') return 3;
      const q = qual10(c);
      return 4 + (q == null ? 0.5 : q / 10);
    }

    function caseSearchText(c) {
      const v = vr(c);
      return [c.skill, c.case_id, c.case_name, c.task, c.category, v.summary, v.status,
        ...v.failure_flags, ...v.observations, ...v.risks,
        ...(c.checks || []).flatMap((x) => [x.check_id, x.type, x.category, x.detail])].join(' ').toLowerCase();
    }

    function passesFilters(c) {
      const q = state.search.trim().toLowerCase();
      if (state.result !== 'all' && c.result !== state.result) return false;
      if (state.qual !== 'all' && vr(c).status !== state.qual) return false;
      if (state.category !== 'all' && c.category !== state.category && !(c.checks || []).some((x) => x.category === state.category)) return false;
      if (state.skill !== 'all' && c.skill !== state.skill) return false;
      if (state.audit !== 'all') {
        // Pending = not user-confirmed; accept/flag = confirmed by the user.
        const d = decisionOf(c);
        if (state.audit === 'pending' && d) return false;
        if (state.audit === 'accept' && d !== 'accept') return false;
        if (state.audit === 'flag' && d !== 'flag') return false;
      }
      if (q && !caseSearchText(c).includes(q)) return false;
      return true;
    }

    function orderedCases() {
      return cases.filter(passesFilters).sort((a, b) => {
        const s = severity(a) - severity(b);
        if (s !== 0) return s;
        return caseKey(a).localeCompare(caseKey(b));
      });
    }

    /* ---------- gauge ---------- */
    function radialGauge(el, value0to10, big) {
      const v = value0to10 == null ? null : Math.max(0, Math.min(10, value0to10));
      const size = big ? 96 : 64, r = (size / 2) - 8, cx = size / 2, c2 = 2 * Math.PI * r;
      const frac = v == null ? 0 : v / 10;
      const col = v == null ? 'var(--muted)' : scoreColor(v);
      el.innerHTML = `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--border)" stroke-width="8"></circle>
          <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${col}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${c2}" stroke-dashoffset="${c2 * (1 - frac)}"></circle>
        </svg>
        <div class="gauge-text" style="color:${col}">${v == null ? '-' : v.toFixed(1)}</div>`;
    }

    /* ---------- KPI strip ---------- */
    function meanQual() {
      const vals = cases.map(qual10).filter((x) => x != null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    function passRate() {
      const cs = scorecard.category_scores || {};
      const entries = Object.values(cs);
      const passed = entries.filter((d) => Number(d.score) >= (scorecard.threshold || 0.95)).length;
      return { passed, total: entries.length, rate: entries.length ? passed / entries.length : 0 };
    }
    // Progress counts ONLY what the user has explicitly confirmed (source='user').
    // Everything else (un-confirmed, whether suggested or not) is pending.
    function auditTallies() {
      let accept = 0, flag = 0, pending = 0, suggested = 0;
      for (const c of cases) {
        const d = decisionOf(c);
        if (d === 'accept') accept++;
        else if (d === 'flag') flag++;
        else { pending++; if (suggestionOf(c)) suggested++; }
      }
      const confirmed = accept + flag;
      return { accept, flag, pending, suggested, confirmed, audited: confirmed };
    }

    function renderKpis() {
      const overall10 = (num(scorecard.overall_score) != null) ? scorecard.overall_score * 10 : null;
      radialGauge($('healthGauge'), overall10, true);
      const res = scorecard.overall_result || 'unknown';
      $('kpiOverallPill').textContent = label(res);
      $('kpiOverallPill').className = `pill ${resultClass(res)}`;
      $('kpiOverallSub').textContent = `score ${pct(scorecard.overall_score)} (gate ${pct(scorecard.threshold)})`;

      const pr = passRate();
      $('kpiPassRate').textContent = pct(pr.rate);
      $('kpiPassRateSub').textContent = `${pr.passed}/${pr.total} categories ≥ ${pct(scorecard.threshold)}`;

      const mq = meanQual();
      $('kpiMeanQual').textContent = mq == null ? '-' : mq.toFixed(1);
      const vs = scorecard.visual_summary || {};
      const qp = vs.pass_count != null ? vs.pass_count : cases.filter((c) => vr(c).status === 'pass').length;
      const qn = vs.needs_review_count != null ? vs.needs_review_count : cases.filter((c) => vr(c).status === 'needs_review').length;
      const qf = vs.fail_count != null ? vs.fail_count : cases.filter((c) => vr(c).status === 'fail').length;
      $('kpiMeanQualSub').textContent = mq == null ? 'no visual quality scores yet' : `${qp} pass · ${qn} review · ${qf} fail (0-10 advisory)`;

      const t = auditTallies();
      $('kpiAuditCount').textContent = `${t.confirmed}/${cases.length}`;
      $('kpiAccepted').textContent = `${t.accept} accepted`;
      $('kpiFlagged').textContent = `${t.flag} flagged for optimization`;
      const pendingLabel = t.suggested ? `${t.pending} pending (${t.suggested} suggested)` : `${t.pending} pending`;
      $('kpiPending').textContent = pendingLabel;
      $('kpiBaselinesFlagged').textContent = t.flag;

      $('contextLine').innerHTML = [
        ['run', RUN_ID], ['commit', String(scorecard.git_commit || 'unknown').slice(0, 12)],
        ['timestamp', scorecard.timestamp_utc || 'n/a'], ['threshold', pct(scorecard.threshold)],
        ['programmatic result', label(scorecard.deterministic_result || res)],
      ].map(([k, v]) => `<span>${k}: <span class="mono">${esc(v)}</span></span>`).join('');

      $('navBoard').textContent = cases.length;
      $('navHandoff').textContent = distinctFlaggedSkillCount();
      if (state.section === 'handoff') renderHandoff();
      $('navMatrix').textContent = Object.keys(scorecard.category_scores || {}).length;
      $('navDrill').textContent = cases.length;
      $('navFailures').textContent = (scorecard.critical_failures || []).length;
    }

    /* ---------- filters ---------- */
    function fillSelect(el, values, allLabel) {
      el.innerHTML = `<option value="all">${allLabel}</option>` +
        values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    }
    function renderFilterOptions() {
      fillSelect($('categoryFilter'), Object.keys(scorecard.category_scores || {}).sort(), 'All categories');
      fillSelect($('skillFilter'), [...new Set(cases.map((c) => c.skill))].sort(), 'All skills');
    }

    /* ---------- audit board ---------- */
    function detPill(c) {
      const f = failedChecks(c).length, cf = criticalFails(c).length;
      const cls = resultClass(c.result);
      const extra = c.result === 'fail' ? ` &middot; ${f} failed${cf ? `, ${cf} critical` : ''}` : '';
      return `<span class="pill ${cls}">Programmatic: ${label(c.result)}${extra}</span>`;
    }
    function qualPill(c) {
      const v = vr(c), q = qual10(c);
      const scoreText = q == null ? 'not scored' : `<span class="score-chip">${q.toFixed(1)}/10</span>`;
      return `<span class="pill ${qualClass(v.status)}">Visual quality: ${scoreText}</span>`;
    }
    function thumb(c) {
      const shots = vr(c).screenshots;
      const p = shots && shots[0];
      if (!p) return `<div class="thumb"><div class="thumb-missing" style="display:block">no baseline</div></div>`;
      return `<div class="thumb"><img src="${esc(assetUrl(p))}" alt="baseline" loading="lazy" onerror="this.classList.add('missing')"><div class="thumb-missing">screenshot missing</div></div>`;
    }
    function toggle3(c) {
      const k = esc(caseKey(c));
      const eff = effectiveDecision(c);
      // A button is highlighted when it is the effective decision. Solid when the
      // user confirmed it (source 'user'); outlined/dimmed when only suggested.
      const cls = (act, on) => {
        if (eff.decision !== act) return '';
        const base = on;
        return eff.source === 'suggested' ? `${base} suggested` : base;
      };
      const tag = eff.source === 'suggested'
        ? `<div class="suggest-tag">suggested — confirm or override</div>` : '';
      return `<div class="toggle-2"><div class="toggle-3" data-key="${k}">
        <button data-act="accept" class="${cls('accept', 'on-accept')}">Accept</button>
        <button data-act="flag" class="${cls('flag', 'on-flag')}">Flag for optimization</button>
      </div>${tag}</div>`;
    }
    function renderBoard() {
      const list = orderedCases();
      $('boardVisible').textContent = list.length;
      if (state.cursor >= list.length) state.cursor = Math.max(0, list.length - 1);
      if (!list.length) { $('auditList').innerHTML = '<div class="empty">No cases match the current filters.</div>'; return; }
      $('auditList').innerHTML = list.map((c, i) => {
        const d = decisionOf(c);
        const dec = d === 'accept' ? 'decided-accept' : d === 'flag' ? 'decided-flag' : '';
        return `<div class="audit-card ${dec} ${i === state.cursor ? 'cursor' : ''}" data-key="${esc(caseKey(c))}" data-idx="${i}">
          ${thumb(c)}
          <div class="audit-body">
            <div class="audit-head-row">
              <span class="audit-key">${esc(caseKey(c))}</span>
              <a href="#" class="small-label" data-drill="${esc(caseKey(c))}">open drill-down</a>
            </div>
            <div class="audit-name">${esc(c.case_name || '')}</div>
            <div class="audit-pills">${detPill(c)} ${qualPill(c)}
              ${vr(c).failure_flags.slice(0, 3).map((f) => `<span class="flag-badge">${esc(f)}</span>`).join('')}
            </div>
          </div>
          <div class="audit-controls">
            ${toggle3(c)}
            <textarea class="note-field" data-note="${esc(caseKey(c))}" placeholder="Review note...">${esc(noteOf(c))}</textarea>
          </div>
        </div>`;
      }).join('');

      $('auditList').querySelectorAll('.toggle-3 button').forEach((b) => {
        b.addEventListener('click', () => {
          const key = b.parentElement.dataset.key;
          const c = cases.find((x) => caseKey(x) === key);
          setDecision(c, b.dataset.act);
          renderBoard(); renderKpis();
        });
      });
      $('auditList').querySelectorAll('.note-field').forEach((t) => {
        t.addEventListener('input', () => {
          const c = cases.find((x) => caseKey(x) === t.dataset.note);
          setNote(c, t.value);
        });
      });
      $('auditList').querySelectorAll('[data-drill]').forEach((a) => {
        a.addEventListener('click', (e) => { e.preventDefault(); state.selectedKey = a.dataset.drill; setSection('drill'); renderDrill(); });
      });
      $('auditList').querySelectorAll('.audit-card').forEach((card) => {
        card.addEventListener('mousedown', (e) => { if (e.target.closest('button,textarea,a')) return; state.cursor = Number(card.dataset.idx); renderBoard(); });
      });
    }

    /* ---------- matrix ---------- */
    function matrixData() {
      const skills = [...new Set(cases.map((c) => c.skill))].sort();
      const cats = Object.keys(scorecard.category_scores || {}).sort();
      const cell = {};
      for (const c of cases) {
        for (const ch of (c.checks || [])) {
          const key = c.skill + '|' + ch.category;
          const e = cell[key] || (cell[key] = { passed: 0, total: 0, q: [] });
          e.total++; if (ch.result === 'pass') e.passed++;
        }
        const q = qual10(c);
        if (q != null) for (const ch of (c.checks || [])) {
          const e = cell[c.skill + '|' + ch.category]; if (e) e.q.push(q);
        }
      }
      return { skills, cats, cell };
    }
    function renderMatrix() {
      const { skills, cats, cell } = matrixData();
      if (!skills.length || !cats.length) { $('matrixTable').innerHTML = '<tr><td class="rowhead">No matrix data.</td></tr>'; return; }
      const head = `<thead><tr><th class="rowhead">Skill \\ Category</th>${cats.map((c) => `<th>${esc(c)}</th>`).join('')}<th>Summary</th></tr></thead>`;
      const body = skills.map((sk) => {
        let p = 0, t = 0, qs = [];
        const tds = cats.map((cat) => {
          const e = cell[sk + '|' + cat];
          if (!e || !e.total) return `<td><div class="heat-cell empty">-</div></td>`;
          p += e.passed; t += e.total; qs = qs.concat(e.q);
          const rate = e.passed / e.total;
          const qm = e.q.length ? e.q.reduce((a, b) => a + b, 0) / e.q.length : null;
          const color = state.matrixMode === 'qual'
            ? (qm == null ? 'var(--border)' : scoreColor(qm))
            : rateColor(rate);
          const main = state.matrixMode === 'qual' ? (qm == null ? '-' : qm.toFixed(1)) : pct(rate);
          const stripW = qm == null ? 0 : (qm / 10 * 100);
          return `<td><div class="heat-cell" data-skill="${esc(sk)}" data-cat="${esc(cat)}" title="${esc(sk)} / ${esc(cat)}: ${e.passed}/${e.total} programmatic, visual quality ${qm == null ? 'n/a' : qm.toFixed(1)}">
            <div class="heat-num" style="color:${color}">${main}</div>
            <div class="heat-strip"><span style="width:${stripW}%;background:${qm == null ? 'var(--border)' : scoreColor(qm)}"></span></div>
          </div></td>`;
        }).join('');
        const rate = t ? p / t : 0;
        const qm = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : null;
        const sum = `<td><div class="heat-cell" style="cursor:default"><div class="heat-num" style="color:${rateColor(rate)}">${pct(rate)}</div><div class="small-label">visual quality ${qm == null ? 'n/a' : qm.toFixed(1)}</div></div></td>`;
        return `<tr><td class="rowhead">${esc(sk)}</td>${tds}${sum}</tr>`;
      }).join('');
      $('matrixTable').innerHTML = head + '<tbody>' + body + '</tbody>';
      $('matrixTable').querySelectorAll('.heat-cell[data-skill]').forEach((el) => {
        el.addEventListener('click', () => {
          resetFilterState();
          state.skill = el.dataset.skill; state.category = el.dataset.cat;
          $('skillFilter').value = state.skill; $('categoryFilter').value = state.category;
          state.selectedKey = '';
          setSection('drill'); renderDrill();
        });
      });
      $('matrixLegend').innerHTML = `
        <span><span class="swatch" style="background:var(--green)"></span>&ge;95% / 7.0+</span>
        <span><span class="swatch" style="background:var(--amber)"></span>80-95% / 4.5-7</span>
        <span><span class="swatch" style="background:var(--red)"></span>&lt;80% / &lt;4.5</span>
        <span>Number = ${state.matrixMode === 'qual' ? 'mean visual quality 0-10' : 'programmatic pass-rate'}; strip = visual quality 0-10.</span>`;
    }

    /* ---------- drill-down ---------- */
    function renderDrill() {
      const list = orderedCases();
      $('drillVisible').textContent = list.length;
      if (!list.length) { $('drillList').innerHTML = '<div class="empty">No cases match filters.</div>'; $('drillDetail').innerHTML = ''; return; }
      if (!state.selectedKey || !list.some((c) => caseKey(c) === state.selectedKey)) state.selectedKey = caseKey(list[0]);
      $('drillList').innerHTML = list.map((c) => {
        const q = qual10(c);
        return `<button class="drill-row ${caseKey(c) === state.selectedKey ? 'active' : ''}" data-key="${esc(caseKey(c))}">
          <div class="k">${esc(caseKey(c))}</div>
          <div class="m"><span class="pill ${resultClass(c.result)}">${label(c.result)}</span>
            <span class="pill ${qualClass(vr(c).status)}">${label(vr(c).status)}${q == null ? '' : ' ' + q.toFixed(1)}</span></div>
        </button>`;
      }).join('');
      $('drillList').querySelectorAll('.drill-row').forEach((b) => {
        b.addEventListener('click', () => { state.selectedKey = b.dataset.key; renderDrill(); });
      });
      renderDrillDetail();
    }

    function ulOrNone(items, emptyText) {
      const l = (items || []).filter(Boolean);
      return l.length ? `<ul style="margin:6px 0 0;padding-left:18px;color:var(--muted);line-height:1.5">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div class="small-label">${emptyText}</div>`;
    }

    function qualCardHtml(c) {
      const v = vr(c), q = qual10(c);
      const gid = 'g' + Math.random().toString(36).slice(2);
      const dims = RUBRIC.map(([key, name]) => {
        const d = v.dimensions[key];
        if (!d && Object.keys(v.dimensions).length && !v.dimensions[key]) { /* fall through to old-keyed dims below */ }
        const score = dim10(d);
        const note = (d && d.note) || '';
        const w = score == null ? 0 : (score / 10 * 100);
        return `<div class="dim-row">
          <div class="dim-name">${esc(name)}</div>
          <div class="dim-score" style="color:${score == null ? 'var(--muted)' : scoreColor(score)}">${score == null ? '-' : score.toFixed(1)}</div>
          <div class="dim-bar"><span style="width:${w}%;background:${score == null ? 'var(--border)' : scoreColor(score)}"></span></div>
          ${note ? `<div class="dim-note">${esc(note)}</div>` : ''}
        </div>`;
      }).join('');
      // Older scorecards key dimensions differently; show any extras too.
      const known = new Set(RUBRIC.map((r) => r[0]));
      const extras = Object.entries(v.dimensions).filter(([k]) => !known.has(k)).map(([k, d]) => {
        const score = dim10(d), note = (d && d.note) || '';
        const w = score == null ? 0 : (score / 10 * 100);
        return `<div class="dim-row">
          <div class="dim-name">${esc(k.replace(/_/g, ' '))}</div>
          <div class="dim-score" style="color:${score == null ? 'var(--muted)' : scoreColor(score)}">${score == null ? '-' : score.toFixed(1)}</div>
          <div class="dim-bar"><span style="width:${w}%;background:${score == null ? 'var(--border)' : scoreColor(score)}"></span></div>
          ${note ? `<div class="dim-note">${esc(note)}</div>` : ''}
        </div>`;
      }).join('');
      const hasDims = Object.keys(v.dimensions).length > 0;
      const card = `<div class="qual-card ${qualClass(v.status)}">
        <div class="qual-top">
          <div class="gauge" id="${gid}"></div>
          <div style="display:grid;gap:6px">
            <div class="audit-head-row">
              <span class="pill ${qualClass(v.status)}">${label(v.status)}</span>
              <span class="small-label">${esc(v.reviewer || 'no judge')}${v.reviewed_at ? ' / ' + esc(v.reviewed_at) : ''}</span>
            </div>
            <div style="font-size:13px;line-height:1.5;overflow-wrap:anywhere">${esc(v.summary || 'No visual quality review recorded for this baseline.')}</div>
          </div>
        </div>
        ${v.failure_flags.length ? `<div class="badge-row">${v.failure_flags.map((f) => `<span class="flag-badge">${esc(f)}</span>`).join('')}</div>` : ''}
        ${hasDims ? `<div><div class="small-label" style="margin-bottom:6px">Per-dimension 0-10</div><div class="dim-grid">${dims}${extras}</div></div>` : '<div class="small-label">No per-dimension breakdown in this scorecard.</div>'}
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
          <div><div class="small-label">Observations</div>${ulOrNone(v.observations, 'None recorded.')}</div>
          <div><div class="small-label">Risks</div>${ulOrNone(v.risks, 'None recorded.')}</div>
        </div>
      </div>`;
      return { html: card, gid, q };
    }

    function checkTable(c) {
      const rows = (c.checks || []).slice().sort((a, b) => {
        const af = a.result === 'fail', bf = b.result === 'fail';
        if (af !== bf) return af ? -1 : 1;
        if (af && bf && !!a.critical !== !!b.critical) return a.critical ? -1 : 1;
        return 0;
      });
      return `<div class="check-table-wrap"><table class="checks"><thead><tr>
        <th>Check</th><th>Category</th><th>Critical</th><th>Result</th><th>Actual</th><th>Expected</th><th>Tolerance</th><th>Detail</th>
        </tr></thead><tbody>
        ${rows.map((ch) => {
          const fail = ch.result === 'fail';
          const cls = fail ? (ch.critical ? 'failrow critical' : 'failrow') : '';
          return `<tr class="${cls}">
            <td><span class="mono">${esc(ch.check_id)}</span><div class="small-label">${esc(ch.type)}</div></td>
            <td>${esc(ch.category)}</td>
            <td>${ch.critical ? '<span class="pill fail">critical</span>' : '<span class="pill muted">advisory</span>'}</td>
            <td><span class="pill ${resultClass(ch.result)}">${esc(ch.result)}</span></td>
            <td><div class="json">${esc(jsonText(ch.actual))}</div></td>
            <td><div class="json">${esc(jsonText(ch.expected))}</div></td>
            <td><div class="json">${esc(jsonText(ch.tolerance))}</div></td>
            <td>${esc(ch.detail)}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>`;
    }

    function renderDrillDetail() {
      const c = cases.find((x) => caseKey(x) === state.selectedKey);
      if (!c) { $('drillDetail').innerHTML = '<div class="empty">Select a case.</div>'; return; }
      const v = vr(c);
      const shot = v.screenshots[0];
      const src = item => item.source_context || {};
      const sc = src(c);
      const qc = qualCardHtml(c);
      $('drillDetail').innerHTML = `
        <div class="grid">
          <div class="panel">
            <div class="panel-head">
              <div><h2 class="panel-title">${esc(caseKey(c))} - ${esc(c.case_name || '')}</h2>
                <div class="panel-subtitle">${esc(c.category)} &middot; ${esc(String(c.duration_ms || 0))} ms &middot; ${esc(c.evidence_path || '')}</div></div>
              <span class="pill ${resultClass(c.result)}">${label(c.result)} ${pct(c.score)}</span>
            </div>
            <div class="panel-body grid">
              <div><div class="small-label" style="margin-bottom:6px">Prompt</div><div class="prompt">${esc(c.task || 'No prompt recorded.')}</div></div>
              <div class="small-label">Provenance: source ${esc(sc.source || 'evaluation/cases')} &middot; scenario ${esc(sc.source_scenario_id || c.case_id)}${sc.source_name ? ' / ' + esc(sc.source_name) : ''}${(c.evidence_summary || {}).run_artifact_path ? ' &middot; run ' + esc(c.evidence_summary.run_artifact_path) : ''}</div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><div><h2 class="panel-title">Baseline render</h2><div class="panel-subtitle">The screenshot under review.</div></div></div>
            <div class="panel-body">
              ${shot ? `<div class="big-shot">
                  <img src="${esc(assetUrl(shot))}" alt="baseline render" onerror="this.classList.add('missing')">
                  <div class="shot-missing">Screenshot referenced but not found at <span class="mono">${esc(assetUrl(shot))}</span></div>
                  <div class="shot-caption">${esc(shot)}</div>
                </div>` : '<div class="empty">No baseline screenshot attached to this case.</div>'}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><div><h2 class="panel-title">Visual quality <span class="small-label">(advisory, 0-10)</span></h2><div class="panel-subtitle">Static visual judge. Never averaged with the programmatic gate.</div></div></div>
            <div class="panel-body">${qc.html}</div>
          </div>

          <div class="panel">
            <div class="panel-head"><div><h2 class="panel-title">Programmatic checks <span class="small-label">(gating)</span></h2><div class="panel-subtitle">Failed + critical checks pinned and tinted red.</div></div>
              <span class="pill ${resultClass(c.result)}">${failedChecks(c).length} failed / ${(c.checks || []).length}</span></div>
            <div class="panel-body">${checkTable(c)}</div>
          </div>
        </div>`;
      radialGauge($(qc.gid), qc.q, false);
    }

    /* ---------- critical failures ---------- */
    function renderFailures() {
      const fails = scorecard.critical_failures || [];
      if (!fails.length) { $('failureList').innerHTML = '<div class="empty">No critical failures in this scorecard. Programmatic gate is clean.</div>'; return; }
      $('failureList').innerHTML = fails.map((f) => `<div class="failure">
        <div class="failure-title">${esc(f.skill)} / ${esc(f.case_id)} / ${esc(f.check_id)}</div>
        <div class="audit-pills" style="margin-top:7px"><span class="pill fail">${esc(f.category)}</span><span class="small-label">${esc(f.case_name || '')}</span></div>
        <div class="failure-detail">${esc(f.detail)}</div>
        <div class="evidence">Evidence: ${esc(f.evidence_path || '')}</div>
        <div class="evidence">Actual: ${esc(jsonText(f.actual))}</div>
        <div class="evidence">Expected: ${esc(jsonText(f.expected))}</div>
        <div class="evidence">Tolerance: ${esc(jsonText(f.tolerance))}</div>
      </div>`).join('');
    }

    /* ---------- optimization handoff ---------- */
    // Scan all cases for flagged baselines and build the optimization batch.
    // confirmedOnly => only count user-confirmed flags (source 'user');
    // otherwise include suggested flags too.
    function handoffBatch() {
      const confirmedOnly = state.handoffConfirmedOnly;
      const perSkill = {};      // skill -> flagged baseline count
      const batchCases = [];    // flagged cases (for plan download)
      let confirmed = 0, suggested = 0;
      for (const c of cases) {
        const eff = effectiveDecision(c);
        if (eff.decision !== 'flag') continue;
        if (confirmedOnly && eff.source !== 'user') continue;
        perSkill[c.skill] = (perSkill[c.skill] || 0) + 1;
        if (eff.source === 'user') confirmed++; else if (eff.source === 'suggested') suggested++;
        batchCases.push({ c, source: eff.source });
      }
      const skills = Object.keys(perSkill).sort();
      return { skills, perSkill, confirmed, suggested, batchCases, baselines: batchCases.length };
    }
    function distinctFlaggedSkillCount() { return handoffBatch().skills.length; }

    function handoffOptions() {
      const n = Math.max(1, parseInt(($('handoffMaxIter') || {}).value, 10) || 1);
      const stopOn = (($('handoffStopOn') || {}).value) || 'plateau';
      return { maxIterations: n, stopOn };
    }
    function workflowArgs(batch, opts) {
      return { skills: batch.skills, maxIterations: opts.maxIterations, stopOn: opts.stopOn };
    }
    function cliCommand(batch, opts) {
      return `python3 optimization/scripts/run-all-evals.py --skills ${batch.skills.join(',')} --max-iterations ${opts.maxIterations} --stop-on ${opts.stopOn}`;
    }
    function optimizationPlan(batch, opts) {
      return {
        generated_at: new Date().toISOString(),
        source_run_id: scorecard.run_id,
        skills: batch.skills,
        cases: batch.batchCases.map(({ c, source }) => ({
          skill: c.skill, case_id: c.case_id, case_name: c.case_name,
          visual_score: vr(c).overall_score != null ? vr(c).overall_score : null,
          failure_flags: vr(c).failure_flags || [],
          decision_source: source,
        })),
        workflow_args: workflowArgs(batch, opts),
        cli_command: cliCommand(batch, opts),
      };
    }

    // Clipboard write with a file://-safe execCommand fallback.
    function copyText(text, btn) {
      const done = () => {
        if (!btn) return;
        const prev = btn.textContent;
        btn.textContent = 'Copied'; btn.classList.add('copied');
        setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    }
    function fallbackCopy(text, done) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* no-op */ }
      document.body.removeChild(ta);
    }

    function cmdBlockHtml(id, label, text) {
      return `<div class="cmd-block">
        <div class="cmd-head"><span class="cmd-label">${esc(label)}</span>
          <button class="button copy-btn" data-copy="${id}">Copy</button></div>
        <pre class="cmd-pre"><code id="${id}">${esc(text)}</code></pre>
      </div>`;
    }

    function renderHandoff() {
      const body = $('handoffBody');
      if (!body) return;
      const batch = handoffBatch();
      $('navHandoff').textContent = batch.skills.length;

      const controls = `<div class="handoff-controls">
        <label>Max iterations<input type="number" id="handoffMaxIter" min="1" step="1" value="${esc(state.handoffMaxIter || 1)}"></label>
        <label>Stop on<select id="handoffStopOn">
          <option value="plateau"${(state.handoffStopOn || 'plateau') === 'plateau' ? ' selected' : ''}>plateau</option>
          <option value="regression"${state.handoffStopOn === 'regression' ? ' selected' : ''}>regression</option>
          <option value="max"${state.handoffStopOn === 'max' ? ' selected' : ''}>max</option>
        </select></label>
      </div>`;

      if (!batch.skills.length) {
        body.innerHTML = `<div class="empty">No baselines flagged for optimization yet. Flag poor renders in the Review Queue to build an optimization batch.</div>${controls}`;
        wireHandoffControls();
        return;
      }

      const opts = { maxIterations: state.handoffMaxIter || 1, stopOn: state.handoffStopOn || 'plateau' };
      const chips = batch.skills.map((sk) =>
        `<button class="handoff-chip" data-skill="${esc(sk)}">${esc(sk)}<span class="chip-count">(${batch.perSkill[sk]})</span></button>`
      ).join('');
      const wfText = JSON.stringify(workflowArgs(batch, opts), null, 2);
      const cliText = cliCommand(batch, opts);

      body.innerHTML = `
        <div class="handoff-headline">${batch.skills.length} skill${batch.skills.length === 1 ? '' : 's'} - ${batch.baselines} baseline${batch.baselines === 1 ? '' : 's'} queued for optimization</div>
        <div class="handoff-sub">(${batch.confirmed} confirmed - ${batch.suggested} suggested)</div>
        <div class="handoff-chips">${chips}</div>
        ${controls}
        ${cmdBlockHtml('handoffWfArgs', 'optimize-skills workflow args', wfText)}
        ${cmdBlockHtml('handoffCli', 'CLI', cliText)}
        <div class="side-actions" style="margin-top:16px;max-width:320px"><button class="button primary" id="handoffDownload">Download optimization plan (JSON)</button></div>`;

      wireHandoffControls();
      body.querySelectorAll('.handoff-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const sk = chip.dataset.skill;
          resetFilterState();
          state.skill = sk; $('skillFilter').value = sk;
          state.selectedKey = '';
          setSection('drill'); renderDrill();
        });
      });
      body.querySelectorAll('[data-copy]').forEach((b) => {
        b.addEventListener('click', () => {
          const code = $(b.dataset.copy);
          if (code) copyText(code.textContent, b);
        });
      });
      const dl = $('handoffDownload');
      if (dl) dl.addEventListener('click', () => {
        const b = handoffBatch();
        const o = { maxIterations: state.handoffMaxIter || 1, stopOn: state.handoffStopOn || 'plateau' };
        const blob = new Blob([JSON.stringify(optimizationPlan(b, o), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `optimization-plan-${RUN_ID}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
    function wireHandoffControls() {
      const mi = $('handoffMaxIter');
      if (mi) mi.addEventListener('input', () => { state.handoffMaxIter = Math.max(1, parseInt(mi.value, 10) || 1); renderHandoff(); });
      const so = $('handoffStopOn');
      if (so) so.addEventListener('change', () => { state.handoffStopOn = so.value; renderHandoff(); });
    }

    /* ---------- export ---------- */
    function exportDecisions() {
      const items = cases.map((c) => {
        const d = decisions[caseKey(c)] || {};
        const eff = effectiveDecision(c);
        return { skill: c.skill, case_id: c.case_id, case_name: c.case_name,
          deterministic_result: c.result, qualitative_status: vr(c).status, qualitative_score_0_10: qual10(c),
          decision: eff.decision || 'pending', decision_source: eff.source || 'pending',
          suggested_decision: suggestionOf(c) || null,
          note: d.note || '', updated_at: d.updated_at || null };
      });
      const payload = { run_id: RUN_ID, git_commit: scorecard.git_commit, exported_at: new Date().toISOString(),
        threshold: scorecard.threshold, summary: auditTallies(), decisions: items };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `baseline-audit-${RUN_ID}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    /* ---------- nav + filters wiring ---------- */
    function setSection(s) {
      state.section = s;
      document.querySelectorAll('.section').forEach((el) => el.classList.toggle('active', el.id === s));
      document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.section === s));
      if (s === 'handoff') renderHandoff();
      if (s === 'matrix') renderMatrix();
      if (s === 'drill') renderDrill();
      if (s === 'failures') renderFailures();
    }
    function rerenderActive() {
      renderKpis();
      if (state.section === 'board') renderBoard();
      else if (state.section === 'handoff') renderHandoff();
      else if (state.section === 'matrix') renderMatrix();
      else if (state.section === 'drill') renderDrill();
      else if (state.section === 'failures') renderFailures();
    }
    function resetFilterState() {
      state.search = ''; state.result = 'all'; state.qual = 'all'; state.category = 'all'; state.audit = 'all'; state.skill = 'all';
      $('search').value = ''; $('resultFilter').value = 'all'; $('qualFilter').value = 'all';
      $('categoryFilter').value = 'all'; $('auditFilter').value = 'all'; $('skillFilter').value = 'all';
    }

    document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => setSection(b.dataset.section)));
    $('search').addEventListener('input', (e) => { state.search = e.target.value; state.cursor = 0; rerenderActive(); });
    $('resultFilter').addEventListener('change', (e) => { state.result = e.target.value; state.cursor = 0; rerenderActive(); });
    $('qualFilter').addEventListener('change', (e) => { state.qual = e.target.value; state.cursor = 0; rerenderActive(); });
    $('categoryFilter').addEventListener('change', (e) => { state.category = e.target.value; state.cursor = 0; rerenderActive(); });
    $('auditFilter').addEventListener('change', (e) => { state.audit = e.target.value; state.cursor = 0; rerenderActive(); });
    $('skillFilter').addEventListener('change', (e) => { state.skill = e.target.value; state.cursor = 0; rerenderActive(); });
    $('matrixMode').addEventListener('change', (e) => { state.matrixMode = e.target.value; renderMatrix(); });
    $('handoffConfirmedOnly').addEventListener('change', (e) => { state.handoffConfirmedOnly = e.target.checked; renderHandoff(); renderKpis(); });
    $('kpiBaselinesFlaggedTile').addEventListener('click', () => setSection('handoff'));
    $('resetFilters').addEventListener('click', () => { resetFilterState(); state.cursor = 0; rerenderActive(); });
    $('exportDecisions').addEventListener('click', exportDecisions);
    $('jumpNext').addEventListener('click', () => {
      const next = cases.find((c) => !decisionOf(c));
      if (!next) return;
      resetFilterState();
      state.section = 'board'; setSection('board');
      const list = orderedCases();
      const idx = list.findIndex((c) => caseKey(c) === caseKey(next));
      state.cursor = Math.max(0, idx);
      renderBoard();
      const el = $('auditList').querySelector('.audit-card.cursor');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    $('toggleTheme').addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = next;
      $('toggleTheme').textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
      renderKpis();
      if (state.section === 'matrix') renderMatrix();
      if (state.section === 'drill') renderDrillDetail();
    });

    document.addEventListener('keydown', (e) => {
      if (state.section !== 'board') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const list = orderedCases();
      if (!list.length) return;
      if (e.key === 'j') { state.cursor = Math.min(list.length - 1, state.cursor + 1); renderBoard(); scrollCursor(); }
      else if (e.key === 'k') { state.cursor = Math.max(0, state.cursor - 1); renderBoard(); scrollCursor(); }
      else if (e.key === 'a' || e.key === 'f') {
        const map = { a: 'accept', f: 'flag' };
        const c = list[state.cursor]; if (c) { setDecision(c, map[e.key]); renderBoard(); renderKpis(); scrollCursor(); }
      } else return;
      e.preventDefault();
    });
    function scrollCursor() { const el = $('auditList').querySelector('.audit-card.cursor'); if (el) el.scrollIntoView({ block: 'nearest' }); }

    renderKpis();
    renderFilterOptions();
    renderBoard();
  </script>
</body>
</html>
"""


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_json_script(data: Any) -> str:
    """Embed JSON safely inside a <script> tag.

    ``ensure_ascii=True`` escapes U+2028/U+2029 and all non-ASCII; the ``</``
    rewrite prevents premature </script> termination.
    """
    return json.dumps(data, ensure_ascii=True).replace("</", "<\\/")


def build_html(scorecard: dict[str, Any]) -> str:
    return HTML_TEMPLATE.replace("__SCORECARD_JSON__", safe_json_script(scorecard))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the baseline-audit static review UI.")
    parser.add_argument("scorecard", help="Path to scorecard.json")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output HTML path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    scorecard = load_json(Path(args.scorecard))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(build_html(scorecard), encoding="utf-8")
    size = output.stat().st_size
    print(f"[build-audit-ui] wrote {output} ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
