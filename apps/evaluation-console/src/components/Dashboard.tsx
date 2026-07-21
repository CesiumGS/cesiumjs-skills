import { useMemo } from "react";
import { ArrowRight, Flag } from "lucide-react";
import { useStore } from "../store";
import { modelShort, pluralize, relativeTime } from "../lib/format";
import { Combos, Kpi, RunsByHarness, RunTrend, SkillTrend } from "./Compare";

/* ============================================================================
   DASHBOARD — Altitude 0. The landing screen for the whole console.

   Best-practice ordering (inverted pyramid):
     1. Status line: the single most important fact (latest run verdict) plus
        the freshness of the data, with the one primary action.
     2. KPI row: five glanceable numbers spanning runs, harnesses, and models.
     3. Performance over time: the run-score trend, the anchor chart.
     4. Side-by-side units of analysis: harness outcomes beside the observed
        model leaderboard — the two questions the console exists to answer.
     5. Per-skill optimization trend, the drill-down teaser.
   Every panel links into the deeper station that owns its data. The dashboard
   is read-only: it never mutates review state.
   ============================================================================ */

function freshness(iso: string | null | undefined): { label: string; stale: boolean } {
  if (!iso) return { label: "no runs on disk", stale: true };
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  return { label: relativeTime(iso), stale: days > 7 };
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
        <span className={`fresh-chip${fresh.stale ? " stale" : ""}`} title="Timestamp of the newest scorecard run on disk.">
          Latest data {fresh.label}
          {fresh.stale && " · stale"}
        </span>
      </div>

      {/* 1 — STATUS LINE: loaded verdict + the primary action. */}
      <div className="hero-card dashboard-hero">
        <div>
          <div className="ov-big" style={{ color: pass ? "var(--pass)" : "var(--fail)" }}>
            {scorecard ? (pass ? "PASS" : "FAIL") : "—"}
          </div>
          <div className="stage-sub" style={{ marginTop: "var(--sp-2)" }}>
            <span className="mono">{scorecard?.runId ?? "no run loaded"}</span>
            {scorecard && <span style={{ color: "var(--text-3)" }}>{relativeTime(scorecard.timestampUtc)}</span>}
          </div>
        </div>
        <div className="hero-right">
          <button className={`review-cta${needsYouCount > 0 ? " hot" : ""}`} onClick={() => setStation("evaluate")}>
            {needsYouCount > 0 ? (
              <>
                <Flag size={12} aria-hidden /> {needsYouCount} {needsYouCount === 1 ? "case needs" : "cases need"} your
                eyes → Evaluate (1)
              </>
            ) : (
              <>Open the loaded run → Evaluate (1)</>
            )}
          </button>
        </div>
      </div>

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
        <Kpi label="Loop Iterations" value={String(iterations)} sub={`${skills.length} skills under optimization`} />
      </div>

      {/* 3 — THE ANCHOR CHART: score across runs, over time. */}
      <RunTrend />

      {/* 4 — THE TWO UNITS OF ANALYSIS, side by side. */}
      <div className="dashboard-columns">
        <div className="dashboard-col">
          <div className="dashboard-col-head">
            <span>Harness Performance</span>
            <button className="pill link-pill" onClick={() => setStation("compare")} title="Open Models & Harnesses">
              Details <ArrowRight size={11} aria-hidden />
            </button>
          </div>
          <RunsByHarness />
        </div>
        <div className="dashboard-col">
          <div className="dashboard-col-head">
            <span>Model Performance</span>
            <button className="pill link-pill" onClick={() => setStation("compare")} title="Open Models & Harnesses">
              Details <ArrowRight size={11} aria-hidden />
            </button>
          </div>
          <Combos />
        </div>
      </div>

      {/* 5 — DRILL-DOWN TEASER: one skill's optimization trajectory. */}
      <SkillTrend />
    </div>
  );
}
