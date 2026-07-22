import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Rocket,
  Terminal,
  XCircle
} from "lucide-react";
import { useStore } from "../store";
import { loadLaunchSkills } from "../api";
import type { LivePhase, LiveRun, LiveTrial } from "../types";
import { fmtDuration, pluralize, relativeTime, skillLabel } from "../lib/format";

/* ============================================================================
   LIVE — the in-progress monitor for eval runs executing on this machine NOW.

   The optimization loop journals every phase boundary and drops per-trial
   artifacts as they complete; the store polls /api/live (2.5s while running)
   and this station renders that disk truth:
     1. Hero progress card per active run — animated weighted progress bar,
        current phase, elapsed wall clock.
     2. Phase pipeline — the loop's phases 1:1, with real trial counts on the
        phases that produce countable artifacts (codegen / render / judges).
     3. Trial board — every scenario's artifact stage, flipping as files land.
     4. Journal tail — the loop's own last words, verbatim.
   Honesty law: progress only advances on artifacts and terminal events; a
   phase with nothing countable pulses instead of pretending a percentage.
   ============================================================================ */

type TrialStage = "queued" | "inflight" | "coded" | "rendered" | "judged" | "skipped";

/** Artifact-truth stage for one trial. */
function trialStage(t: LiveTrial): TrialStage {
  if (!t.runnable) return "skipped";
  if (t.judged) return "judged";
  if (t.render_done) return "rendered";
  if (t.codegen_done) return "coded";
  return "queued";
}

const STAGE_WORD: Record<TrialStage, string> = {
  queued: "queued",
  inflight: "in flight",
  coded: "code ready",
  rendered: "rendered",
  judged: "judged",
  skipped: "review-only"
};

// Audit cases skip codegen (evidence is pre-rendered): queued -> scored -> judged.
const AUDIT_STAGE_WORD: Record<TrialStage, string> = {
  queued: "queued",
  inflight: "in flight",
  coded: "queued",
  rendered: "scored",
  judged: "judged",
  skipped: "—"
};

/** Human title for any live row: audits carry a label, loop rows derive from skill. */
export function liveRunTitle(run: LiveRun): string {
  return run.label || skillLabel(run.skill);
}

/** The queue head: the first runnable trial the active countable phase hasn't finished. */
function inflightScenario(run: LiveRun): string | null {
  const phase = run.current_phase;
  if (phase === "skills_adapter" || phase === "baseline_generation") {
    return run.trials.find((t) => !t.codegen_done)?.scenario_id ?? null;
  }
  if (phase === "browser_runner" || phase === "baseline_browser_eval" || phase === "score") {
    return run.trials.find((t) => t.runnable && !t.render_done)?.scenario_id ?? null;
  }
  if (phase === "judges" || phase === "judge") {
    return run.trials.find((t) => t.runnable && !t.judged)?.scenario_id ?? null;
  }
  return null;
}

function PhaseChip({ phase, running }: { phase: LivePhase; running: boolean }) {
  const countable = phase.trials_total !== null && phase.trials_total !== undefined;
  const count =
    countable && (phase.state === "active" || phase.state === "done" || phase.state === "failed")
      ? `${phase.trials_done}/${phase.trials_total}`
      : null;
  return (
    <div className={`lp-phase ${phase.state}${running && phase.state === "active" ? " pulsing" : ""}`} title={phase.label}>
      <span className="lp-phase-dot" aria-hidden>
        {phase.state === "done" && <CheckCircle2 size={12} />}
        {phase.state === "failed" && <XCircle size={12} />}
      </span>
      <span className="lp-phase-name">{phase.label}</span>
      {count && <span className="lp-phase-count mono">{count}</span>}
    </div>
  );
}

export function LiveProgressBar({ run, slim }: { run: LiveRun; slim?: boolean }) {
  const pct = Math.round(run.progress * 100);
  const running = run.status === "running";
  return (
    <div
      className={`live-progress${slim ? " slim" : ""}${running ? " running" : " stalled"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Eval run progress ${pct}%`}
    >
      <div className="live-progress-fill" style={{ width: `${Math.max(pct, 2)}%` }} />
    </div>
  );
}

