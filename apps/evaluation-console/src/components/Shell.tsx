import type { ReactNode } from "react";
import { Command, HelpCircle, Moon, Sun, Layers, ChevronDown, Eye, EyeOff, ArrowRight, RotateCcw } from "lucide-react";
import { useStore } from "../store";
import type { Station, ConsoleOverlay, AdaptedScorecard } from "../types";
import type { RunHealth } from "../lib/grade";
import { harnessLabel, pluralize, relativeTime } from "../lib/format";
import { healthFromScorecard, healthPct } from "../lib/grade";
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
    return { label: harnessLabel(harness), cls: "agent", hint: `Real agent output, generated with the ${harnessLabel(harness)} harness.` };
  return {
    label: "Origin Unknown",
    cls: "unknown",
    hint: "This run predates provenance stamping, so the producing harness can't be determined."
  };
}

/* The header pill's score decomposed. The pill shows one aggregate number so it
   can never contradict the verdict (the old "FAIL · Checks 100%"); this tooltip
   spells out how that number is built and, on a fail, which gate failed. */
function runScoreTooltip(sc: AdaptedScorecard, h: RunHealth, pass: boolean): string {
  if (h.aggregate === null) return "No score recorded for this run.";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const verdict = pass ? "PASS" : "FAIL";
  const head = `${verdict} · overall health ${healthPct(h.aggregate, pass)}%`;
  if (h.hasVisual && h.vis !== null && h.det !== null) {
    const why = pass
      ? "both gates passed"
      : sc.deterministicResult === "fail"
        ? "the automated checks fell below the pass threshold"
        : "the visual review gate did not pass";
    return (
      `${head}\n` +
      `Both gates weigh equally: automated checks ${pct(h.det)} and visual review ${pct(h.vis)} ` +
      `(${h.passCount} of ${h.reviewedCount} judged cases passed).\n` +
      `The run ${pass ? "passes" : "fails"} because ${why}.`
    );
  }
  return `${head}\nAutomated checks only — no visual review was supplied for this run.`;
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
  const health = scorecard ? healthFromScorecard(scorecard) : null;
  const aggPct = health && health.aggregate !== null ? healthPct(health.aggregate, pass) : null;
  const scoreTooltip = scorecard && health ? runScoreTooltip(scorecard, health, pass) : "";
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
          {aggPct !== null && (
            <span className={`rs-score mono ${pass ? "pass" : "fail"}`} title={scoreTooltip}>
              {pass ? "PASS" : "FAIL"} · {aggPct}%
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
      {overlayRow("harness", "Run Browser", "Browse every run on disk; switch the focused run or set the comparison baseline.", "h")}

      {/* ── Evaluate: judge the focused run (steps 1–2), then hand the
            confirmed focus—or suggested fallback—across to the optimizer. ── */}
      <div className="rail-section">Evaluate</div>
      {JUDGE_STEPS.map(step)}
      <button
        className={`rail-handoff${flagged || suggestedFlagCount ? " ready" : ""}`}
        onClick={doExport}
        disabled={!flagged && !suggestedFlagCount}
        title={
          flagged
            ? `Write your ${pluralize(flagged, "confirmed flag")} to the focus set and open Optimize.`
            : suggestedFlagCount
              ? `Use ${pluralize(suggestedFlagCount, "machine-suggested flag")} as the focus set and open Optimize.`
              : "Flag failing cases in Review to create an optimization focus set."
        }
      >
        <span className="rh-label">
          {flagged
            ? `Optimize ${flagged} confirmed`
            : suggestedFlagCount
              ? `Optimize ${suggestedFlagCount} suggested`
              : "Nothing flagged yet"}
        </span>
        <ArrowRight size={13} aria-hidden className="rh-go" />
      </button>

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
