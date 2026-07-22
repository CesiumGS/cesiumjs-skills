import type { ReactNode } from "react";
import { Command, HelpCircle, Moon, Sun, Grid3x3, Send, Layers, Cpu, Bot, LayoutDashboard, Rocket, ChevronDown, Eye, EyeOff, TrendingUp, RotateCcw } from "lucide-react";
import { useStore } from "../store";
import type { Station } from "../types";
import { pluralize, relativeTime } from "../lib/format";
import { ProvGlyph } from "./primitives";
import { liveRunTitle } from "./Live";

/* The five lifecycle steps every focused run travels. Each carries a one-line
   description (rendered in the rail) and a fuller hint (tooltip) so a first
   visit to any station never requires guessing what it is for. */
const LIFECYCLE_STATIONS: Array<{ id: Station; num: string; name: string; desc: string; hint: string }> = [
  {
    id: "evaluate",
    num: "1",
    name: "Evaluate",
    desc: "Scorecard at a glance",
    hint: "Read-only summary of the focused run: overall verdict, category scores, and how it compares to the baseline run."
  },
  {
    id: "review",
    num: "2",
    name: "Review",
    desc: "Triage & flag failures",
    hint: "Walk the focused run's cases worst-first. Accept, flag, or defer each one; the cases you flag become the optimizer's focus set."
  },
  {
    id: "optimize",
    num: "3",
    name: "Optimize",
    desc: "Skill improvement loop",
    hint: "Watch the autonomous loop propose and test SKILL.md candidates for each skill, seeded by the flags you confirmed in Review."
  },
  {
    id: "decide",
    num: "4",
    name: "Decide",
    desc: "Approve fixes",
    hint: "Diff each candidate's renders against the current best and sanity-check the loop's KEEP / REJECT call before anything ships."
  },
  {
    id: "promote",
    num: "5",
    name: "Promote",
    desc: "Ship winners live",
    hint: "The deliberate final step and the human gate: KEEP candidates arrive here staged, and nothing touches a live SKILL.md until you promote it (the current version is archived first)."
  }
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
      label: "Synthetic Test Data",
      cls: "synthetic",
      hint: "Scored against hand-authored test fixtures. This validates the evaluator itself; no AI agent was involved."
    };
  if (source === "mixed")
    return {
      label: "Real + Synthetic",
      cls: "synthetic",
      hint: "This run scores a mix of real agent output and hand-authored test fixtures in a single sweep."
    };
  if (harness && harness !== "unknown")
    return { label: harness, cls: "agent", hint: `Real agent output, generated with the ${harness} harness.` };
  return {
    label: "Origin Unknown",
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
        <span className="rs-label">Focused Run</span>
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
              {pass ? "PASS" : "FAIL"} · Checks {scorePct}
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
                : "Only automated checks ran; no judge reviewed the rendered screenshots. Launch a new run from Run Studies (7) with visual judging on to add that."
            }
          >
            {judged ? <Eye size={11} aria-hidden /> : <EyeOff size={11} aria-hidden />}
            {judged ? "Checks + Visual Review" : "No Visual Review"}
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
              "No Baseline"
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
          title={`Eval run in progress: ${liveRunTitle(liveRun)}. Open Run Studies (7).`}
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
    suggestedFlagCount,
    skills,
    live,
    liveRunning,
    openOverlay,
    doExport
  } = useStore();
  const loopRunning = liveRunning || skills.some((s) => s.running);
  const stalledCount = (live?.active ?? []).filter((r) => r.status !== "running").length;
  const decidable = skills.filter((s) => s.latest?.decision === "KEEP").length;
  const stagedCount = skills.filter((s) => s.latest?.decision === "KEEP" && s.latest?.promotion === "staged").length;
  const flagged = confirmedFlagKeys.length;

  /* Badges carry information, never decoration: each one answers "how many
     things wait for me here?" or "is something running?" — and says which. */
  const badge = (id: Station): ReactNode => {
    if (id === "review")
      return needsYouCount ? (
        <span className="st-badge hot" title={`${pluralize(needsYouCount, "case")} in this run need your eyes`}>
          {needsYouCount}
        </span>
      ) : null;
    if (id === "optimize")
      return loopRunning ? (
        <span className="st-badge live" title="An optimization loop is running right now">
          ●
        </span>
      ) : null;
    if (id === "decide")
      return decidable ? (
        <span className="st-badge" title={`${pluralize(decidable, "skill")} with a KEEP candidate awaiting your verification`}>
          {decidable}
        </span>
      ) : null;
    if (id === "promote")
      return stagedCount ? (
        <span className="st-badge hot" title={`${pluralize(stagedCount, "staged candidate")} awaiting your promotion approval`}>
          {stagedCount}
        </span>
      ) : null;
    return null;
  };

  const item = (id: Station, lead: ReactNode, name: string, desc: string, hint: string, extra?: ReactNode) => (
    <button
      className={`station station--rich${station === id ? " active" : ""}`}
      onClick={() => setStation(id)}
      aria-current={station === id ? "page" : undefined}
      title={hint}
    >
      <span className="st-lead">{lead}</span>
      <span className="st-text">
        <span className="st-name">{name}</span>
        <span className="st-desc">{desc}</span>
      </span>
      {extra}
    </button>
  );

  return (
    <nav className="rail col" role="navigation" aria-label="Console navigation">
      {/* ── Altitude 0: the two screens that are NOT scoped to one run. ── */}
      {item(
        "dashboard",
        <LayoutDashboard size={14} aria-hidden />,
        "Dashboard",
        "All studies at a glance",
        "Cross-study overview: recent runs, skill health, and what needs your attention. The one screen not scoped to a single run. Shortcut: 0"
      )}
      {item(
        "live",
        <Rocket size={14} aria-hidden />,
        "Run Studies",
        "Launch & monitor runs",
        "Your hands on the eval CLI: configure and kick off a new study, then watch its phases, trials, and journal live. Shortcut: 7",
        liveRunning ? (
          <span className="st-badge live" title="An eval run is executing right now">
            ● Live
          </span>
        ) : stalledCount > 0 ? (
          <span className="st-badge" title={`${pluralize(stalledCount, "stalled run")} on disk; open to inspect`}>
            {stalledCount}
          </span>
        ) : null
      )}

      {/* ── The lifecycle: five steps, one focused run. The Focused Run control
            in the top strip is the single anchor for which run these stations
            read; the rail stays a pure navigator. ── */}
      <div className="rail-section">Run Lifecycle</div>

      {LIFECYCLE_STATIONS.map((st) => (
        <div key={st.id}>
          {item(
            st.id,
            <span className="st-num">{st.num}</span>,
            st.name,
            st.desc,
            `${st.hint} Shortcut: ${st.num}`,
            badge(st.id)
          )}
          {st.id === "review" && (
            <button
              className={`rail-sub rail-handoff${flagged ? "" : " muted"}`}
              onClick={doExport}
              disabled={!flagged}
              title={
                flagged
                  ? `Write your ${pluralize(flagged, "confirmed flag")} to the focus set. The optimizer only chases human-confirmed flags.`
                  : suggestedFlagCount
                    ? `${pluralize(suggestedFlagCount, "machine-suggested flag")} await your confirmation. Confirm each in Review (e) before handing off.`
                    : "Flag failing cases in Review first; the optimizer only chases what you confirm."
              }
            >
              <Send size={12} aria-hidden />
              {flagged
                ? `Send ${pluralize(flagged, "confirmed flag")} → Optimize`
                : suggestedFlagCount
                  ? `${suggestedFlagCount} suggested · 0 confirmed`
                  : "No flags yet"}
            </button>
          )}
        </div>
      ))}

      {/* Insights sit beside the lifecycle, not inside it: auditing models and
          harnesses is cross-run analysis, not a step in shipping one run. */}
      <div className="rail-section">Insights</div>
      {item(
        "models",
        <Cpu size={14} aria-hidden />,
        "Models",
        "Catalogs & win rates",
        "The model as the unit of analysis: declared catalogs and cost tiers beside observed keep and win rates from the artifacts on disk. Shortcut: 6"
      )}
      {item(
        "harnesses",
        <Bot size={14} aria-hidden />,
        "Harnesses",
        "Capability & run outcomes",
        "The harness as the unit of analysis: registry capability cards beside run-level scorecard outcomes per harness. Shortcut: 8"
      )}

      <div className="rail-overlays">
        <div className="rail-section" style={{ paddingTop: 0 }}>
          Lenses
        </div>
        <button className="rail-sub" onClick={() => openOverlay("matrix")}>
          <Grid3x3 size={13} /> Skill × Category Matrix <span className="kbd" style={{ marginLeft: "auto" }}>m</span>
        </button>
        <button className="rail-sub" onClick={() => openOverlay("trends")}>
          <TrendingUp size={13} /> Win-Rate Trends <span className="kbd" style={{ marginLeft: "auto" }}>t</span>
        </button>
        <button className="rail-sub" onClick={() => openOverlay("harness")}>
          <Layers size={13} /> Run Browser <span className="kbd" style={{ marginLeft: "auto" }}>h</span>
        </button>
      </div>
    </nav>
  );
}

