import { useMemo } from "react";
import { ArrowRight, Flag } from "lucide-react";
import { useStore } from "../store";
import { modelShort, pluralize, relativeTime, verdictView } from "../lib/format";
import { healthFromSummary, healthPct } from "../lib/grade";
import { HarnessChip, Kpi, RunTrend } from "./Compare";
import { LiveNowBanner } from "./Live";
import type { RunSummary } from "../types";

/* ============================================================================
   DASHBOARD — Altitude 0. The landing screen for the whole console.

   Best-practice ordering (inverted pyramid):
     1. Status line: the single most important fact (latest run verdict) plus
        the freshness of the data, with the one primary action.
     2. Recent runs and the KPI row: glanceable numbers spanning runs,
        harnesses, and models.
     3. Performance over time: the run-score trend, the anchor chart.
     4. Links into the Models (7) and Harnesses (8) stations, which own the
        deeper per-unit analysis. The dashboard never duplicates their panels.
   The dashboard is read-only: it never mutates review state.
   ============================================================================ */

function freshness(iso: string | null | undefined): { label: string; stale: boolean } {
  if (!iso) return { label: "none on disk", stale: true };
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  return { label: relativeTime(iso), stale: days > 7 };
}

/** Chip text for a run's harness, honest about gaps. The real codegen harness
 *  always wins (recovered from metas when not stamped); only genuinely
 *  harness-less runs fall back to their evidence source (fixtures / mixed). */
function runSourceChip(r: RunSummary): string {
  if (r.harness && r.harness !== "unknown") return r.harness;
  if (r.source === "fixtures") return "fixtures";
  if (r.source === "mixed") return "mixed";
  return "unknown";
}

/* ---------------------------------------------------------------------------
   RECENT RUNS: every recent run at a glance — verdict, score, evidence
   source, judge coverage, size, age. Click a row to focus that run.
   --------------------------------------------------------------------------- */