function TrialBoard({ run }: { run: LiveRun }) {
  const inflight = run.status === "running" ? inflightScenario(run) : null;
  const words = run.kind === "audit" ? AUDIT_STAGE_WORD : STAGE_WORD;
  if (run.trials.length === 0) {
    return (
      <div className="empty-note">
        {run.kind === "audit"
          ? "Waiting for the first journal event to list the cases…"
          : "No scenario manifests found for this skill."}
      </div>
    );
  }
  return (
    <div className="lt-grid">
      {run.trials.map((t) => {
        const stage = t.scenario_id === inflight ? "inflight" : trialStage(t);
        return (
          <div key={t.scenario_id} className={`lt-chip ${stage}`} title={`${t.scenario_id} · ${t.label} — ${words[stage]}`}>
            <span className="lt-dot" aria-hidden />
            <span className="lt-id mono">{t.scenario_id.replace(/eval-/, "")}</span>
            {t.label && <span className="lt-label">{t.label}</span>}
            <span className="lt-stage">{words[stage]}</span>
          </div>
        );
      })}
    </div>
  );
}

function JournalTail({ run }: { run: LiveRun }) {
  const tail = run.journal_tail.slice(-8);
  return (
    <div className="lp-journal">
      {tail.map((e, i) => {
        const failed = String(e.event ?? "").includes("failed");
        return (
          <div key={i} className={`journal-line${failed ? " fail" : ""}`}>
            <span>{String(e.timestamp_utc ?? "").slice(11, 19)}</span>
            <span className="jl-ev">{String(e.event ?? "")}</span>
            {typeof e.step === "string" && e.step && <span>{e.step}</span>}
          </div>
        );
      })}
      {run.status === "running" && (
        <div className="journal-line lp-cursor">
          <span className="jl-ev">▮</span>
        </div>
      )}
    </div>
  );
}