export function ActionBar() {
  const {
    station,
    selectedView,
    iterationDetail,
    setDecision,
    confirmAndAdvance,
    toggleDetails,
    moveSelection,
    selectedScenarioIndex,
    selectScenario,
    setDiffMode,
    saveStatus,
    retrySave
  } = useStore();

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

  /* Real controls, not keyboard hints: every verb is a button (pointer, touch,
     and switch access) with its shortcut shown as a secondary accelerator. */
  const verb = (label: string, kbd: string, onClick: () => void, disabled = false) => (
    <button className="verb verb-btn" onClick={onClick} disabled={disabled}>
      <span className="kbd" aria-hidden>{kbd}</span> {label}
    </button>
  );

  const saveChip =
    saveStatus === "idle" ? null : (
      <span className={`save-chip ${saveStatus}`} role="status">
        {saveStatus === "saving" && "Saving…"}
        {saveStatus === "saved" && "Saved"}
        {saveStatus === "error" && (
          <>
            Save failed
            <button className="save-retry" onClick={retrySave}>
              <RotateCcw size={10} aria-hidden /> Retry
            </button>
          </>
        )}
      </span>
    );

  return (
    <footer className="actionbar" role="contentinfo">
      <span className="machine-says">{machineSays}</span>
      {saveChip}
      <div className="verbs">
        {station === "review" && (
          <>
            {verb("Accept", "a", () => selectedView && setDecision(selectedView.key, "accept"), !selectedView)}
            {verb("Flag → Focus", "f", () => selectedView && setDecision(selectedView.key, "flag"), !selectedView)}
            {verb("Defer", "d", () => selectedView && setDecision(selectedView.key, "defer"), !selectedView)}
            {verb("Confirm + next", "e", () => confirmAndAdvance(), !selectedView)}
            {verb("Details", "space", () => toggleDetails())}
            {verb("Next", "j", () => moveSelection(1))}
            {verb("Prev", "k", () => moveSelection(-1))}
          </>
        )}
        {station === "evaluate" && (
          <span className="verb" title="Evaluate is a read-only summary. Grade cases in Review (2).">
            Read-only · grade in Review (2)
          </span>
        )}
        {station === "optimize" && (
          <>
            {verb("Prev scenario", "[", () => selectScenario(Math.max(0, selectedScenarioIndex - 1)))}
            {verb("Next scenario", "]", () => selectScenario(selectedScenarioIndex + 1))}
            <span className="verb">
              <span className="kbd">j</span>/<span className="kbd">k</span> Skill
            </span>
            <span className="verb">
              <span className="kbd">enter</span> → Decide
            </span>
          </>
        )}
        {station === "decide" && (
          <>
            {verb("Swipe", "x", () => setDiffMode("swipe"))}
            {verb("Blink", "X", () => setDiffMode("blink"))}
            {verb("Prev scenario", "[", () => selectScenario(Math.max(0, selectedScenarioIndex - 1)))}
            {verb("Next scenario", "]", () => selectScenario(selectedScenarioIndex + 1))}
          </>
        )}
      </div>
    </footer>
  );
}