function RecentRuns() {
  const { runs, scorecard, switchRun, openOverlay } = useStore();
  const recent = useMemo(
    () => [...runs].sort((a, b) => b.timestamp_utc.localeCompare(a.timestamp_utc)).slice(0, 6),
    [runs]
  );
  if (recent.length === 0) return null;
  return (
    <div className="dash-card recent-runs">
      <div className="section-title">
        Recent Runs
        <span className="section-sub">
          Newest first. The verdict combines Code Tests and Visual Tests; the % is the Code Test score. Click a row to focus that run.
        </span>
        <span className="spacer" />
        <button className="pill link-pill" onClick={() => openOverlay("harness")} title="Run Browser (h)">
          Browse all {runs.length} <ArrowRight size={11} aria-hidden />
        </button>
      </div>
      <ol className="rr-list">
        {recent.map((r) => {
          const focused = scorecard?.runId === r.run_id;
          const pass = r.overall_result === "pass";
          const verdict = verdictView(r.overall_result);
          const health = healthFromSummary(r);
          const aggPct = health.aggregate !== null ? healthPct(health.aggregate, pass) : null;
          const scorePct = aggPct !== null ? `${aggPct}%` : "—";
          return (
            <li key={r.run_id}>
              <button
                className={`rr-row${focused ? " focused" : ""}`}
                onClick={() => void switchRun(r.run_id)}
                title={`${r.run_id}${verdict.hint ? `\n${verdict.hint}` : ""}\nClick to focus this run in every station.`}
              >
                <span className={`rr-verdict ${verdict.tone}`}>{verdict.label}</span>
                <span
                  className="rr-score mono"
                  title={
                    health.hasVisual
                      ? "Overall health: Code Tests and Visual Tests combined equally."
                      : "Overall health: Code Tests only."
                  }
                >
                  {scorePct}
                </span>
                <span className="rr-bar" aria-hidden>
                  <span
                    className={`rr-fill ${pass ? "pass" : "fail"}`}
                    style={{ width: `${aggPct ?? 0}%` }}
                  />
                </span>
                <HarnessChip harness={runSourceChip(r)} />
                {r.model ? (
                  <span className="rr-model mono" title={`Codegen model recorded: ${r.model}`}>
                    {modelShort(r.model)}
                  </span>
                ) : (
                  <span className="rr-model unrecorded" title="Codegen model not recorded by this run.">
                    model?
                  </span>
                )}
                <span
                  className={`rr-judge${r.visual_review_supplied ? "" : " off"}`}
                  title={
                    r.visual_review_supplied
                      ? "Code Tests plus Visual Tests of the rendered screenshots."
                      : "Code Tests only; Visual Tests were not run."
                  }
                >
                  {r.visual_review_supplied ? "Code + Visual" : "Code Only"}
                </span>
                <span className="rr-cases mono">{pluralize(r.total_cases, "case")}</span>
                <span className="rr-when">{relativeTime(r.timestamp_utc)}</span>
                {focused && <span className="rr-focus-tag">Focused</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DashboardStation() {
  const { scorecard, runs, skills, insights, registry, needsYouCount, setStation } = useStore();

  const latestRun = useMemo(
    () =>
      runs.reduce<(typeof runs)[number] | null>(
        (best, r) => (!best || r.timestamp_utc > best.timestamp_utc ? r : best),
        null
      ),
    [runs]
  );
  const fresh = freshness(latestRun?.timestamp_utc);

  const scored = runs.filter((r) => typeof r.overall_score === "number");
  const passRate = runs.length
    ? Math.round((runs.filter((r) => r.overall_result === "pass").length / runs.length) * 100)
    : null;

  const combos = insights?.combos ?? [];
  const iterations = combos.reduce((n, c) => n + c.iterations, 0);
  const failedBaselines = skills.filter((skill) =>
    skill.history.some((iteration) => iteration.is_baseline && iteration.status === "failed")
  ).length;
  const best = combos
    .filter((c) => c.win_rate !== null && c.scored_iterations >= 2)
    .sort((a, b) => (b.win_rate as number) - (a.win_rate as number))[0];
  const harnessCount = registry?.harnesses.length ?? 0;

  const pass = scorecard?.overallResult === "pass";

  return (
    <div className="overview dashboard-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Dashboard</div>
          <div className="dash-sub">
            The console at a glance: how the harnesses and models are doing across runs and over time.
          </div>
        </div>
        <span className="spacer" />
        <span
          className={`fresh-chip${latestRun && fresh.stale ? " stale" : ""}`}
          title={latestRun ? "Timestamp of the newest scorecard run on disk." : "No scorecard runs exist in this repository."}
        >
          {latestRun ? `Latest Data ${fresh.label}${fresh.stale ? " · Stale" : ""}` : "No run data yet"}
        </span>
      </div>

      {/* 0 — HAPPENING NOW: present only while an eval run is executing.
          The dashboard stays results-oriented; the run's full anatomy
          (phases, trials, journal) lives in the Run station this links to. */}
      <LiveNowBanner />

      {/* 1 — STATUS LINE: the focused run's verdict + the primary action.
          A det-only run must not read as a full PASS: the visual gate never ran. */}
      <div className="hero-card dashboard-hero">
        <div>
          <div className="hero-eyebrow">{scorecard ? "Focused Run" : "Blank Slate"}</div>
          {!scorecard ? (
            <div className="ov-big" style={{ color: "var(--text-2)" }}>NO RUNS YET</div>
          ) : scorecard.overallResult === "incomplete" || (pass && !scorecard.visualReviewSupplied) ? (
            <>
              <div className="ov-big" style={{ color: "var(--defer)" }}>INCOMPLETE</div>
              <div className="stage-sub" style={{ marginTop: "var(--sp-1)" }}>
                <span style={{ color: "var(--pass)" }}>Code Tests PASS</span>
                <span style={{ color: "var(--unknown)" }}>
                  · Visual Tests {scorecard.overallResult === "incomplete" ? "did not run — no baseline screenshots" : "not run"}
                </span>
              </div>
            </>
          ) : (
            <div className="ov-big" style={{ color: pass ? "var(--pass)" : "var(--fail)" }}>
              {scorecard ? (pass ? "PASS" : "FAIL") : "—"}
            </div>
          )}
          <div className="stage-sub" style={{ marginTop: "var(--sp-2)" }}>
            <span className={scorecard ? "mono" : undefined}>
              {scorecard?.runId ?? "This repository has no evaluation data yet."}
            </span>
            {scorecard && <span style={{ color: "var(--text-3)" }}>{relativeTime(scorecard.timestampUtc)}</span>}
          </div>
        </div>
        <div className="hero-right">
          <button
            className={`review-cta${needsYouCount > 0 ? " hot" : ""}`}
            onClick={() => setStation(!scorecard ? "live" : needsYouCount > 0 ? "review" : "evaluate")}
          >
            {!scorecard ? (
              <>Start the first study → Run (1)</>
            ) : needsYouCount > 0 ? (
              <>
                <Flag size={12} aria-hidden /> {needsYouCount} {needsYouCount === 1 ? "case needs" : "cases need"} your
                eyes → Review (3)
              </>
            ) : (
              <>Open the focused run → Evaluate (2)</>
            )}
          </button>
        </div>
      </div>

      {/* 2 — ALL RECENT RUNS: the at-a-glance table the dashboard exists for. */}
      <RecentRuns />

      {/* 2 — KPI ROW: runs, harnesses, models, one line each. */}
      <div className="kpi-row">
        <Kpi
          label="Runs on Disk"
          value={String(runs.length)}
          sub={latestRun ? `Newest ${fresh.label}` : "Run the scorecard to add one"}
          tone="brand"
        />
        <Kpi
          label="Run Pass Rate"
          value={passRate === null ? "—" : `${passRate}%`}
          sub={`${scored.length} scored ${pluralize(scored.length, "run").replace(/^\d+ /, "")}`}
          tone={passRate !== null && passRate >= 90 ? "good" : undefined}
        />
        <Kpi label="Harnesses" value={String(harnessCount)} sub="Registered in the registry" />
        <Kpi
          label="Best Model"
          value={best ? modelShort(best.model_id) : "—"}
          sub={
            best
              ? `${Math.round((best.win_rate as number) * 100)}% win rate, ±σ qualified`
              : "Needs 2+ scored iterations"
          }
          tone={best ? "good" : undefined}
          small
        />
        <Kpi
          label="Candidate Rounds"
          value={String(iterations)}
          sub={
            failedBaselines
              ? `${failedBaselines} ${failedBaselines === 1 ? "baseline failure" : "baseline failures"} blocked candidate work`
              : `${skills.length} skills in optimization history`
          }
        />
      </div>

      {/* 3 — THE ANCHOR CHART: score across runs, over time. */}
      <RunTrend />

      {/* 4 — WHERE TO DIG DEEPER: the per-unit analysis lives in its own
          station now; the dashboard links instead of duplicating panels. */}
      <div className="dashboard-links">
        <button className="insight-link" onClick={() => setStation("models")} title="Open the Models station (key 6)">
          <span className="il-title">
            Models <ArrowRight size={12} aria-hidden />
          </span>
          <span className="il-sub">Catalogs and cost tiers beside observed win rates per model.</span>
        </button>
        <button
          className="insight-link"
          onClick={() => setStation("harnesses")}
          title="Open the Harnesses station (key 8)"
        >
          <span className="il-title">
            Harnesses <ArrowRight size={12} aria-hidden />
          </span>
          <span className="il-sub">Capability cards beside run outcomes per harness.</span>
        </button>
      </div>
    </div>
  );
}
