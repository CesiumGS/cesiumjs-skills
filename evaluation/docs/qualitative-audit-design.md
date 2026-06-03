# Qualitative Baseline-Audit Design

Goal: every eval has **two lanes** — deterministic programmatic checks (the gate) **and** a
static, criteria-based qualitative judge (0–10, advisory). Run both over all 14 skills' rendered
baselines to **audit** whether each baseline is still acceptable, browsable in an industry-grade UI.

## 1. Static qualitative judge (single-render, NOT pairwise)

Six weighted dimensions, each scored 0–10 by the judge from the screenshot:

| dimension | weight | gist |
|---|---|---|
| `render_liveness` | 0.20 | real loaded scene, not black/starfield/gray-unloaded/error (HARD GATE) |
| `subject_presence_and_recognizability` | 0.22 | intended subject clearly present & identifiable (GATE) |
| `framing_and_composition` | 0.18 | subject centered, well-sized (~15–70% frame), not a speck / off-frame |
| `prompt_and_behavior_fidelity` | 0.22 | viewing geometry & content match the prompt/expected behaviors |
| `visual_correctness_and_artifacts` | 0.10 | no z-fighting / missing textures / stranded geometry |
| `legibility_and_clarity` | 0.08 | labels readable, not cluttered/occluded |

**Scoring:** `weighted_sum = Σ(dim_score·weight)`. **Gates:** `render_liveness ≤ 2` caps overall at 2.0;
`subject ≤ 2` caps at 3.5. `overall = round(min(weighted_sum, cap), 1)`.
**Bands:** PASS ≥ 7.0 · BORDERLINE 4.5–6.9 · FAIL < 4.5.

**Failure modes the judge must name:** `black_frame_ion_auth, starfield_only, gray_unloaded_globe,
subject_tiny_speck, subject_off_frame, camera_inside_geometry, nadir_flattened_volume, wrong_subject,
flat_basemap_no_relief, missing_required_subject, over_cluttered_labels, render_artifacts,
wrong_viewing_geometry`.

**Reliability:** N=3 judges, distinct seeds [42,123,789] + varied lenses (failure-auditor / fidelity /
holistic); aggregate per-dimension by **median**, then gate+weight once; a gate also fires if ≥2/3 judges
flag it. Confidence high/medium/low from band agreement + spread; BORDERLINE or low → human review.
Calibration anchors embedded in the prompt (0–2 dead/wrong · 3–4 major · 5–6 borderline · 7–8 clearly-good · 9–10 exemplary).

## 2. Item contract (what the judge emits per case)

Extends the existing `visual-review.schema.json` v1.0 **additively** (so `scorecard.py` consumes it unchanged):

```jsonc
{
  "skill": "cesiumjs-camera", "case_id": "eval-101",
  "status": "pass|fail|needs_review|not_reviewed|not_applicable",
  "score": 0.0-1.0,            // v1.0 field = overall_score/10 (what scorecard.py reads)
  "overall_score": 0.0-10.0,   // NEW additive
  "summary": "…",
  "dimensions": { "<rubric_key>": { "score": 0-10, "status": "...", "note": "…" }, ... },
  "failure_flags": ["starfield_only", ...],  // NEW additive
  "observations": ["…"], "risks": ["…"],
  "screenshots": ["optimization/runs/<skill>/baseline/<dir>/screenshot.png"],
  "required": true, "blocking": true,
  "reviewer": "static-visual-judge", "reviewed_at": "…",
  "judge": { "model": "...", "n_judges": 3, "seeds": [42,123,789], "aggregation": "median", "protocol_version": "static-visual-v1" } // NEW
}
```

Status mapping: any blocking failure_flag → fail; else score≥7→pass, 5–7→needs_review, <5→fail;
judge unavailable → needs_review.

## 3. Gate composition (unchanged invariant)

`overall_result = pass` iff `deterministic_result == pass` (score ≥ 0.95, no critical failures)
**AND** `visual_result ∈ {pass, not_required}`. The 0–10 qualitative score can **downgrade** a
deterministically-passing run (blocking flag → fail / needs_review) but can **never upgrade** a
deterministic failure. Deterministic lane stays Python-owned and binding.

## 4. Single source of truth + pipeline

- `evaluation/framework/judge/` — `static_judge.py` (`judge_render`, panel, scoring/gating, `__main__`),
  `cli_adapter.py` (self-contained claude-CLI adapter; must NOT import `optimization/`),
  `prompts/static-visual-v1.txt`.
- `evaluation/scripts/run-baseline-audit.py` — runs BOTH lanes over all 14 baselines
  (`optimization/runs/<skill>/baseline`, bridged via the tracked `*-baseline-observed.evidence.json`
  fixtures' `run_artifact_path`) → one combined scorecard. Flags: `--skills`, `--no-judge`,
  `--visual-review <json>` (inject pre-judged items), `--emit-cases`, `--judge-model`, `--n-judges`,
  `--output-dir`. Exit = combined gate.
- **CI/CD** (`.github/workflows/baseline-audit.yml`): job 1 deterministic (`--no-judge`, blocking, no secrets);
  job 2 qualitative (claude CLI, advisory on PR / blocking nightly).
- **Local fan-out** (`.claude/workflows/evaluate-skills.js`): Score (`--no-judge --emit-cases`) →
  parallel Judge (each shells the SAME `static_judge` module) → Assemble (`--visual-review` re-score) → UI.
- **UI** (`build-audit-ui.py`): Lighthouse-style gauges, Datadog KPI strip, coverage-style skill×category
  matrix, test-report drill-down (full check table + 0–10 criteria breakdown + baseline screenshot),
  worst-first **Audit Board** with Accept / Flag-rebaseline / Needs-review toggles (localStorage, exportable).