function LiveRunCard({ run }: { run: LiveRun }) {
  const { selectSkill, setStation } = useStore();
  const running = run.status === "running";
  const pct = Math.round(run.progress * 100);
  const isAudit = run.kind === "audit";
  const doneTrials = isAudit
    ? run.trials.filter((t) => (run.judge ? t.judged : t.render_done)).length
    : run.kind === "baseline"
      ? run.trials.filter((t) => t.runnable && t.render_done).length
      : run.trials.filter((t) => t.runnable && t.judged).length;
  const runnable = run.trials.filter((t) => t.runnable).length;
  const failedPhase = run.phases.find((p) => p.state === "failed");
  const doneWord = isAudit
    ? run.judge
      ? "cases judged"
      : "cases scored"
    : run.kind === "baseline"
      ? "trials rendered"
      : "trials judged";

  return (
    <div className={`dash-card live-run-card${running ? " running" : ""}`}>
      <div className="lrc-head">
        <span className={`lrc-dot${running ? " on" : ""}`} aria-hidden />
        <span className="lrc-skill">{liveRunTitle(run)}</span>
        <span className="lrc-iter mono">
          {isAudit
            ? run.judge
              ? "checks + visual review"
              : "checks only"
            : run.kind === "baseline"
              ? "baseline prep"
              : `iteration ${run.iteration}`}
        </span>
        {running ? (
          <span className="lrc-status running">RUNNING</span>
        ) : (
          <span className="lrc-status stalled" title={`No journal events or artifact writes recently. Last activity ${relativeTime(run.last_activity_utc ?? "")}.`}>
            <AlertTriangle size={11} aria-hidden /> STALLED
          </span>
        )}
        <span className="spacer" />
        <span className="lrc-meta" title="Wall clock since the run's first journal event.">
          <Clock size={11} aria-hidden /> {fmtDuration(run.elapsed_s)}
        </span>
        {isAudit ? (
          <button
            className="pill link-pill"
            onClick={() => setStation("dashboard")}
            title="The finished scorecard lands in Recent Runs on the Dashboard (0)"
          >
            Dashboard <ArrowRight size={11} aria-hidden />
          </button>
        ) : (
          <button
            className="pill link-pill"
            onClick={() => {
              if (run.kind === "iteration") selectSkill(run.skill);
              setStation("optimize");
            }}
            title="Open this skill's iteration log and pipeline in Optimize (3)"
          >
            Optimize <ArrowRight size={11} aria-hidden />
          </button>
        )}
      </div>

      <div className="lrc-bar-row">
        <LiveProgressBar run={run} />
        <span className="lrc-pct mono">{pct}%</span>
      </div>
      <div className="lrc-bar-sub">
        <span>
          Phase {run.phase_index}/{run.phase_total}
          {run.current_phase_label ? ` · ${run.current_phase_label}` : ""}
          {failedPhase ? ` · ${failedPhase.label} failed` : ""}
        </span>
        <span className="spacer" />
        <span className="mono">
          {doneTrials}/{isAudit ? run.trials.length : runnable} {doneWord}
        </span>
      </div>

      <div className="lp-phases">
        {run.phases.map((p) => (
          <PhaseChip key={p.id} phase={p} running={running} />
        ))}
      </div>

      <div className="lrc-columns">
        <div>
          <div className="lrc-col-head">{pluralize(run.trials.length, isAudit ? "Case" : "Trial")}</div>
          <TrialBoard run={run} />
        </div>
        <div>
          <div className="lrc-col-head">
            <Terminal size={11} aria-hidden /> Journal
          </div>
          <JournalTail run={run} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   LAUNCHER: start a combined baseline audit from the console. The server
   spawns the detached pipeline process; progress streams back through the
   run's JSONL journal — the exact contract a CI wrapper would tail. Visual
   judging defaults ON: a run without it produces a deterministic-only
   (Mode B) scorecard, and the panel says so before you launch one.
   --------------------------------------------------------------------------- */
function LaunchPanel() {
  const { launchEvalRun, liveRunning } = useStore();
  const [available, setAvailable] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // empty = all
  const [judge, setJudge] = useState(true);
  const [adapter, setAdapter] = useState<"opencode" | "codex">("opencode");
  const [nJudges, setNJudges] = useState(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    loadLaunchSkills()
      .then((r) => {
        if (!disposed) setAvailable(r.skills);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const toggleSkill = (s: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const allSelected = picked.size === 0;
  const selectedCount = allSelected ? available.length : picked.size;

  const launch = async () => {
    setBusy(true);
    try {
      await launchEvalRun({
        kind: "audit",
        skills: allSelected ? undefined : [...picked],
        judge,
        adapter,
        n_judges: nJudges
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-card launch-panel">
      <div className="section-title">
        <Rocket size={13} aria-hidden /> Launch an Eval Run
        <span className="section-sub">
          Combined baseline audit: deterministic checks{judge ? " + visual judge panel" : " only"} over the archived
          baselines. Progress streams below as it runs.
        </span>
      </div>

      <div className="launch-grid">
        <div className="launch-field">
          <div className="launch-label">Skills</div>
          <div className="launch-skills">
            <button
              className={`lk-chip${allSelected ? " on" : ""}`}
              onClick={() => setPicked(new Set())}
              title="Audit every skill with archived baselines"
            >
              All ({available.length})
            </button>
            {available.map((s) => (
              <button
                key={s}
                className={`lk-chip${!allSelected && picked.has(s) ? " on" : ""}`}
                onClick={() => toggleSkill(s)}
                title={skillLabel(s)}
              >
                {s.replace(/^cesiumjs-/, "")}
              </button>
            ))}
          </div>
        </div>

        <div className="launch-field">
          <div className="launch-label">Visual judging</div>
          <button
            className={`judge-toggle${judge ? " on" : ""}`}
            role="switch"
            aria-checked={judge}
            onClick={() => setJudge((j) => !j)}
            title={
              judge
                ? "A judge panel reviews every rendered screenshot (recommended)."
                : "Automated checks only — nobody will look at the rendered screenshots."
            }
          >
            <span className="jt-track" aria-hidden>
              <span className="jt-knob" />
            </span>
            {judge ? (
              <>
                <Eye size={12} aria-hidden /> On — screenshots reviewed
              </>
            ) : (
              <>
                <EyeOff size={12} aria-hidden /> Off — checks only
              </>
            )}
          </button>
          {!judge && (
            <div className="launch-warn">
              <AlertTriangle size={11} aria-hidden /> The scorecard will say nothing about how the renders actually
              look — automated checks only.
            </div>
          )}
        </div>

        <div className="launch-field">
          <div className="launch-label">Judges</div>
          <div className="launch-steppers">
            {[1, 3, 5].map((n) => (
              <button
                key={n}
                className={`lk-chip${nJudges === n ? " on" : ""}`}
                disabled={!judge}
                onClick={() => setNJudges(n)}
                title={`${n}-judge panel`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="launch-field">
          <div className="launch-label">Judge adapter</div>
          <div className="launch-steppers">
            {(["opencode", "codex"] as const).map((a) => (
              <button
                key={a}
                className={`lk-chip${adapter === a ? " on" : ""}`}
                disabled={!judge}
                onClick={() => setAdapter(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="launch-field launch-go">
          <button className="launch-btn" onClick={() => void launch()} disabled={busy || selectedCount === 0}>
            <Rocket size={13} aria-hidden />
            {busy ? "Launching…" : `Launch audit · ${selectedCount} ${selectedCount === 1 ? "skill" : "skills"}`}
          </button>
          {liveRunning && <div className="launch-note">A run is already in progress — parallel runs are fine.</div>}
        </div>
      </div>
    </div>
  );
}

function LiveEmptyState() {
  return (
    <div className="dash-card live-empty">
      <div className="le-icon" aria-hidden>
        <Activity size={22} />
      </div>
      <div className="le-title">No eval run in progress</div>
      <div className="le-sub">
        Launch a baseline audit above, or start the optimization loop from a terminal — either way every phase and
        case journals to disk and streams here within a few seconds.
      </div>
      <pre className="le-cmd mono">
        node packages/eval/bin/cesium-eval.js optimize all --skills cesiumjs-camera{"\n"}
        node packages/eval/bin/cesium-eval.js audit --skills all --journal &lt;dir&gt;/progress.jsonl
      </pre>
    </div>
  );
}

export function LiveStation() {
  const { live } = useStore();
  const runs = live?.active ?? [];
  const runningRuns = useMemo(() => runs.filter((r) => r.status === "running"), [runs]);
  const stalledRuns = useMemo(() => runs.filter((r) => r.status !== "running"), [runs]);

  return (
    <div className="overview dashboard-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Run Studies</div>
          <div className="dash-sub">
            Launch eval runs against the CLI and watch their real-time progress — phases, trials, and journal — straight
            from disk.
          </div>
        </div>
        <span className="spacer" />
        <span className={`fresh-chip${live ? "" : " stale"}`} title="Time of the latest /api/live poll.">
          {live ? `Polled ${relativeTime(live.generated_at)}` : "Waiting for first poll…"}
        </span>
      </div>

      {runningRuns.map((run) => (
        <LiveRunCard key={`${run.skill}/${run.iteration}`} run={run} />
      ))}

      {runningRuns.length === 0 && <LiveEmptyState />}

      <LaunchPanel />

      {stalledRuns.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: "var(--sp-4)" }}>
            Stalled on Disk
          </div>
          <div className="dash-sub" style={{ marginBottom: "var(--sp-3)" }}>
            Journals that started but reached no terminal event and have gone quiet — usually a loop that was
            interrupted. They resume here if their process picks back up.
          </div>
          {stalledRuns.map((run) => (
            <LiveRunCard key={`${run.skill}/${run.iteration}`} run={run} />
          ))}
        </>
      )}
    </div>
  );
}

/** Compact "happening now" strip for the Dashboard — visible only mid-run. */
export function LiveNowBanner() {
  const { live, setStation } = useStore();
  const run = live?.active.find((r) => r.status === "running");
  if (!run) return null;
  const pct = Math.round(run.progress * 100);
  return (
    <button className="live-now-banner" onClick={() => setStation("live")} title="Open Run Studies (7)">
      <span className="lrc-dot on" aria-hidden />
      <span className="lnb-label">
        Eval run in progress — <strong>{liveRunTitle(run)}</strong>
        <span className="mono">
          {" "}
          {run.kind === "audit" ? (run.judge ? "det + judge" : "det only") : run.kind === "baseline" ? "baseline" : run.iteration}
        </span>
        {run.current_phase_label ? ` · ${run.current_phase_label}` : ""}
      </span>
      <span className="lnb-bar">
        <LiveProgressBar run={run} slim />
      </span>
      <span className="mono lnb-pct">{pct}%</span>
      <span className="lnb-cta">
        Watch live <ArrowRight size={11} aria-hidden />
      </span>
    </button>
  );
}
