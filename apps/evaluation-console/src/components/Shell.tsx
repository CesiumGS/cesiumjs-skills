import type { ReactNode } from "react";
import { Command, HelpCircle, Moon, Sun, ChevronDown, RotateCcw } from "lucide-react";
import { useStore } from "../store";
import type { Station, ConsoleOverlay } from "../types";
import { pluralize } from "../lib/format";
import { liveRunTitle } from "./Live";

/* The five lifecycle steps every focused run travels, split across the two
   sections that own them: steps 1–2 judge a run (Evaluate), steps 3–5 improve
   and ship it (Optimize). The rail renders only the number and the name; the
   one-line description and the fuller hint ride along in the tooltip so a first
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
/* Steps 1–2 live under "Evaluate", steps 3–5 under "Optimize". */
const JUDGE_STEPS = LIFECYCLE_STATIONS.slice(0, 2);
const IMPROVE_STEPS = LIFECYCLE_STATIONS.slice(2);

export function TopStrip() {
  const { scorecard, config, theme, toggleTheme, openOverlay, counts, setStation, live, liveRunning } = useStore();
  const liveRun = liveRunning ? live?.active.find((r) => r.status === "running") : undefined;
  const pass = scorecard?.overallResult === "pass";
  const runLabel = scorecard?.gitCommit?.slice(0, 7) ?? scorecard?.runId?.slice(-12) ?? config?.run_id?.slice(-12);
  return (
    <header className="topstrip" role="banner">
      <div className="brand">
        <img className="brand-mark" src="/cesium-logomark.svg" alt="" aria-hidden />
        Skill Evaluation Console
      </div>

      {/* Global context stays compact here; verdict and provenance belong in
          the page content, where they have room to be understood. */}
      <button
        className="run-select"
        onClick={() => openOverlay("harness")}
        title={
          scorecard
            ? `Focused run: ${scorecard.runId}\nEvery lifecycle station (1–5) reads this run.\n${counts.total} cases · commit ${scorecard.gitCommit?.slice(0, 7) ?? "?"}\nClick to browse and switch runs (h).`
            : "No run loaded. Click to browse runs (h)."
        }
      >
        {scorecard && <span className={`rs-dot ${pass ? "pass" : "fail"}`} aria-hidden />}
        <span className="rs-label">Run</span>
        <span className="mono rs-id">{runLabel ?? "Select"}</span>
        <ChevronDown size={12} aria-hidden className="rs-chev" />
      </button>

      <span className="spacer" />
      {liveRun && (
        <button
          className="live-pill"
          onClick={() => setStation("live")}
          title={`Eval run in progress: ${liveRunTitle(liveRun)}. Open Run Studies (7).`}
        >
          <span className="dot" aria-hidden />
          {liveRunTitle(liveRun)}
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
  const { station, setStation, needsYouCount, skills, live, liveRunning, openOverlay } = useStore();
  const loopRunning = liveRunning || skills.some((s) => s.running);
  const stalledCount = (live?.active ?? []).filter((r) => r.status !== "running").length;
  const decidable = skills.filter((s) => s.latest?.decision === "KEEP").length;
  const stagedCount = skills.filter((s) => s.latest?.decision === "KEEP" && s.latest?.promotion === "staged").length;

  /* Badges carry information, never decoration: each one answers "how many
     things wait for me here?" or "is something running?" — and says which. */
  const badge = (id: Station): ReactNode => {
    if (id === "live")
      return liveRunning ? (
        <span className="nav-badge live" title="An eval run is executing right now">
          ●
        </span>
      ) : stalledCount > 0 ? (
        <span className="nav-badge" title={`${pluralize(stalledCount, "stalled run")} on disk; open to inspect`}>
          {stalledCount}
        </span>
      ) : null;
    if (id === "review")
      return needsYouCount ? (
        <span className="nav-badge hot" title={`${pluralize(needsYouCount, "case")} in this run need your eyes`}>
          {needsYouCount}
        </span>
      ) : null;
    if (id === "optimize")
      return loopRunning ? (
        <span className="nav-badge live" title="An optimization loop is running right now">
          ●
        </span>
      ) : null;
    if (id === "decide")
      return decidable ? (
        <span className="nav-badge" title={`${pluralize(decidable, "skill")} with a KEEP candidate awaiting your verification`}>
          {decidable}
        </span>
      ) : null;
    if (id === "promote")
      return stagedCount ? (
        <span className="nav-badge hot" title={`${pluralize(stagedCount, "staged candidate")} awaiting your promotion approval`}>
          {stagedCount}
        </span>
      ) : null;
    return null;
  };

  /* One row shape for everything in the rail: a numbered gutter, a label, and
     an optional badge. Stations and overlays look identical because to the eye
     they are the same act — "take me there". */
  const row = (
    key: string,
    opts: {
      num?: string;
      label: string;
      hint: string;
      kbd: string;
      active?: boolean;
      badge?: ReactNode;
      onClick: () => void;
    }
  ) => (
    <button
      key={key}
      className={`nav-row${opts.active ? " active" : ""}`}
      onClick={opts.onClick}
      aria-current={opts.active ? "page" : undefined}
      title={`${opts.hint}\nShortcut: ${opts.kbd}`}
    >
      <span className="nav-num" aria-hidden>
        {opts.num ?? ""}
      </span>
      <span className="nav-label">{opts.label}</span>
      {opts.badge}
    </button>
  );

  const stationRow = (id: Station, label: string, hint: string, kbd: string, num?: string) =>
    row(id, { num, label, hint, kbd, active: station === id, badge: badge(id), onClick: () => setStation(id) });

  const step = (st: (typeof LIFECYCLE_STATIONS)[number]) =>
    stationRow(st.id, st.name, `${st.name} — ${st.desc}. ${st.hint}`, st.num, st.num);

  const overlayRow = (kind: Exclude<ConsoleOverlay, null>, label: string, hint: string, kbd: string) =>
    row(kind, { label, hint, kbd, onClick: () => openOverlay(kind) });

  return (
    <nav className="rail col" role="navigation" aria-label="Console navigation">
      {/* ── Monitor: the screens that are NOT scoped to one focused run. ── */}
      <div className="rail-section">Monitor</div>
      {stationRow(
        "dashboard",
        "Dashboard",
        "Cross-study overview: recent runs, skill health, and what needs your attention. The one screen not scoped to a single run.",
        "0"
      )}
      {stationRow(
        "live",
        "Run Studies",
        "Your hands on the eval CLI: configure and kick off a new study, then watch its phases, trials, and journal live.",
        "7"
      )}

      {/* ── Evaluate: judge the focused run (steps 1–2). The top-strip run
            selector reaches the Run Browser; Optimize (step 3) is one row
            down, so a separate handoff button here would just duplicate it. ── */}
      <div className="rail-section">Evaluate</div>
      {JUDGE_STEPS.map(step)}

      {/* ── Optimize: improve and ship the run you just judged (steps 3–5). ── */}
      <div className="rail-section">Optimize</div>
      {IMPROVE_STEPS.map(step)}

      {/* ── Analyze: cross-run lenses. Auditing models and harnesses is not a
            step in shipping one run, so it sits beside the lifecycle. ── */}
      <div className="rail-section">Analyze</div>
      {stationRow(
        "models",
        "Models",
        "The model as the unit of analysis: declared catalogs and cost tiers beside observed keep and win rates from the artifacts on disk.",
        "6"
      )}
      {stationRow(
        "harnesses",
        "Harnesses",
        "The harness as the unit of analysis: registry capability cards beside run-level scorecard outcomes per harness.",
        "8"
      )}
      {overlayRow("matrix", "Matrix", "Skill × category matrix: where each skill is strong or weak across the scoring categories.", "m")}
      {overlayRow("trends", "Trends", "Win-rate trends: how each skill's keep and win rates have moved across optimization rounds.", "t")}

      <div className="rail-foot">
        <button className="rail-foot-btn" onClick={() => openOverlay("help")} title="Every keyboard shortcut in the console.">
          Press <span className="kbd">?</span> for shortcuts
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
