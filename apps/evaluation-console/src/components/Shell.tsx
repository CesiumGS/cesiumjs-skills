import { Command, HelpCircle, Moon, Sun, Grid3x3, Send, Layers, GitCompareArrows, LayoutDashboard, Radio, ChevronDown, Eye, EyeOff } from "lucide-react";
import { useStore } from "../store";
import type { Station } from "../types";
import { pluralize, relativeTime } from "../lib/format";
import { ProvGlyph } from "./primitives";
import { liveRunTitle } from "./Live";

const LIFECYCLE_STATIONS: Array<{ id: Station; num: string; name: string }> = [
  { id: "evaluate", num: "1", name: "Evaluate" },
  { id: "review", num: "2", name: "Review" },
  { id: "optimize", num: "3", name: "Optimize" },
  { id: "decide", num: "4", name: "Decide" },
  { id: "promote", num: "5", name: "Promote" }
];

/** "scorecard-20260721T142514Z-d3f47ec568b1" → "Jul 21 · 14:25 · d3f47ec". */
function runShortLabel(runId: string | undefined, timestamp: string | undefined, commit: string | undefined): string {
  if (timestamp) {
    const d = new Date(timestamp);
    const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    return commit ? `${day} ${time} · ${commit.slice(0, 7)}` : `${day} ${time}`;
  }
  return runId ? runId.slice(0, 24) : "no run loaded";
}

function sourceLabel(source: string | undefined, harness: string | undefined): { label: string; cls: string; hint: string } {
  if (source === "fixtures")
    return {
      label: "Synthetic test data",
      cls: "synthetic",
      hint: "Scored against hand-authored test fixtures. This validates the evaluator itself — no AI agent was involved."
    };
  if (source === "mixed")
    return {
      label: "Real + synthetic",
      cls: "synthetic",
      hint: "This run scores a mix of real agent output and hand-authored test fixtures in a single sweep."
    };
  if (harness && harness !== "unknown")
    return { label: harness, cls: "agent", hint: `Real agent output, generated with the ${harness} harness.` };
  return {
    label: "Origin unknown",
    cls: "unknown",
    hint: "This run predates provenance stamping, so the producing harness can't be determined."
  };
}

