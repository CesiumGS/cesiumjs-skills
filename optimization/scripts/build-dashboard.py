#!/usr/bin/env python3
"""Generate a self-contained HTML dashboard for the CesiumJS eval pipeline.

Walks optimization/results/, optimization/runs/, optimization/scenarios/ and produces
optimization/dashboard/index.html with embedded JSON. Screenshots are referenced
by relative path; the dashboard expects to be served from the repo root
via a local HTTP server so Playwright-generated PNGs load.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RESULTS = REPO / "optimization" / "results"
RUNS = REPO / "optimization" / "runs"
SCENARIOS = REPO / "optimization" / "scenarios"
DASH = REPO / "optimization" / "dashboard"


def parse_summary_scores(summary_md: Path) -> dict:
    scores = {"prog": None, "api": None, "visual": None}
    if not summary_md.exists():
        return scores
    text = summary_md.read_text()
    m = re.search(r"\*\*Programmatic Correctness:\*\*\s*([\d.]+)%", text)
    if m:
        scores["prog"] = float(m.group(1))
    m = re.search(r"\*\*API Accuracy:\*\*\s*([\d.]+)%", text)
    if m:
        scores["api"] = float(m.group(1))
    m = re.search(r"\*\*Visual Win Rate:\*\*\s*([\d.]+)%", text)
    if m:
        scores["visual"] = float(m.group(1))
    return scores


def load_skill_iteration(skill: str, iteration: str) -> dict | None:
    decision_path = RESULTS / skill / iteration / "decision.json"
    if not decision_path.exists():
        return None
    decision = json.loads(decision_path.read_text())
    scores = parse_summary_scores(RESULTS / skill / iteration / "summary.md")

    scenarios = []
    runs_dir = RUNS / skill / iteration
    if runs_dir.exists():
        for bundle in sorted(runs_dir.iterdir()):
            if not bundle.is_dir() or not bundle.name.startswith("eval-"):
                continue
            scenario_id = bundle.name.split("-", 1)[0] + "-" + bundle.name.split("-", 1)[1].split("-")[0]
            # Better: derive from scenario file
            short_id = bundle.name.split("-")[0] + "-" + bundle.name.split("-")[1]
            scen_files = list(SCENARIOS.glob(f"{skill}/{short_id}-*.json"))
            scen = json.loads(scen_files[0].read_text()) if scen_files else {}

            checks_path = bundle / "programmatic-checks.json"
            checks_data = json.loads(checks_path.read_text()) if checks_path.exists() else {}
            checks_list = checks_data.get("checks", [])
            checks_summary = checks_data.get("summary", {})

            verdict_path = bundle / "judge-verdicts.json"
            verdict_data = json.loads(verdict_path.read_text()) if verdict_path.exists() else {}

            console_path = bundle / "console.json"
            console_data = json.loads(console_path.read_text()) if console_path.exists() else {}
            errors = console_data.get("errors", [])
            messages = console_data.get("console_messages", [])

            scene_path = bundle / "scene-state.json"
            scene_data = json.loads(scene_path.read_text()) if scene_path.exists() else {}

            quality_path = bundle / "screenshot-quality.json"
            quality_data = json.loads(quality_path.read_text()) if quality_path.exists() else {}

            meta_path = bundle / "metadata.json"
            meta_data = json.loads(meta_path.read_text()) if meta_path.exists() else {}

            # Baseline screenshot path. run-loop writes the current-best
            # baseline to runs/<skill>/baseline/; fall back to the legacy
            # numeric iter 000 dir if that's what's on disk.
            baseline_shot_rel = None
            for baseline_dir in (RUNS / skill / "baseline" / bundle.name,
                                  RUNS / skill / "000" / bundle.name):
                if (baseline_dir / "screenshot.png").exists():
                    baseline_shot_rel = str(
                        (baseline_dir / "screenshot.png").relative_to(REPO)
                    )
                    break
                # try multi-frame
                multi = sorted(baseline_dir.glob("screenshot-*.png")) if baseline_dir.exists() else []
                if multi:
                    baseline_shot_rel = str(multi[0].relative_to(REPO))
                    break
            candidate_shot_rel = None
            if (bundle / "screenshot.png").exists():
                candidate_shot_rel = str((bundle / "screenshot.png").relative_to(REPO))
            else:
                multi = sorted(bundle.glob("screenshot-*.png"))
                if multi:
                    candidate_shot_rel = str(multi[0].relative_to(REPO))

            scenarios.append(
                {
                    "id": short_id,
                    "name": scen.get("name", bundle.name),
                    "bundle": bundle.name,
                    "description": scen.get("description", ""),
                    "prompt": scen.get("prompt", ""),
                    "regression_critical": scen.get("regression_critical", False),
                    "difficulty": scen.get("difficulty", ""),
                    "verdict": verdict_data.get("verdict"),
                    "majority": verdict_data.get("majority_count", 0),
                    "judges": verdict_data.get("individual_verdicts", []),
                    "checks_passed": checks_summary.get("passed", 0),
                    "checks_total": checks_summary.get("total", 0),
                    "checks_failed": [
                        c for c in checks_list if c.get("result") == "fail"
                    ],
                    "checks": checks_list,
                    "errors": errors[:5],
                    "console_warning_count": sum(
                        1 for m in messages if m.get("type") == "warning"
                    ),
                    "console_error_count": sum(
                        1 for m in messages if m.get("type") == "error"
                    ),
                    "scene_state": scene_data,
                    "quality": quality_data.get("screenshots", []),
                    "screenshot_baseline": baseline_shot_rel,
                    "screenshot_candidate": candidate_shot_rel,
                    "metadata": {
                        "model_id": meta_data.get("model_id"),
                        "browser_viewport": meta_data.get("browser_viewport"),
                        "chromium_version": meta_data.get("chromium_version"),
                        "timestamp_utc": meta_data.get("timestamp_utc"),
                    },
                }
            )

    return {
        "skill": skill,
        "iteration": iteration,
        "decision": decision.get("decision"),
        "rule_fired": decision.get("rule_fired"),
        "rationale": decision.get("rationale"),
        "counts": decision.get("counts", {}),
        "rebaseline_required": decision.get("rebaseline_required", []),
        "scores": scores,
        "scenarios": scenarios,
    }


def build_data() -> dict:
    iterations = []
    # For each skill, find the latest iteration directory with a decision.json
    # This handles the case where some skills had multiple iterations (e.g.
    # interaction completed iter-002 KEEP then iter-003 REJECT).
    for skill_dir in sorted(RESULTS.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill = skill_dir.name
        iter_dirs = sorted(
            (d for d in skill_dir.iterdir()
             if d.is_dir() and d.name.isdigit()
             and (d / "decision.json").exists()),
            key=lambda d: int(d.name),
        )
        if not iter_dirs:
            continue
        # Use the latest iteration as the canonical for the dashboard's "current"
        # view, but also surface earlier iterations as historical context.
        for iter_dir in iter_dirs:
            rec = load_skill_iteration(skill, iter_dir.name)
            if rec:
                iterations.append(rec)

    # Aggregate KPIs
    decision_rules = {}
    keep = reject = 0
    checks_passed = checks_total = 0
    critical_failures = 0
    verdict_dist = {"CANDIDATE": 0, "BASELINE": 0, "TIE": 0, "NONE": 0}
    judges_total = 0
    for it in iterations:
        rule = it["rule_fired"]
        decision_rules[rule] = decision_rules.get(rule, 0) + 1
        if it["decision"] == "KEEP":
            keep += 1
        else:
            reject += 1
        for s in it["scenarios"]:
            checks_passed += s["checks_passed"]
            checks_total += s["checks_total"]
            if s["regression_critical"] and s["checks_passed"] < s["checks_total"]:
                critical_failures += 1
            v = s["verdict"] or "NONE"
            verdict_dist[v] = verdict_dist.get(v, 0) + 1
            judges_total += len(s["judges"])

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "kpis": {
            "skills_count": len({it["skill"] for it in iterations}),
            "iterations_count": len(iterations),
            "scenarios_count": sum(len(it["scenarios"]) for it in iterations),
            "keep": keep,
            "reject": reject,
            "judges_count": judges_total,
            "checks_passed": checks_passed,
            "checks_total": checks_total,
            "checks_pass_rate": round(100 * checks_passed / checks_total, 1)
            if checks_total
            else 0,
            "critical_failures": critical_failures,
        },
        "decision_rules": decision_rules,
        "verdict_distribution": verdict_dist,
        "iterations": iterations,
    }


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CesiumJS Eval Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0b1220;
    --bg2: #131c2e;
    --bg3: #1b2640;
    --border: #2a3a5c;
    --fg: #e6edf6;
    --fg-dim: #98a8c4;
    --accent: #60a5fa;
    --accent2: #38bdf8;
    --green: #34d399;
    --red: #f87171;
    --amber: #fbbf24;
    --tie: #94a3b8;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px; line-height: 1.45; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
  header { padding: 18px 28px; border-bottom: 1px solid var(--border); display: flex;
    align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header h1 .badge { background: var(--bg3); padding: 2px 8px; border-radius: 4px;
    font-weight: 500; color: var(--accent2); margin-left: 8px; }
  header .meta { color: var(--fg-dim); font-size: 12px; }
  main { padding: 20px 28px 60px; max-width: 1500px; margin: 0 auto; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .kpi .label { color: var(--fg-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi .value { font-size: 26px; font-weight: 600; margin-top: 4px; }
  .kpi .sub { color: var(--fg-dim); font-size: 12px; margin-top: 2px; }
  .kpi.keep .value { color: var(--green); }
  .kpi.reject .value { color: var(--red); }

  .charts { display: grid; grid-template-columns: 1fr 1.5fr; gap: 12px; margin-bottom: 20px; }
  .panel { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .panel h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--fg-dim); font-weight: 600; }
  .panel .chart-wrap { position: relative; height: 220px; }
  @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }

  .controls { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
  .controls input, .controls select { background: var(--bg2); border: 1px solid var(--border); color: var(--fg);
    padding: 8px 10px; border-radius: 6px; font: inherit; }
  .controls input { min-width: 240px; }
  .controls .count { color: var(--fg-dim); font-size: 12px; }

  .skill { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
    margin-bottom: 10px; overflow: hidden; }
  .skill-header { display: grid; grid-template-columns: 24px 2.5fr 1fr 1.5fr 1fr 1fr 1fr;
    gap: 12px; padding: 14px 16px; cursor: pointer; align-items: center;
    transition: background 0.15s; user-select: none; }
  .skill-header:hover { background: var(--bg3); }
  .skill-header .chev { color: var(--fg-dim); transition: transform 0.15s; }
  .skill.open .chev { transform: rotate(90deg); }
  .skill-header .name { font-weight: 600; }
  .skill-header .name .iter { color: var(--fg-dim); font-weight: 400; margin-left: 6px; font-size: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; }
  .pill.keep { background: rgba(52,211,153,0.15); color: var(--green); border: 1px solid rgba(52,211,153,0.3); }
  .pill.reject { background: rgba(248,113,113,0.15); color: var(--red); border: 1px solid rgba(248,113,113,0.3); }
  .pill.candidate { background: rgba(96,165,250,0.15); color: var(--accent); border: 1px solid rgba(96,165,250,0.3); }
  .pill.baseline { background: rgba(251,191,36,0.15); color: var(--amber); border: 1px solid rgba(251,191,36,0.3); }
  .pill.tie { background: rgba(148,163,184,0.15); color: var(--tie); border: 1px solid rgba(148,163,184,0.3); }
  .pill.none { background: rgba(148,163,184,0.05); color: var(--fg-dim); border: 1px solid rgba(148,163,184,0.2); }
  .skill-header .rule { color: var(--fg-dim); font-size: 12px; }
  .skill-header .score { color: var(--fg-dim); font-size: 12px; }
  .skill-header .score .pct { color: var(--fg); font-weight: 600; margin-left: 4px; }

  .skill-body { display: none; padding: 0 16px 16px; border-top: 1px solid var(--border); }
  .skill.open .skill-body { display: block; }
  .rationale { color: var(--fg-dim); font-size: 12px; padding: 10px 0; font-style: italic; }

  .scenarios { display: flex; flex-direction: column; gap: 6px; }
  .scenario { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .scen-head { display: grid; grid-template-columns: 24px 2.5fr 1fr 1fr 1fr 1fr;
    gap: 10px; padding: 10px 14px; cursor: pointer; align-items: center; user-select: none; font-size: 13px; }
  .scen-head:hover { background: rgba(255,255,255,0.02); }
  .scen-head .chev { color: var(--fg-dim); transition: transform 0.15s; }
  .scenario.open .chev { transform: rotate(90deg); }
  .scen-head .name { font-weight: 500; }
  .scen-head .name .id { color: var(--fg-dim); font-weight: 400; margin-right: 6px; }
  .crit-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--red); margin-left: 6px; vertical-align: middle; }
  .scen-body { display: none; padding: 12px 14px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.15); }
  .scenario.open .scen-body { display: block; }
  .scen-body h3 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--fg-dim); font-weight: 600; }
  .scen-body h3:first-child { margin-top: 0; }

  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .shot { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
  .shot .label { font-size: 11px; color: var(--fg-dim); text-transform: uppercase;
    letter-spacing: 0.04em; margin-bottom: 6px; }
  .shot img { width: 100%; height: auto; border-radius: 4px; display: block; cursor: zoom-in;
    background: #000; }
  .shot img:hover { outline: 2px solid var(--accent); }
  .shot.missing { color: var(--fg-dim); font-size: 12px; padding: 20px; text-align: center;
    font-style: italic; }

  .judges { display: grid; gap: 8px; }
  .judge { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-size: 12.5px; }
  .judge .head { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
  .judge .label { color: var(--fg-dim); font-size: 11px; }
  .judge .rat { color: var(--fg); white-space: pre-wrap; word-wrap: break-word; }

  .checks-list { display: grid; gap: 4px; font-size: 12px; }
  .check-row { display: grid; grid-template-columns: 50px 1fr; gap: 10px; padding: 4px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04); }
  .check-row .res { font-weight: 600; font-size: 11px; }
  .check-row .res.pass { color: var(--green); }
  .check-row .res.fail { color: var(--red); }
  .check-row .detail .desc { color: var(--fg); }
  .check-row .detail .why { color: var(--fg-dim); font-size: 11px; }

  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px;
    font-size: 12px; color: var(--fg-dim); }
  .meta-grid b { color: var(--fg); margin-right: 4px; font-weight: 500; }

  .errors { font-size: 12px; color: var(--red); }
  .errors li { margin: 2px 0; }

  /* Lightbox */
  .lb-back { position: fixed; inset: 0; background: rgba(0,0,0,0.92); display: none;
    align-items: center; justify-content: center; z-index: 100; cursor: zoom-out; }
  .lb-back.open { display: flex; }
  .lb-back img { max-width: 95vw; max-height: 95vh; box-shadow: 0 0 40px rgba(96,165,250,0.4); }
</style>
</head>
<body>

<header>
  <h1>🌐 CesiumJS Eval Dashboard <span class="badge" id="header-iter">14 skills</span></h1>
  <div class="meta">
    <span id="generated"></span>
  </div>
</header>

<main>
  <section class="kpis" id="kpis"></section>

  <section class="charts">
    <div class="panel">
      <h2>Decision Rules</h2>
      <div class="chart-wrap"><canvas id="rulesChart"></canvas></div>
    </div>
    <div class="panel">
      <h2>Programmatic Score per Skill</h2>
      <div class="chart-wrap"><canvas id="scoresChart"></canvas></div>
    </div>
  </section>

  <div class="controls">
    <input id="search" placeholder="Search skill or scenario…" />
    <select id="filter-dec">
      <option value="">All decisions</option>
      <option value="KEEP">KEEP only</option>
      <option value="REJECT">REJECT only</option>
    </select>
    <select id="filter-rule">
      <option value="">All rules</option>
    </select>
    <span class="count" id="count"></span>
  </div>

  <section id="skills"></section>
</main>

<div class="lb-back" id="lightbox"><img id="lb-img" alt=""></div>

<script id="data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);

// --- KPIs ---
function renderKpis() {
  const k = DATA.kpis;
  document.getElementById('generated').textContent =
    'Generated ' + new Date(DATA.generated_at).toLocaleString();
  document.getElementById('header-iter').textContent = k.skills_count + ' skills';
  const tiles = [
    { label: 'Skills', value: k.skills_count },
    { label: 'Iterations', value: k.iterations_count },
    { label: 'Scenarios', value: k.scenarios_count },
    { label: 'KEEP', value: k.keep, cls: 'keep' },
    { label: 'REJECT', value: k.reject, cls: 'reject' },
    { label: 'Judge verdicts', value: k.judges_count, sub: '3 per scenario' },
    { label: 'Checks pass', value: k.checks_pass_rate + '%', sub: `${k.checks_passed}/${k.checks_total}` },
    { label: 'Critical fails', value: k.critical_failures, cls: k.critical_failures ? 'reject' : '' },
  ];
  document.getElementById('kpis').innerHTML = tiles.map(t => `
    <div class="kpi ${t.cls || ''}">
      <div class="label">${t.label}</div>
      <div class="value">${t.value}</div>
      ${t.sub ? `<div class="sub">${t.sub}</div>` : ''}
    </div>`).join('');
}

// --- Charts ---
function renderCharts() {
  const rules = DATA.decision_rules;
  const ruleLabels = Object.keys(rules);
  const ruleColors = {
    'rule_1_check_failure': '#f87171',
    'rule_1_critical_check_failure': '#f87171',
    'rule_2_critical_judge_loss': '#fb923c',
    'rule_3_more_wins': '#34d399',
    'rule_4_more_losses': '#fbbf24',
    'rule_5_tie_keep_current': '#94a3b8',
  };
  new Chart(document.getElementById('rulesChart'), {
    type: 'doughnut',
    data: {
      labels: ruleLabels.map(r => r.replace(/^rule_\d+_/, '').replace(/_/g, ' ')),
      datasets: [{
        data: ruleLabels.map(r => rules[r]),
        backgroundColor: ruleLabels.map(r => ruleColors[r] || '#60a5fa'),
        borderColor: '#0b1220',
        borderWidth: 2,
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#e6edf6', boxWidth: 10, font: { size: 11 } } },
      }
    }
  });

  const its = DATA.iterations.slice().sort((a,b) => (b.scores.prog || 0) - (a.scores.prog || 0));
  new Chart(document.getElementById('scoresChart'), {
    type: 'bar',
    data: {
      labels: its.map(i => i.skill.replace('cesiumjs-', '')),
      datasets: [
        { label: 'Programmatic %', data: its.map(i => i.scores.prog || 0), backgroundColor: '#60a5fa' },
        { label: 'Visual Win %',   data: its.map(i => i.scores.visual || 0), backgroundColor: '#38bdf8' },
      ]
    },
    options: {
      maintainAspectRatio: false, indexAxis: 'y',
      scales: {
        x: { ticks: { color: '#98a8c4' }, grid: { color: 'rgba(255,255,255,0.06)' }, max: 100 },
        y: { ticks: { color: '#e6edf6', font: { size: 11 } }, grid: { display: false } }
      },
      plugins: { legend: { position: 'top', labels: { color: '#e6edf6', boxWidth: 10, font: { size: 11 } } } }
    }
  });
}

// --- Skills + scenarios ---
function pill(text, cls) {
  return `<span class="pill ${cls}">${text}</span>`;
}
function verdictPill(v, maj) {
  const cls = (v || 'NONE').toLowerCase();
  const label = v ? (v + (maj ? ` ${maj}/3` : '')) : 'no verdict';
  return pill(label, cls);
}

function renderSkills() {
  const root = document.getElementById('skills');
  root.innerHTML = DATA.iterations.map((it, idx) => {
    const decCls = it.decision === 'KEEP' ? 'keep' : 'reject';
    const score = it.scores.prog == null ? '–' : it.scores.prog.toFixed(0) + '%';
    const vis = it.scores.visual == null ? '–' : it.scores.visual.toFixed(0) + '%';
    return `
    <div class="skill" data-idx="${idx}" data-skill="${it.skill}" data-decision="${it.decision}" data-rule="${it.rule_fired}">
      <div class="skill-header" onclick="toggleSkill(${idx})">
        <span class="chev">▸</span>
        <div class="name">${it.skill}<span class="iter">iter ${it.iteration}</span></div>
        <div>${pill(it.decision, decCls)}</div>
        <div class="rule">${it.rule_fired}</div>
        <div class="score"><span class="label">prog</span><span class="pct">${score}</span></div>
        <div class="score"><span class="label">visual</span><span class="pct">${vis}</span></div>
        <div class="score"><span class="label">W/L/T</span><span class="pct">${it.counts.wins || 0}/${it.counts.losses || 0}/${it.counts.ties || 0}</span></div>
      </div>
      <div class="skill-body">
        <div class="rationale">"${it.rationale || ''}"</div>
        <div class="scenarios">
          ${it.scenarios.map((s, si) => renderScenario(idx, si, s)).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderScenario(skillIdx, scenIdx, s) {
  const v = s.verdict ? s.verdict.toLowerCase() : 'none';
  const ck = `${s.checks_passed}/${s.checks_total}`;
  const ckCls = s.checks_passed === s.checks_total ? 'pass' : 'fail';
  return `
  <div class="scenario" data-skill-idx="${skillIdx}" data-scen-idx="${scenIdx}">
    <div class="scen-head" onclick="toggleScen(${skillIdx}, ${scenIdx})">
      <span class="chev">▸</span>
      <div class="name"><span class="id">${s.id}</span>${s.name}${s.regression_critical ? '<span class="crit-dot" title="regression-critical"></span>' : ''}</div>
      <div>${verdictPill(s.verdict, s.majority)}</div>
      <div class="score"><span class="label">checks</span><span class="pct" style="color:var(--${ckCls === 'pass' ? 'green' : 'red'})">${ck}</span></div>
      <div class="score"><span class="label">errors</span><span class="pct">${s.console_error_count || 0}</span></div>
      <div class="score"><span class="label">diff</span><span class="pct">${s.difficulty || '–'}</span></div>
    </div>
    <div class="scen-body" id="scen-${skillIdx}-${scenIdx}">
      <!-- lazy-rendered on open -->
    </div>
  </div>`;
}

function renderScenarioBody(s) {
  const baseRel = s.screenshot_baseline;
  const candRel = s.screenshot_candidate;
  const shotHtml = (rel, label) => rel
    ? `<div class="shot"><div class="label">${label}</div><img src="../../${rel}" onclick="openLb(this.src)" alt="${label}"></div>`
    : `<div class="shot missing">${label}: not available</div>`;
  return `
    <h3>Prompt</h3>
    <div style="font-size:12.5px;color:var(--fg-dim);background:var(--bg);padding:8px 10px;border-radius:4px;border:1px solid var(--border);">${s.prompt || '–'}</div>

    <h3>Screenshots (baseline vs candidate)</h3>
    <div class="shots">
      ${shotHtml(baseRel, 'baseline')}
      ${shotHtml(candRel, 'candidate')}
    </div>

    <h3>Judge rationales (${s.judges.length})</h3>
    <div class="judges">
      ${s.judges.map(j => `
        <div class="judge">
          <div class="head">
            ${verdictPill(j.verdict, '')}
            <span class="label">judge ${j.judge_index} · ${j.model_id || ''} · seed ${j.seed} · A=${j.label_mapping?.A || '?'} B=${j.label_mapping?.B || '?'}</span>
          </div>
          <div class="rat">${escapeHtml(j.rationale || '(no rationale)')}</div>
        </div>`).join('')}
    </div>

    ${s.checks_failed.length ? `
      <h3>Failing checks (${s.checks_failed.length})</h3>
      <div class="checks-list">
        ${s.checks_failed.map(c => `
          <div class="check-row">
            <div class="res fail">FAIL</div>
            <div class="detail">
              <div class="desc">${c.description || c.type}</div>
              <div class="why">${escapeHtml(c.detail || '')}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}

    ${s.errors.length ? `
      <h3>Browser errors (${s.errors.length})</h3>
      <ul class="errors">
        ${s.errors.map(e => `<li>${escapeHtml(e.message || e.text || JSON.stringify(e))}</li>`).join('')}
      </ul>` : ''}

    <h3>Run metadata</h3>
    <div class="meta-grid">
      <span><b>model</b>${s.metadata.model_id || '–'}</span>
      <span><b>viewport</b>${s.metadata.browser_viewport ? `${s.metadata.browser_viewport.width}×${s.metadata.browser_viewport.height}` : '–'}</span>
      <span><b>chromium</b>${s.metadata.chromium_version || '–'}</span>
      <span><b>captured</b>${s.metadata.timestamp_utc ? new Date(s.metadata.timestamp_utc).toLocaleString() : '–'}</span>
      <span><b>scene</b>${s.scene_state?.available ? `cam(${s.scene_state.camera?.position?.x?.toFixed(0)}, ${s.scene_state.camera?.position?.y?.toFixed(0)}, ${s.scene_state.camera?.position?.z?.toFixed(0)}) ent=${s.scene_state.entity_count} prim=${s.scene_state.primitive_count}` : 'unavailable'}</span>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function toggleSkill(idx) {
  document.querySelector(`.skill[data-idx="${idx}"]`).classList.toggle('open');
}
function toggleScen(sIdx, scIdx) {
  const el = document.querySelector(`.scenario[data-skill-idx="${sIdx}"][data-scen-idx="${scIdx}"]`);
  const wasOpen = el.classList.contains('open');
  el.classList.toggle('open');
  if (!wasOpen) {
    const body = document.getElementById(`scen-${sIdx}-${scIdx}`);
    if (!body.dataset.rendered) {
      body.innerHTML = renderScenarioBody(DATA.iterations[sIdx].scenarios[scIdx]);
      body.dataset.rendered = '1';
    }
  }
}

function openLb(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
document.getElementById('lightbox').addEventListener('click', () => {
  document.getElementById('lightbox').classList.remove('open');
});

// Filtering
function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  const fd = document.getElementById('filter-dec').value;
  const fr = document.getElementById('filter-rule').value;
  let shown = 0;
  document.querySelectorAll('.skill').forEach((el) => {
    const skill = el.dataset.skill;
    const dec = el.dataset.decision;
    const rule = el.dataset.rule;
    const matchQ = !q || skill.toLowerCase().includes(q) ||
      Array.from(el.querySelectorAll('.scenario .name')).some(n => n.textContent.toLowerCase().includes(q));
    const matchD = !fd || dec === fd;
    const matchR = !fr || rule === fr;
    const show = matchQ && matchD && matchR;
    el.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  document.getElementById('count').textContent = `${shown} of ${DATA.iterations.length} skills`;
}

// Populate rule filter
function populateRuleFilter() {
  const sel = document.getElementById('filter-rule');
  Object.keys(DATA.decision_rules).sort().forEach(r => {
    const o = document.createElement('option');
    o.value = r; o.textContent = r;
    sel.appendChild(o);
  });
}

document.getElementById('search').addEventListener('input', applyFilters);
document.getElementById('filter-dec').addEventListener('change', applyFilters);
document.getElementById('filter-rule').addEventListener('change', applyFilters);

renderKpis();
renderCharts();
populateRuleFilter();
renderSkills();
applyFilters();
</script>
</body>
</html>
"""


def main():
    DASH.mkdir(parents=True, exist_ok=True)
    data = build_data()
    json_blob = json.dumps(data, indent=2)
    html = HTML_TEMPLATE.replace("__DATA__", json_blob)
    (DASH / "index.html").write_text(html, encoding="utf-8")
    print(f"Wrote {DASH / 'index.html'} ({len(html):,} bytes, {data['kpis']['scenarios_count']} scenarios)")


if __name__ == "__main__":
    main()