export function TopStrip() {
  const {
    scorecard,
    config,
    theme,
    toggleTheme,
    openOverlay,
    counts,
    setStation,
    baselineRun,
    live,
    liveRunning
  } = useStore();
  const liveRun = liveRunning ? live?.active.find((r) => r.status === "running") : undefined;
  const judged = scorecard ? scorecard.visualReviewSupplied : null;
  const src = sourceLabel(config?.source, scorecard?.harness ?? config?.harness);
  const pass = scorecard?.overallResult === "pass";
  const scorePct =
    typeof scorecard?.overallScore === "number" ? `${Math.round(scorecard.overallScore * 100)}%` : null;
  return (
    <header className="topstrip" role="banner">
      <div className="brand">
        <img className="brand-mark" src="/cesium-logomark.svg" alt="" aria-hidden />
        Skill Evaluation Console
      </div>

      {/* The one piece of header state: which run the lifecycle stations are
          reading. A labeled control, not a mystery string — click to switch. */}
      <button
        className="run-select"
        onClick={() => openOverlay("harness")}
        title={
          scorecard
            ? `Focused run: ${scorecard.runId}\nEvery lifecycle station (1–5) reads this run.\n${counts.total} cases · commit ${scorecard.gitCommit?.slice(0, 7) ?? "?"}\nClick to browse and switch runs (h).`
            : "No run loaded. Click to browse runs (h)."
        }
      >
        <span className="rs-label">Focused run</span>
        <span className="rs-value">
          {scorecard && <span className={`rs-dot ${pass ? "pass" : "fail"}`} aria-hidden />}
          <span className="mono rs-id">
            {runShortLabel(scorecard?.runId ?? config?.run_id, scorecard?.timestampUtc, scorecard?.gitCommit)}
          </span>
          {scorePct && (
            <span
              className={`rs-score mono ${pass ? "pass" : "fail"}`}
              title="Overall verdict combines automated checks and the visual review; the percentage is the automated-check score."
            >
              {pass ? "PASS" : "FAIL"} · checks {scorePct}
            </span>
          )}
          <ChevronDown size={12} aria-hidden className="rs-chev" />
        </span>
      </button>

      {scorecard && (
        <div className="run-facts" aria-label="Focused run provenance">
          <span
            className={`fact-chip judge ${judged ? "on" : "off"}`}
            title={
              judged
                ? "Every case ran automated checks, and a judge panel reviewed the rendered screenshots."
                : "Only automated checks ran — no judge reviewed the rendered screenshots. Launch a new run from the Live station (7) with visual judging on to add that."
            }
          >
            {judged ? <Eye size={11} aria-hidden /> : <EyeOff size={11} aria-hidden />}
            {judged ? "Checks + visual review" : "No visual review"}
          </span>
          <button
            className={`fact-chip source ${src.cls}`}
            onClick={() => openOverlay("harness")}
            title={`${src.hint} Opens the Run Browser (h).`}
          >
            <Layers size={11} aria-hidden /> {src.label}
          </button>
          <button
            className="fact-chip baseline"
            onClick={() => openOverlay("harness")}
            title={
              baselineRun
                ? `Comparing against baseline ${baselineRun.run_id}. Change it from the Run Browser (h).`
                : "No comparison baseline set. Pick one from the Run Browser (h)."
            }
          >
            {baselineRun ? (
              <>
                vs <span className="mono">{runShortLabel(baselineRun.run_id, baselineRun.timestamp_utc, undefined)}</span>
              </>
            ) : (
              "no baseline"
            )}
          </button>
          <span className="fact-plain">{pluralize(counts.total, "case")}</span>
          {scorecard.timestampUtc && <span className="fact-plain">{relativeTime(scorecard.timestampUtc)}</span>}
        </div>
      )}
      <span className="spacer" />
      {liveRun && (
        <button
          className="live-pill"
          onClick={() => setStation("live")}
          title={`Eval run in progress: ${liveRunTitle(liveRun)}. Open the Live station (7).`}
        >
          <span className="dot" aria-hidden />
          <ProvGlyph kind="live" /> {liveRunTitle(liveRun)}
          <span className="mono">{Math.round(liveRun.progress * 100)}%</span>
        </button>
      )}
      <button className="icon-btn" title="Command palette (⌘K)" onClick={() => openOverlay("palette")}>
        <Command size={16} />
      </button>
      <button className="icon-btn" title="Toggle theme (T)" onClick={toggleTheme}>
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="icon-btn" title="Keyboard help (?)" onClick={() => openOverlay("help")}>
        <HelpCircle size={16} />
      </button>
    </header>
  );
}

export function Rail() {
  const {
    station,
    setStation,
    needsYouCount,
    confirmedFlagKeys,
    skills,
    live,
    liveRunning,
    openOverlay,
    doExport
  } = useStore();
  const running = liveRunning || skills.some((s) => s.running);
  const stalledCount = (live?.active ?? []).filter((r) => r.status !== "running").length;
  const promotable = skills.filter((s) => s.latest?.decision === "KEEP").length;

  const badge = (id: Station) => {
    if (id === "review") return needsYouCount ? <span className="st-badge hot">{needsYouCount}</span> : null;
    if (id === "optimize")
      return running ? (
        <span className="st-badge live">●</span>
      ) : (
        <span className="st-badge">{skills.length}</span>
      );
    if (id === "decide") return promotable ? <span className="st-badge">{promotable}</span> : null;
    if (id === "promote") return promotable ? <span className="st-badge">{promotable}</span> : null;
    return null;
  };

  return (
    <nav className="rail col" role="navigation" aria-label="Console navigation">
      {/* Dashboard is the landing screen: altitude 0, above the lifecycle. */}
      <button
        className={`station station--dashboard${station === "dashboard" ? " active" : ""}`}
        onClick={() => setStation("dashboard")}
        aria-current={station === "dashboard"}
      >
        <LayoutDashboard size={13} aria-hidden />
        <span className="st-name">Dashboard</span>
      </button>

      {/* Live sits between the landing screen and the lifecycle: "what is
          happening right now" is an altitude of its own, not a lifecycle step. */}
      <button
        className={`station station--dashboard${station === "live" ? " active" : ""}`}
        onClick={() => setStation("live")}
        aria-current={station === "live"}
        title={liveRunning ? "An eval run is in progress" : "No eval run in progress"}
      >
        <Radio size={13} aria-hidden />
        <span className="st-name">Live</span>
        {liveRunning && <span className="st-badge live rail-live-badge">●</span>}
        {!liveRunning && stalledCount > 0 && (
          <span className="st-badge" title={`${stalledCount} stalled run(s) on disk`}>
            {stalledCount}
          </span>
        )}
      </button>

      <div className="rail-section">Lifecycle</div>
      {LIFECYCLE_STATIONS.map((st) => (
        <div key={st.id}>
          <button
            className={`station${station === st.id ? " active" : ""}`}
            onClick={() => setStation(st.id)}
            aria-current={station === st.id}
          >
            <span className="st-num">{st.num}</span>
            <span className="st-name">{st.name}</span>
            {badge(st.id)}
          </button>
          {st.id === "review" && (
            <button className="rail-sub" onClick={doExport} title="Hand the confirmed flags to the optimizer">
              <Send size={12} /> Focus
              <span className="st-badge hot" style={{ marginLeft: "auto" }}>
                {confirmedFlagKeys.length}
              </span>
            </button>
          )}
        </div>
      ))}

      {/* Insights sit beside the lifecycle, not inside it: auditing models and
          harnesses is cross-run analysis, not a step in shipping one run. */}
      <div className="rail-section">Insights</div>
      <button
        className={`station${station === "compare" ? " active" : ""}`}
        onClick={() => setStation("compare")}
        aria-current={station === "compare"}
      >
        <span className="st-num">6</span>
        <span className="st-name">Models &amp; Harnesses</span>
        <GitCompareArrows size={12} aria-hidden />
      </button>

      <div className="rail-overlays">
        <div className="rail-section" style={{ paddingTop: 0 }}>
          Lenses
        </div>
        <button className="rail-sub" onClick={() => openOverlay("matrix")}>
          <Grid3x3 size={13} /> Skill × Category Matrix <span className="kbd" style={{ marginLeft: "auto" }}>m</span>
        </button>
        <button className="rail-sub" onClick={() => openOverlay("harness")}>
          <Layers size={13} /> Run Browser <span className="kbd" style={{ marginLeft: "auto" }}>h</span>
        </button>
      </div>
    </nav>
  );
}

export function ActionBar() {
  const { station, selectedView, iterationDetail } = useStore();

  let machineSays = "";
  if ((station === "review" || station === "evaluate") && selectedView) {
    const det = selectedView.result;
    const vis = selectedView.visualStatus;
    const verdict =
      det === "fail" || vis === "fail" ? "FAIL" : vis === "needs_review" || vis === "not_reviewed" ? "NEEDS REVIEW" : "PASS";
    machineSays = `Machine says ${verdict}`;
  } else if ((station === "decide" || station === "optimize") && iterationDetail) {
    machineSays = iterationDetail.decision ? `Machine decided ${iterationDetail.decision}` : "Iteration not yet decided";
  }

  return (
    <footer className="actionbar" role="contentinfo">
      <span className="machine-says">{machineSays}</span>
      <div className="verbs">
        {(station === "review" || station === "evaluate") && (
          <>
            <span className="verb">
              <span className="kbd">a</span> Accept
            </span>
            <span className="verb">
              <span className="kbd">f</span> Flag → Focus
            </span>
            <span className="verb">
              <span className="kbd">d</span> Defer
            </span>
            <span className="verb">
              <span className="kbd">space</span> Details
            </span>
            <span className="verb">
              <span className="kbd">j</span>/<span className="kbd">k</span> Next
            </span>
          </>
        )}
        {station === "optimize" && (
          <>
            <span className="verb">
              <span className="kbd">j</span>/<span className="kbd">k</span> Skill
            </span>
            <span className="verb">
              <span className="kbd">[</span>/<span className="kbd">]</span> Scenario
            </span>
            <span className="verb">
              <span className="kbd">enter</span> → Decide
            </span>
          </>
        )}
        {station === "decide" && (
          <>
            <span className="verb">
              <span className="kbd">x</span> Swipe
            </span>
            <span className="verb">
              <span className="kbd">X</span> Blink
            </span>
            <span className="verb">
              <span className="kbd">[</span>/<span className="kbd">]</span> Scenario
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
