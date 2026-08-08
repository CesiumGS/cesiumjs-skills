import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Rocket,
  Terminal,
  XCircle
} from "lucide-react";
import { useStore } from "../store";
import {
  adapterAction,
  loadAdapter,
  loadBaselineCoverage,
  loadHarnessHealth,
  loadLaunchSkills,
  probeHarness,
  prepareBaselines
} from "../api";
import type {
  AdapterStatusDTO,
  BaselineCoverageDTO,
  HarnessHealthRow,
  HarnessSpec,
  LivePhase,
  LiveRun,
  LiveTrial,
  ProbeResultDTO
} from "../types";
import { summarizeBaselineCoverage } from "../lib/baselineCoverage";
import { fmtDuration, harnessLabel, modelShort, pluralize, relativeTime, skillLabel, titleCase } from "../lib/format";

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
  queued: "Queued",
  inflight: "In Flight",
  coded: "Code Ready",
  rendered: "Rendered",
  judged: "Visual Tested",
  skipped: "Review-Only"
};

// Audit cases skip codegen (evidence is pre-rendered): queued -> scored -> judged.
const AUDIT_STAGE_WORD: Record<TrialStage, string> = {
  queued: "Queued",
  inflight: "In Flight",
  coded: "Queued",
  rendered: "Code Tested",
  judged: "Visual Tested",
  skipped: "—"
};

/** Human title for any live row: audits carry a label, loop rows derive from skill. */
export function liveRunTitle(run: LiveRun): string {
  if (run.kind === "audit" && run.skill && run.skill !== "baseline-audit") {
    return `Audit \u00b7 ${skillLabel(run.skill)}`;
  }
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

/** Shared journal-derived phase animation. Run and Optimize use the same
 * geometry while receiving only the lane-specific rows their pages own. */
export function LivePhasePipeline({ run }: { run: LiveRun }) {
  const running = run.status === "running";
  return (
    <div className="lp-phases">
      {run.phases.map((phase) => (
        <PhaseChip key={phase.id} phase={phase} running={running} />
      ))}
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
  // Journal-truth parallelism first (audit judge lane emits per-case start
  // events); fall back to the head-of-queue heuristic for loop runs.
  const journalInflight = run.trials.some((t) => t.inflight);
  const fallback = run.status === "running" && !journalInflight ? inflightScenario(run) : null;
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
  // Multi-skill audits get the grouped lane board — one row per skill, one
  // cell per case — instead of a wall of repetitive chips.
  const groups = new Set(run.trials.map((t) => t.group ?? ""));
  if (run.kind === "audit" && groups.size > 1) return <LaneBoard run={run} fallback={fallback} />;
  return (
    <div className="lt-grid">
      {run.trials.map((t) => {
        const stage = t.inflight || t.scenario_id === fallback ? "inflight" : trialStage(t);
        return (
          <div key={t.scenario_id} className={`lt-chip ${stage}`} title={`${t.scenario_id} · ${t.label} · ${words[stage]}`}>
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

// Verdict → color channel. Fail and Needs Review also carry a glyph (shape,
// not just hue), keeping the "color is never the sole signal" law at 13px.
const VERDICT_TONE: Record<string, string> = { pass: "v-pass", fail: "v-fail", needs_review: "v-review" };

/** One lane per skill: name, judged count, and a cell strip — every case is a
 *  13px cell that flips color as the journal lands its events. Parallel work
 *  reads as several pulsing cells at once. */
function LaneBoard({ run, fallback }: { run: LiveRun; fallback: string | null }) {
  const words = AUDIT_STAGE_WORD;
  const lanes = useMemo(() => {
    const byGroup = new Map<string, LiveTrial[]>();
    for (const t of run.trials) {
      const g = t.group ?? "cases";
      const rows = byGroup.get(g);
      if (rows) rows.push(t);
      else byGroup.set(g, [t]);
    }
    return [...byGroup.entries()];
  }, [run.trials]);
  const inflightRows = run.trials.filter((t) => t.inflight);
  const judgeRun = run.judge !== false;
  return (
    <div className="lane-board">
      {lanes.map(([group, rows]) => {
        const done = rows.filter((t) => (judgeRun ? t.judged : t.render_done)).length;
        return (
          <div key={group} className="lane">
            <span className="lane-name">{skillLabel(group)}</span>
            <span className="lane-count mono">
              {done}/{rows.length}
            </span>
            <div className="lane-track">
              {rows.map((t) => {
                const stage = t.inflight || t.scenario_id === fallback ? "inflight" : trialStage(t);
                const tone = stage === "judged" && t.verdict ? (VERDICT_TONE[t.verdict] ?? "") : "";
                const verdictWord = stage === "judged" && t.verdict ? ` — ${titleCase(t.verdict)}` : "";
                return (
                  <span
                    key={t.scenario_id}
                    className={`lane-cell ${stage}${tone ? ` ${tone}` : ""}`}
                    title={`${t.scenario_id} · ${words[stage]}${verdictWord}`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {inflightRows.length > 0 && (
        <div className="lane-inflight">
          <span className="lrc-dot on" aria-hidden />
          Now Judging
          {inflightRows
            .slice()
            .sort((a, b) => (a.worker ?? 0) - (b.worker ?? 0))
            .map((t) => (
              <span key={t.scenario_id} className="lane-inflight-item mono">
                {typeof t.worker === "number" && <span className="lt-worker">W{t.worker}</span>}
                {t.scenario_id}
              </span>
            ))}
        </div>
      )}
      <div className="lane-legend" aria-hidden>
        <span>
          <i className="lane-cell queued" /> Queued
        </span>
        <span>
          <i className="lane-cell inflight" /> In Flight
        </span>
        {judgeRun ? (
          <>
            <span>
              <i className="lane-cell judged v-pass" /> Pass
            </span>
            <span>
              <i className="lane-cell judged v-fail" /> Fail
            </span>
            <span>
              <i className="lane-cell judged v-review" /> Needs Review
            </span>
          </>
        ) : (
          <span>
            <i className="lane-cell rendered" /> Scored
          </span>
        )}
      </div>
    </div>
  );
}

/** One row per judge worker, showing the case it holds right now (or Idle).
 *  This is the "which worker is doing what" view the operator asked for; it
 *  only appears for audits whose judge lane runs more than one case at once. */
function WorkerLanes({ run }: { run: LiveRun }) {
  const concurrency = run.concurrency ?? 1;
  if (run.kind !== "audit" || run.judge === false || concurrency <= 1) return null;
  const current = new Map<number, LiveTrial>();
  for (const t of run.trials) {
    if (t.inflight && typeof t.worker === "number") current.set(t.worker, t);
  }
  const lanes = Array.from({ length: concurrency }, (_v, i) => i + 1);
  const busy = current.size;
  return (
    <div className="worker-lanes">
      <div className="worker-lanes-head">
        <Cpu size={11} aria-hidden /> Workers
        <span className="spacer" />
        <span className="mono">
          {busy}/{concurrency} busy
        </span>
      </div>
      <div className="worker-lane-grid">
        {lanes.map((id) => {
          const t = current.get(id);
          return (
            <div key={id} className={`worker-lane${t ? " busy" : ""}`}>
              <span className="wl-id mono">W{id}</span>
              {t ? (
                <span className="wl-case mono" title={t.scenario_id}>
                  {t.group ? `${skillLabel(t.group)} \u00b7 ` : ""}
                  {t.case_id ?? t.scenario_id}
                </span>
              ) : (
                <span className="wl-idle">Idle</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "cesiumjs-camera" + "eval-108" → "camera·eval-108" for journal prose. */
function journalCaseRef(e: Record<string, unknown>): string {
  const skill = String(e.skill ?? "").replace(/^cesiumjs-/, "");
  const caseId = String(e.case_id ?? "");
  if (skill && caseId) return `${skill}\u00b7${caseId}`;
  return caseId || skill;
}

/** "W3 " when the event carries a worker id, else "" — so the journal can say
 *  exactly which worker is doing what. */
function workerTag(e: Record<string, unknown>): string {
  const w = e.worker_id;
  return typeof w === "number" && w > 0 ? `W${w} ` : "";
}

/** Compact human duration from a millisecond count: "820ms", "2.1s", "1m 4s". */
function durationText(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n % 60_000) / 1000);
  return `${m}m ${s}s`;
}

type JournalTone = "plain" | "eye" | "machine" | "pass" | "fail";

/** Translate a raw journal event into a human sentence + provenance tone.
 *  The raw event name stays on the row's title attribute — honesty preserved,
 *  prose displayed. */
function describeJournalEvent(e: Record<string, unknown>): { text: string; tone: JournalTone } {
  const name = String(e.event ?? "");
  switch (name) {
    case "launch_accepted":
      return { text: "Launch accepted — waiting for the audit process", tone: "plain" };
    case "audit_started": {
      const skills = Array.isArray(e.skills) ? e.skills.length : null;
      return {
        text: `Audit started — ${skills !== null ? pluralize(skills, "skill") : "skills TBD"}, ${pluralize(Number(e.case_count ?? 0), "case")}`,
        tone: "plain"
      };
    }
    case "judge_started": {
      const par = Number(e.concurrency ?? 1);
      return {
        text: `Visual Tests started — ${pluralize(Number(e.total ?? 0), "case")}, ${e.n_judges} AI reviewers${par > 1 ? ` · ${par} cases in parallel` : ""}`,
        tone: "eye"
      };
    }
    case "judge_case_started":
      return { text: `${workerTag(e)}visually testing ${journalCaseRef(e)}…`, tone: "eye" };
    case "judge_case_completed": {
      const status = typeof e.status === "string" && e.status ? titleCase(e.status) : "Done";
      const dur = durationText(e.duration_ms);
      return {
        text: `${workerTag(e)}${journalCaseRef(e)} visually tested — ${status} (${e.index}/${e.total})${dur ? ` · ${dur}` : ""}`,
        tone: e.status === "fail" ? "fail" : "eye"
      };
    }
    case "judge_completed":
      return { text: `Visual Tests complete — ${e.judged_count}/${e.total} tested`, tone: "eye" };
    case "scoring_started":
      return { text: `Code Tests started — ${pluralize(Number(e.total ?? 0), "case")}`, tone: "machine" };
    case "scoring_case_completed":
      return {
        text: `${journalCaseRef(e)} code-tested — ${titleCase(String(e.result ?? ""))} (${e.index}/${e.total})`,
        tone: e.result === "fail" ? "fail" : "machine"
      };
    case "scoring_completed":
      return { text: "Code Tests complete", tone: "machine" };
    case "scorecard_written":
      return {
        text: `Scorecard written — ${titleCase(String(e.overall_result ?? "done"))}`,
        tone: e.overall_result === "pass" ? "pass" : "plain"
      };
    case "audit_completed": {
      // "incomplete" = deterministic passed but Visual Tests never ran (no
      // baseline screenshots). Neither green pass nor red fail: call it out.
      const outcome = String(e.overall_result ?? "done");
      const detail =
        outcome === "incomplete" ? " — Visual Tests did not run (no baseline screenshots)" : "";
      return {
        text: `Audit complete — ${titleCase(outcome)}${detail}`,
        tone: outcome === "pass" ? "pass" : outcome === "incomplete" ? "eye" : "fail"
      };
    }
    case "audit_failed":
      return { text: `Audit failed — ${String(e.error ?? "unknown error")}`, tone: "fail" };
    default: {
      // Loop-run events ("step_started" + step field) and anything new.
      const step = typeof e.step === "string" && e.step ? ` — ${titleCase(e.step)}` : "";
      return {
        text: `${titleCase(name.replace(/_/g, " "))}${step}`,
        tone: name.includes("failed") ? "fail" : "plain"
      };
    }
  }
}

function JournalTail({ run }: { run: LiveRun }) {
  const tail = run.journal_tail.slice(-14);
  // Live tail: pin to the newest line as events stream in (only when already
  // near the bottom, so an operator scrolling back to read isn't yanked away).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastEventKey = String(run.last_event?.timestamp_utc ?? "") + String(run.last_event?.event ?? "");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lastEventKey, tail.length]);
  return (
    <div className="lp-journal" ref={scrollRef}>
      {tail.map((e, i) => {
        const described = describeJournalEvent(e);
        return (
          <div key={i} className={`journal-line jt-${described.tone}`} title={String(e.event ?? "")}>
            <span>{String(e.timestamp_utc ?? "").slice(11, 19)}</span>
            <span className="jl-dot" aria-hidden />
            <span className="jl-ev">{described.text}</span>
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
  const { selectSkill, setStation, cancelLiveRun } = useStore();
  const running = run.status === "running";
  const failed = run.status === "failed";
  // A launch that died before its first journal event has no progress to
  // report. Rendering the bar, the phase train and an empty case board for it
  // would dress up "nothing happened" as "0% done"; the card collapses to the
  // only facts on disk — what was launched and what it said on the way out.
  const stillborn = failed && run.trials.length === 0 && run.journal_tail.length === 0;
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
      ? "cases visually tested"
      : "cases code-tested"
    : run.kind === "baseline"
      ? "trials rendered"
      : "trials visually tested";

  return (
    <div className={`dash-card live-run-card${running ? " running" : ""}${failed ? " failed" : ""}`}>
      <div className="lrc-head">
        <span className={`lrc-dot${running ? " on" : ""}`} aria-hidden />
        <span className="lrc-skill">{liveRunTitle(run)}</span>
        <span className="lrc-iter mono">
          {isAudit
            ? run.judge
              ? "Code + Visual"
              : "Code Only"
            : run.kind === "baseline"
              ? "Baseline Prep"
              : `Iteration ${run.iteration}`}
        </span>
        {running ? (
          <span className="lrc-status running">RUNNING</span>
        ) : failed ? (
          <span className="lrc-status failed" title={run.error ?? "This launch failed before recording any data."}>
            <XCircle size={11} aria-hidden /> FAILED
          </span>
        ) : (
          <span className="lrc-status stalled" title={`No journal events or artifact writes recently. Last activity ${relativeTime(run.last_activity_utc ?? "")}.`}>
            <AlertTriangle size={11} aria-hidden /> STALLED
          </span>
        )}
        <span className="spacer" />
        {stillborn ? (
          <span className="lrc-meta" title="When this launch exited. It never ran, so it has no wall clock.">
            <Clock size={11} aria-hidden /> exited {relativeTime(run.last_activity_utc ?? run.started_utc ?? "")}
          </span>
        ) : (
          <span className="lrc-meta" title="Wall clock since the run's first journal event.">
            <Clock size={11} aria-hidden /> {fmtDuration(run.elapsed_s)}
          </span>
        )}
        {isAudit && run.launch_id && running && (
          <button
            className="pill cancel-pill"
            onClick={() => void cancelLiveRun(run.launch_id!)}
            title="Send SIGTERM to this run's process group. Artifacts written so far stay on disk."
          >
            <XCircle size={11} aria-hidden /> Cancel Run
          </button>
        )}
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
            title="Open this skill's iteration log and pipeline in Optimize (4)"
          >
            Optimize <ArrowRight size={11} aria-hidden />
          </button>
        )}
      </div>

      {failed && run.error && <div className="lrc-error">{run.error}</div>}

      {stillborn && (
        <div className="lrc-dead">
          {run.command ? (
            <div className="lrc-command mono" title="The invocation recorded in launch.json.">
              <Terminal size={11} aria-hidden /> {run.command}
            </div>
          ) : null}
          <div className="lrc-dead-note">
            No journal events and no cases: the process exited before the audit began, so there is nothing to score.
            Fix the cause above and launch again.
          </div>
        </div>
      )}

      {stillborn ? null : (
        <>
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

          <LivePhasePipeline run={run} />

          <div className="lrc-columns">
            <div>
              <div className="lrc-col-head">
                {pluralize(run.trials.length, isAudit ? "Case" : "Trial")}
                {(() => {
                  const groupCount = new Set(run.trials.map((t) => t.group ?? "")).size;
                  return isAudit && groupCount > 1 ? ` · ${groupCount} Skills` : "";
                })()}
                {isAudit && (run.concurrency ?? 1) > 1 ? (
                  <span className="lrc-concurrency mono" title={`Visual Tests run ${run.concurrency} cases in parallel`}>
                    {run.concurrency}× parallel
                  </span>
                ) : null}
              </div>
              <TrialBoard run={run} />
              <WorkerLanes run={run} />
            </div>
            <div>
              <div className="lrc-col-head">
                <Terminal size={11} aria-hidden /> Journal
              </div>
              <JournalTail run={run} />
            </div>
          </div>
        </>
      )}
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

// Reasoning-effort ("thinking") levels in canonical low→high order, as declared
// per model in the harness registry. Unknown ids sort last, verbatim.
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const EFFORT_LABEL: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max"
};
const effortLabel = (level: string) => EFFORT_LABEL[level] ?? titleCase(level);
const effortRank = (level: string) => {
  const i = EFFORT_ORDER.indexOf(level);
  return i === -1 ? EFFORT_ORDER.length : i;
};

/** Effort levels offered for a harness: the picked model's registry list, or
 *  the union across the harness's catalog when the model is still auto. */
function effortLevelsFor(spec: HarnessSpec | undefined, modelId: string): string[] {
  const model = modelId ? spec?.models.find((m) => m.id === modelId) : undefined;
  const raw = model?.effort_levels?.length
    ? model.effort_levels
    : [...new Set((spec?.models ?? []).flatMap((m) => m.effort_levels ?? []))];
  const levels = raw.length ? raw : ["low", "medium", "high", "xhigh", "max"];
  return [...levels].sort((a, b) => effortRank(a) - effortRank(b));
}

/* ---------------------------------------------------------------------------
   HARNESS HEALTH: every registry harness with its provider binding, live
   availability, and a binding probe. A probe asserts two INDEPENDENT things
   (registry probe_policy): capability — the harness really read a token file
   (tool use, not recall) — and attribution — which provider/model actually
   served the call, observed on the wire where the harness supports it.
   Probes are serialized server-side; rows disable while one runs.
   --------------------------------------------------------------------------- */

// Capability and attribution are independent assertions, and the UI keeps
// them apart: the verdict says whether the probe SUCCEEDED (green/red), and a
// separate neutral chip says how the provider identity is known. A harness
// whose CLI never reports its provider is not failing — that is a property of
// the harness, not of the run — so it must not render as a warning.
const PROBE_VERDICT_LABEL: Record<string, string> = {
  pass: "Pass",
  pass_provider_unverified: "Pass",
  fail_capability: "No tool use",
  attribution_mismatch: "Wrong provider",
  error: "Error"
};

const CREDENTIAL_ROUTE_LABEL: Record<string, string> = {
  api_key: "API key",
  oauth_subscription: "Subscription OAuth",
  codex_subscription: "Codex subscription",
  broker_subscription: "Broker subscription",
  cloud_iam: "Cloud IAM",
  local_none: "Local (no auth)"
};

const ATTRIBUTION_WIRE_HINT =
  "Verified: this harness reported which provider/model served the call in its own output during the probe.";
const ATTRIBUTION_REGISTRY_HINT =
  "This CLI's output does not say which provider served the call, so the identity shown is the registry's declared binding. The capability check passed either way.";

function probeVerdictTone(verdict: string): "pass" | "fail" {
  return verdict === "pass" || verdict === "pass_provider_unverified" ? "pass" : "fail";
}

function HarnessHealthPanel() {
  const [rows, setRows] = useState<HarnessHealthRow[]>([]);
  const [probing, setProbing] = useState<string | null>(null);
  const [probeAll, setProbeAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    loadHarnessHealth()
      .then((health) => setRows(health.harnesses))
      .catch((exc) => setError(String(exc?.message ?? exc)));

  useEffect(() => {
    refresh();
  }, []);

  const applyResult = (result: ProbeResultDTO) =>
    setRows((prev) => prev.map((row) => (row.id === result.harness ? { ...row, last_probe: result } : row)));

  const probeOne = async (id: string) => {
    setProbing(id);
    setError(null);
    try {
      applyResult(await probeHarness(id));
    } catch (exc: any) {
      setError(`${id}: ${String(exc?.message ?? exc)}`);
    } finally {
      setProbing(null);
    }
  };

  // Serialized on purpose (registry probe_policy): overlapping probes produced
  // false timeouts when this pipeline was designed.
  const probeEverything = async () => {
    setProbeAll(true);
    setError(null);
    try {
      for (const row of rows) {
        if (!row.available || !row.driver_registered) continue;
        setProbing(row.id);
        try {
          applyResult(await probeHarness(row.id));
        } catch (exc: any) {
          setError(`${row.id}: ${String(exc?.message ?? exc)}`);
        }
      }
    } finally {
      setProbing(null);
      setProbeAll(false);
    }
  };

  const busy = probing !== null || probeAll;

  return (
    <div className="dash-card launch-panel harness-health">
      <div className="section-title">
        <Activity size={13} aria-hidden /> Harness Health
        <span className="section-sub">
          Every registry harness with its provider binding and a live binding probe: capability (a real token-file
          read — tool use, not recall) plus wire-observed attribution of which provider/model actually served the
          call. Probes run one at a time.
        </span>
        <span className="spacer" />
        <button className="lk-chip" onClick={probeEverything} disabled={busy || !rows.length} title="Probe every available harness, serialized">
          {probeAll ? "Probing…" : "Probe all"}
        </button>
      </div>

      {error && (
        <div className="launch-warn">
          <AlertTriangle size={11} aria-hidden /> {error}
        </div>
      )}

      <div className="hh-rows" role="table" aria-label="Harness health">
        {rows.map((row) => {
          const probe = row.last_probe;
          const tone = probe ? probeVerdictTone(probe.verdict) : null;
          const isProbing = probing === row.id;
          return (
            <div key={row.id} className="hh-row" role="row">
              <div className="hh-cell hh-name" role="cell">
                <span className={`hh-dot${row.available ? " on" : ""}`} title={row.available ? "CLI resolved" : row.availability_error ?? "not installed"} />
                <span className="hh-title">{row.name}</span>
                {!row.driver_registered && (
                  <span className="hh-flag" title="Registry entry has no driver implementation">no driver</span>
                )}
              </div>
              <div className="hh-cell hh-binding" role="cell" title={row.auth ?? undefined}>
                <span className="hh-provider">{row.provider_label ?? row.provider ?? "—"}</span>
                {row.credential_route && (
                  <span className="hh-route">{CREDENTIAL_ROUTE_LABEL[row.credential_route] ?? row.credential_route}</span>
                )}
              </div>
              <div className="hh-cell hh-vision" role="cell" title={row.vision_note ?? undefined}>
                {row.multimodal ? <Eye size={12} aria-label="Vision-capable" /> : <EyeOff size={12} aria-label="Text-only" />}
              </div>
              <div className="hh-cell hh-probe" role="cell">
                {isProbing ? (
                  <span className="hh-verdict run">
                    <Clock size={11} aria-hidden /> Probing… (≤{Math.round((row.probe_timeout_ms ?? 240000) / 1000)}s)
                  </span>
                ) : probe ? (
                  <div className="hh-probe-stack">
                    <span className={`hh-verdict ${tone}`} title={probe.capability.error ?? undefined}>
                      {tone === "pass" ? <CheckCircle2 size={11} aria-hidden /> : <XCircle size={11} aria-hidden />}
                      {PROBE_VERDICT_LABEL[probe.verdict] ?? probe.verdict}
                      <span
                        className={`hh-att ${probe.attribution.observed ? "wire" : "reg"}`}
                        title={probe.attribution.observed ? ATTRIBUTION_WIRE_HINT : ATTRIBUTION_REGISTRY_HINT}
                      >
                        {probe.attribution.observed ? "verified live" : "per registry"}
                      </span>
                    </span>
                    <span
                      className="hh-probe-meta mono"
                      title={`${probe.attribution.provider.value ?? "?"}/${probe.attribution.model.value ?? "?"} · ${fmtDuration(probe.latency_ms / 1000)}`}
                    >
                      {probe.attribution.provider.value ?? "?"}/{probe.attribution.model.value ?? "?"} ·{" "}
                      {fmtDuration(probe.latency_ms / 1000)}
                    </span>
                  </div>
                ) : (
                  <span className="hh-verdict unknown">never probed</span>
                )}
              </div>
              <div className="hh-cell hh-actions" role="cell">
                <button
                  className="lk-chip"
                  onClick={() => probeOne(row.id)}
                  disabled={busy || !row.available || !row.driver_registered}
                  title={
                    row.available
                      ? `Probe ${row.name}: token-file capability + observed attribution`
                      : row.availability_error ?? "CLI not installed"
                  }
                >
                  {isProbing ? "…" : "Probe"}
                </button>
              </div>
            </div>
          );
        })}
        {!rows.length && !error && <div className="dash-sub">Loading harness registry…</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PROTOCOL ADAPTER: some harness × provider pairs speak different wire
   protocols (Claude Code speaks only anthropic-messages; Azure/Foundry serves
   none of it). The adapter (LiteLLM, pinned, run on demand) translates
   between them. Behind the adapter a harness believes it talks to its own
   first party, so the wire PROVIDER claim is meaningless — adapter probes
   verify on the MODEL id, which the proxy maps truthfully.
   --------------------------------------------------------------------------- */

function AdapterPanel() {
  const [state, setState] = useState<AdapterStatusDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Keyed BY TARGET: results accumulate so probing one target never clears
  // another's verdict (a single result slot silently blanked the other row).
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResultDTO>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    loadAdapter()
      .then(setState)
      .catch((exc) => setError(String(exc?.message ?? exc)));

  useEffect(() => {
    refresh();
  }, []);

  const lifecycle = async (action: "start" | "stop") => {
    setBusy(action);
    setError(null);
    try {
      setState(await adapterAction(action));
    } catch (exc: any) {
      setError(String(exc?.message ?? exc));
    } finally {
      setBusy(null);
    }
  };

  const probeVia = async (target: string) => {
    setBusy(`probe:${target}`);
    setError(null);
    try {
      // Claude Code is the base_url_override harness — the one the adapter
      // can redirect purely via env. Others need config-surface changes
      // (documented in the registry) and are not yet automated.
      const result = await probeHarness("claude-code", undefined, undefined, target);
      setProbeResults((prev) => ({ ...prev, [target]: result }));
    } catch (exc: any) {
      setError(String(exc?.message ?? exc));
    } finally {
      setBusy(null);
    }
  };

  if (!state) return null;

  const stateTone = state.running ? (state.healthy ? "pass" : "fail") : "unknown";
  const stateLabel = state.running ? (state.healthy ? `running · :${state.port}` : "running · unhealthy") : "stopped";

  return (
    <div className="dash-card launch-panel harness-health">
      <div className="section-title">
        <ArrowRight size={13} aria-hidden /> Protocol Adapter
        <span className="section-sub">
          Translates between wire protocols for harness × provider pairs that don't share one, so a harness can reach a
          provider it couldn't speak to directly (e.g. Claude Code → Azure/Foundry).
        </span>
        <span className="spacer" />
        <span className={`hh-verdict ${stateTone}`} title={state.pid ? `pid ${state.pid}` : undefined}>
          <span className={`hh-dot${state.healthy ? " on" : ""}`} /> {stateLabel}
        </span>
        <button
          className="lk-chip"
          onClick={() => lifecycle(state.running ? "stop" : "start")}
          disabled={busy !== null || (!state.running && !state.configured)}
          title={
            state.running
              ? "Stop the adapter proxy"
              : state.configured
                ? "Generate config from targets and launch the adapter"
                : "No targets configured — run `cesium-eval adapter init`, then edit the local targets file"
          }
        >
          {busy === "start" ? "Starting…" : busy === "stop" ? "Stopping…" : state.running ? "Stop" : "Start"}
        </button>
      </div>

      {error && (
        <div className="launch-warn">
          <AlertTriangle size={11} aria-hidden /> {error}
        </div>
      )}

      <div className="hh-rows">
        {state.targets.map((target) => {
          const isProbing = busy === `probe:${target.name}`;
          const result = probeResults[target.name] ?? null;
          const tone = result ? probeVerdictTone(result.verdict) : null;
          // A missing credential is a SETUP state, not a failure: name it,
          // link the remediation, and disable the probe rather than letting
          // it fail downstream with a cryptic provider error.
          const credentialMissing = target.credential_ready === false;
          return (
            <div key={target.name} className="hh-row" role="row">
              <div className="hh-cell hh-name" role="cell">
                <span className="hh-title mono" title={target.name}>{target.name}</span>
              </div>
              <div className="hh-cell hh-binding" role="cell" title={target.params?.api_base ?? undefined}>
                <span className="hh-provider">→ {target.provider_id} · {target.model}</span>
                {target.credential_env && (
                  <span
                    className={`hh-route${credentialMissing ? " missing" : ""}`}
                    title={credentialMissing ? target.credential_hint ?? undefined : `Credential env: ${target.credential_env}`}
                  >
                    {target.credential_env}
                    {credentialMissing ? " · not set" : ""}
                  </span>
                )}
              </div>
              <div className="hh-cell hh-vision" role="cell" />
              <div className="hh-cell hh-probe" role="cell">
                {isProbing ? (
                  <span className="hh-verdict run">
                    <Clock size={11} aria-hidden /> Probing via Claude Code…
                  </span>
                ) : credentialMissing ? (
                  <div className="hh-probe-stack">
                    <span className="hh-verdict unknown" title={target.credential_hint ?? undefined}>
                      credential needed
                    </span>
                    <span className="hh-probe-meta" title={target.credential_hint ?? undefined}>
                      {target.credential_hint}
                    </span>
                  </div>
                ) : result ? (
                  <div className="hh-probe-stack">
                    <span className={`hh-verdict ${tone}`} title={result.capability.error ?? undefined}>
                      {tone === "pass" ? <CheckCircle2 size={11} aria-hidden /> : <XCircle size={11} aria-hidden />}
                      {PROBE_VERDICT_LABEL[result.verdict] ?? result.verdict}
                      {tone === "pass" && (
                        <span className="hh-att reg" title="Behind the adapter the harness cannot see the real provider; identity comes from this target's binding. The model id is still verified on the wire.">
                          model-verified
                        </span>
                      )}
                    </span>
                    <span
                      className="hh-probe-meta mono"
                      title={result.capability.error ?? `claude-code → ${result.attribution.provider.value}/${result.attribution.model.value}`}
                    >
                      claude-code → {result.attribution.provider.value}/{result.attribution.model.value} ·{" "}
                      {fmtDuration(result.latency_ms / 1000)}
                    </span>
                  </div>
                ) : (
                  <span className="hh-verdict unknown">not probed this session</span>
                )}
              </div>
              <div className="hh-cell hh-actions" role="cell">
                <button
                  className="lk-chip"
                  onClick={() => probeVia(target.name)}
                  disabled={busy !== null || !state.healthy || credentialMissing}
                  title={
                    credentialMissing
                      ? target.credential_hint ?? "Credential missing"
                      : state.healthy
                        ? `Probe Claude Code through the adapter to ${target.provider_id}/${target.model} — proves the full translation path with real tool use`
                        : "Start the adapter first"
                  }
                >
                  {isProbing ? "…" : "Probe"}
                </button>
              </div>
            </div>
          );
        })}
        {!state.targets.length && (
          <div className="dash-sub">
            No targets configured. Run <code className="mono">cesium-eval adapter init</code>, then edit the local
            targets file (endpoints stay machine-local, never tracked).
          </div>
        )}
      </div>

    </div>
  );
}

/** Models are only provided by providers, so the model list follows the
 * provider choice: the harness's own catalog for its bound provider, or the
 * registry-wide catalog of the chosen provider (short ids) otherwise. */
function modelsForProvider(
  registry: ReturnType<typeof useStore>["registry"],
  harness: HarnessSpec | undefined,
  providerId: string
): HarnessSpec["models"] {
  if (!harness) return [];
  if (!providerId || providerId === harness.provider) return harness.models;
  const seen = new Map<string, HarnessSpec["models"][number]>();
  for (const h of registry?.harnesses ?? []) {
    if (h.provider !== providerId) continue;
    for (const m of h.models) {
      const short = modelShort(m.id);
      if (short && !seen.has(short)) seen.set(short, { ...m, id: short });
    }
  }
  return [...seen.values()];
}

/** Provider chips for one launcher section, dereferenced from the registry:
 * the harness's bound provider (Auto) plus everything provider_support.native
 * says it can reach. Protocol mismatches beyond that are adapter territory. */
function ProviderPicker({
  label,
  flag,
  registry,
  harness,
  value,
  disabled,
  onChange
}: {
  label: string;
  flag: string;
  registry: ReturnType<typeof useStore>["registry"];
  harness: HarnessSpec | undefined;
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  if (!harness) return null;
  const declared = new Map((registry?.providers ?? []).map((p) => [p.id, p]));
  const name = (id: string | undefined) => (id ? declared.get(id)?.display_name ?? id : "?");
  const others = [
    ...new Set([...(harness.provider_support?.native ?? []), ...(harness.provider_support?.native_3p ?? [])])
  ].filter((id) => id !== harness.provider);
  return (
    <div className="launch-field">
      <div className="launch-label">
        {label} <code className="launch-flag">{flag}</code>
      </div>
      <div className="launch-steppers" role="radiogroup" aria-label={label}>
        <button
          className={`lk-chip${value === "" ? " on" : ""}`}
          role="radio"
          aria-checked={value === ""}
          disabled={disabled}
          onClick={() => onChange("")}
          title={`Use ${harness.name}'s bound provider, ${name(harness.provider)}`}
        >
          Auto · {name(harness.provider)}
        </button>
        {others.map((id) => (
          <button
            key={id}
            className={`lk-chip${value === id ? " on" : ""}`}
            role="radio"
            aria-checked={value === id}
            disabled={disabled}
            onClick={() => onChange(id)}
            title={`Serve the model from ${name(id)}. Models are provider-scoped, so the model list follows this choice.`}
          >
            {name(id)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LaunchPanel() {
  const { launchEvalRun, studyRunning, registry } = useStore();
  const [available, setAvailable] = useState<string[]>([]);
  // Tri-state selection (error prevention): "all" is an explicit choice, and
  // an emptied custom set stays empty; it never silently re-arms all skills.
  const [mode, setMode] = useState<"all" | "custom">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [judge, setJudge] = useState(true);
  // Visual Tests attach screenshots, so the judge default must be vision-capable.
  const [judgeHarness, setJudgeHarness] = useState<string>("codex");
  const [nJudges, setNJudges] = useState(3);
  const [concurrency, setConcurrency] = useState(4);
  const [judgeModel, setJudgeModel] = useState("");
  const [judgeProvider, setJudgeProvider] = useState("");
  const [judgeVariant, setJudgeVariant] = useState("");
  const [codegenHarness, setCodegenHarness] = useState("");
  const [codegenProvider, setCodegenProvider] = useState("");
  const [codegenModel, setCodegenModel] = useState("");
  const [codegenVariant, setCodegenVariant] = useState("");
  const [threshold, setThreshold] = useState("");
  const [bundleRoot, setBundleRoot] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Baseline screenshots: the Visual Tests prerequisite. Without them the
  // judge has nothing to look at and the run completes "incomplete".
  const [coverage, setCoverage] = useState<BaselineCoverageDTO | null>(null);
  const [rendering, setRendering] = useState(false);
  const [coverageErr, setCoverageErr] = useState<string | null>(null);

  // The registry is the single source of truth for harnesses and their model
  // catalogs. The server also accepts a hidden "fake" smoke judge, but that
  // lane exists for CI, not console launches, so it is not offered here.
  const fallbackHarnesses = ["codex", "opencode", "copilot"];
  const judgeHarnesses =
    registry?.harnesses.filter((h) => h.roles.some((r) => r.startsWith("judge"))).map((h) => h.id) ??
    fallbackHarnesses;
  const codegenHarnesses =
    registry?.harnesses.filter((h) => h.roles.includes("codegen")).map((h) => h.id) ?? fallbackHarnesses;
  const harnessSpec = (id: string) => registry?.harnesses.find((h) => h.id === id);
  const judgeHarnessSpec = harnessSpec(judgeHarness);
  // Multimodality is a property of the provider/model serving the call, so
  // every harness is offered here; a rejected image call fails loudly at
  // runtime instead of being pre-blocked on a per-harness flag.
  const judgeModels = modelsForProvider(registry, judgeHarnessSpec, judgeProvider);
  const judgeEffortLevels = effortLevelsFor(judgeHarnessSpec, judgeModel);
  const codegenHarnessSpec = harnessSpec(codegenHarness);
  const codegenModels = modelsForProvider(registry, codegenHarnessSpec, codegenProvider);
  const codegenEffortLevels = effortLevelsFor(codegenHarnessSpec, codegenModel);

  // Coverage for the currently selected skills, refreshed when the selection
  // changes. Computed from state directly so it does not depend on
  // `selectedSkills`, which is declared further down. Loaded whether or not
  // Visual Tests are on: the badge is judge-only, but the measured root also
  // fills the Bundle Root field, and a Code-Tests-only run judges that same
  // root.
  const currentSkills = mode === "all" ? available : [...picked];
  const coverageKey = currentSkills.join(",");
  useEffect(() => {
    if (!currentSkills.length) {
      setCoverage(null);
      return;
    }
    let disposed = false;
    loadBaselineCoverage(currentSkills)
      .then((c) => {
        if (!disposed) setCoverage(c);
      })
      .catch((exc) => {
        if (!disposed) setCoverageErr(String(exc?.message ?? exc));
      });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverageKey]);

  // The badge denominator is the launch selection, not merely the subset that
  // already has rendered cases. Otherwise a stale or incomplete bundle set
  // can claim "1/1 skills rendered" while All (8) is selected.
  const {
    coveredCount,
    selectedCount: selectedCoverageCount,
    needsPreparation,
    missingScreenshots,
    missingBaselineCases,
    fullyCovered,
  } = summarizeBaselineCoverage(coverage);
  const coverageIncomplete = coverage !== null && coveredCount < selectedCoverageCount;
  // ZERO screenshots anywhere in the selection: the visual lane would judge
  // nothing and the run lands "incomplete" — block the launch (the server
  // rejects it too; this stops it before the doomed click).
  const noVisualEvidence = judge && coverage !== null && !coverage.skills.some((s) => s.screenshots > 0);

  // Show the root coverage was measured at, whatever the coverage level. The
  // launch judges this directory either way (the server fills in the same
  // default), so clearing the field on partial coverage only hid the fact that
  // the badge and the run were talking about the same place — or, when the
  // operator types their own root, that they are not.
  const bundleRootEdited = useRef(false);
  useEffect(() => {
    if (coverage && !bundleRootEdited.current) setBundleRoot(coverage.root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage?.root]);
  // A hand-typed root is judged instead of the measured one: say so rather
  // than letting a green badge vouch for a directory the run will not read.
  const rootDiverged = coverage !== null && bundleRoot !== "" && bundleRoot !== coverage.root;

  // While a render is running, poll coverage so the badge ticks live even
  // inside a large skill (each screenshot lands on disk as it renders).
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => {
      loadBaselineCoverage(currentSkills)
        .then(setCoverage)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendering, coverageKey]);

  const renderMissing = async () => {
    if (!needsPreparation.length) return;
    setRendering(true);
    setCoverageErr(null);
    try {
      // One skill per request: rendering a large selection in a single POST
      // can outlive the server's request timeout, and per-skill requests let
      // the coverage badge tick up live as each skill finishes.
      for (const entry of needsPreparation) {
        await prepareBaselines({
          skills: [entry.skill],
          codegen_harness: codegenHarness || undefined,
          codegen_provider: codegenProvider || undefined,
          codegen_model: codegenModel || undefined,
          codegen_variant: codegenVariant || undefined,
        });
        setCoverage(await loadBaselineCoverage(currentSkills));
      }
    } catch (exc: any) {
      setCoverageErr(String(exc?.message ?? exc));
    } finally {
      setRendering(false);
    }
  };

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
    setMode("custom");
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const allSelected = mode === "all";
  const selectedCount = allSelected ? available.length : picked.size;
  const selectedSkills = allSelected ? available : [...picked];

  // The exact CLI invocation this launch spawns: one form field per flag, so
  // what you review here is what actually runs (the journal and output dir are
  // chosen by the server at launch time).
  const cliPreview = useMemo(() => {
    const parts = [
      "cesium-eval audit",
      `--skills ${allSelected ? "all" : selectedSkills.join(",") || "<none>"}`,
      `--judge-harness ${judgeHarness}`,
      `--n-judges ${nJudges}`
    ];
    if (!judge) parts.push("--no-judge");
    if (judge && concurrency > 1) parts.push(`--concurrency ${concurrency}`);
    if (judge && judgeModel) parts.push(`--judge-model ${judgeModel}`);
    if (judge && judgeProvider) parts.push(`--judge-provider ${judgeProvider}`);
    if (judge && judgeVariant) parts.push(`--judge-variant ${judgeVariant}`);
    if (codegenHarness) parts.push(`--codegen-harness ${codegenHarness}`);
    if (codegenModel) parts.push(`--codegen-model ${codegenModel}`);
    if (codegenProvider) parts.push(`--codegen-provider ${codegenProvider}`);
    if (codegenVariant) parts.push(`--codegen-variant ${codegenVariant}`);
    if (threshold) parts.push(`--threshold ${threshold}`);
    // The server always passes a root, defaulting to the one coverage measures,
    // so show that rather than implying the audit picks its own.
    const effectiveRoot = bundleRoot || coverage?.root;
    if (effectiveRoot) parts.push(`--bundle-root ${effectiveRoot}`);
    parts.push("--journal <run-dir>/progress.jsonl", "--output-dir <run-dir>");
    return parts.join(" \\\n  ");
  }, [
    allSelected,
    selectedSkills,
    judgeHarness,
    nJudges,
    judge,
    judgeModel,
    judgeProvider,
    judgeVariant,
    concurrency,
    codegenHarness,
    codegenModel,
    codegenProvider,
    codegenVariant,
    threshold,
    bundleRoot,
    coverage?.root
  ]);

  const launch = async () => {
    setBusy(true);
    try {
      await launchEvalRun({
        kind: "audit",
        skills: allSelected ? undefined : [...picked],
        judge,
        judge_harness: judgeHarness,
        n_judges: nJudges,
        concurrency: judge ? concurrency : undefined,
        judge_model: judge && judgeModel ? judgeModel : undefined,
        judge_provider: judge && judgeProvider ? judgeProvider : undefined,
        judge_variant: judge && judgeVariant ? judgeVariant : undefined,
        codegen_harness: codegenHarness || undefined,
        codegen_model: codegenModel || undefined,
        codegen_provider: codegenProvider || undefined,
        codegen_variant: codegenVariant || undefined,
        threshold: threshold ? Number(threshold) : undefined,
        bundle_root: bundleRoot || undefined
      });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-card launch-panel">
      <div className="section-title">
        <Rocket size={13} aria-hidden /> Launch an Eval Run
        <span className="section-sub">
          Combined baseline audit over the archived baselines: Code Tests
          {judge ? " plus Visual Tests" : " only"}. Every field maps to a cesium-eval audit flag.
        </span>
      </div>

      <div className="launch-grid">
        <div className="launch-field launch-span" role="group" aria-label="Skills to audit">
          <div className="launch-label">
            Skills <code className="launch-flag">--skills</code>
          </div>
          <div className="launch-skills">
            <button
              className={`lk-chip${allSelected ? " on" : ""}`}
              aria-pressed={allSelected}
              onClick={() => {
                setMode("all");
                setPicked(new Set());
              }}
              title="Audit every skill with archived baselines"
            >
              All ({available.length})
            </button>
            {available.map((s) => (
              <button
                key={s}
                className={`lk-chip${!allSelected && picked.has(s) ? " on" : ""}`}
                aria-pressed={!allSelected && picked.has(s)}
                onClick={() => toggleSkill(s)}
                title={skillLabel(s)}
              >
                {s.replace(/^cesiumjs-/, "")}
              </button>
            ))}
          </div>
          {!allSelected && picked.size === 0 && (
            <div className="launch-warn">
              <AlertTriangle size={11} aria-hidden /> No skills selected. Pick at least one, or choose All.
            </div>
          )}
        </div>

        <fieldset className="launch-role">
          <legend>
            <Cpu size={11} aria-hidden /> Code Generation
          </legend>
          <div className="launch-field">
            <div className="launch-label">
              Codegen Harness <code className="launch-flag">--codegen-harness</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-label="Codegen harness stamp">
              <button
                className={`lk-chip${codegenHarness === "" ? " on" : ""}`}
                role="radio"
                aria-checked={codegenHarness === ""}
                onClick={() => {
                  setCodegenHarness("");
                  setCodegenModel("");
                  setCodegenVariant("");
                }}
                title="Stamp the config default codegen harness"
              >
                Auto
              </button>
              {codegenHarnesses.map((h) => (
                <button
                  key={h}
                  className={`lk-chip lk-harness${codegenHarness === h ? " on" : ""}`}
                  role="radio"
                  aria-checked={codegenHarness === h}
                  onClick={() => {
                    setCodegenHarness(h);
                    setCodegenProvider("");
                    setCodegenModel("");
                    setCodegenVariant("");
                  }}
                  title={`Stamp ${harnessSpec(h)?.name ?? harnessLabel(h)} as the harness that produced the audited baselines`}
                >
                  {harnessLabel(h)}
                </button>
              ))}
            </div>
            <div className="launch-hint">
              Provenance stamp for the scorecard: the audit scores baselines already on disk. Model and thinking
              effort default to each baseline's meta sidecar; set them below to stamp explicit values instead.
            </div>
          </div>

          <ProviderPicker
            label="Codegen Provider"
            flag="--codegen-provider"
            registry={registry}
            harness={codegenHarnessSpec}
            value={codegenProvider}
            disabled={!codegenHarness}
            onChange={(id) => {
              setCodegenProvider(id);
              // A non-default provider needs a model it actually serves (the
              // backend rejects an auto model under an override), so pre-select
              // the first provider-scoped model; Auto keeps the harness default.
              const ms = modelsForProvider(registry, codegenHarnessSpec, id);
              setCodegenModel(id && ms.length ? ms[0].id : "");
            }}
          />

          <div className="launch-field">
            <label className="launch-model">
              <span className="launch-label">
                Codegen Model <code className="launch-flag">--codegen-model</code>
              </span>
              <select
                value={codegenModel}
                disabled={!codegenHarness}
                onChange={(e) => {
                  const next = e.target.value;
                  setCodegenModel(next);
                  setCodegenVariant((v) =>
                    v && !effortLevelsFor(codegenHarnessSpec, next).includes(v) ? "" : v
                  );
                }}
              >
                <option value="">auto (from baseline meta)</option>
                {codegenModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-codegen-effort-label">
              Thinking Effort <code className="launch-flag">--codegen-variant</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-labelledby="launch-codegen-effort-label">
              <button
                className={`lk-chip${codegenVariant === "" ? " on" : ""}`}
                role="radio"
                aria-checked={codegenVariant === ""}
                disabled={!codegenHarness}
                onClick={() => setCodegenVariant("")}
                title="Recover the effort from each baseline's meta sidecar"
              >
                Auto
              </button>
              {codegenEffortLevels.map((lv) => (
                <button
                  key={lv}
                  className={`lk-chip${codegenVariant === lv ? " on" : ""}`}
                  role="radio"
                  aria-checked={codegenVariant === lv}
                  disabled={!codegenHarness}
                  onClick={() => setCodegenVariant(lv)}
                  title={`Stamp ${effortLabel(lv)} as the codegen reasoning effort`}
                >
                  {effortLabel(lv)}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="launch-role">
          <legend>
            <Eye size={11} aria-hidden /> Visual Tests
          </legend>
          <div className="launch-field">
            <div className="launch-label">
              Visual Tests <code className="launch-flag">--no-judge</code>
            </div>
            <button
              className={`judge-toggle${judge ? " on" : ""}`}
              role="switch"
              aria-checked={judge}
              onClick={() => setJudge((j) => !j)}
              title={
                judge
                  ? "AI reviewers visually test every rendered screenshot (recommended)."
                  : "Code Tests only. Screenshots will not be visually tested."
              }
            >
              <span className="jt-track" aria-hidden>
                <span className="jt-knob" />
              </span>
              {judge ? (
                <>
                  <Eye size={12} aria-hidden /> <span className="jt-state">On</span> · Code + Visual
                </>
              ) : (
                <>
                  <EyeOff size={12} aria-hidden /> <span className="jt-state">Off</span> · Code Only
                </>
              )}
            </button>
            {!judge && (
              <div className="launch-warn">
                <AlertTriangle size={11} aria-hidden /> The scorecard will say nothing about how the renders actually
                look. Code Tests only.
              </div>
            )}
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-judge-harness-label">
              Visual Test Harness <code className="launch-flag">--judge-harness</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-labelledby="launch-judge-harness-label">
              {judgeHarnesses.map((a) => {
                const spec = harnessSpec(a);
                return (
                  <button
                    key={a}
                    className={`lk-chip lk-harness${judgeHarness === a ? " on" : ""}`}
                    role="radio"
                    aria-checked={judgeHarness === a}
                    disabled={!judge}
                    onClick={() => {
                      setJudgeHarness(a);
                      setJudgeProvider("");
                      setJudgeModel("");
                      setJudgeVariant((v) =>
                        v && !effortLevelsFor(harnessSpec(a), "").includes(v) ? "" : v
                      );
                    }}
                    title={spec?.vision_note ?? `Run Visual Tests with the ${harnessLabel(a)} harness`}
                  >
                    {harnessLabel(a)}
                  </button>
                );
              })}
            </div>
          </div>

          <ProviderPicker
            label="Visual Test Provider"
            flag="--judge-provider"
            registry={registry}
            harness={judgeHarnessSpec}
            value={judgeProvider}
            disabled={!judge}
            onChange={(id) => {
              setJudgeProvider(id);
              // A non-default provider needs a model it actually serves (the
              // backend rejects an auto model under an override), so pre-select
              // the first provider-scoped model; Auto keeps the harness default.
              const ms = modelsForProvider(registry, judgeHarnessSpec, id);
              setJudgeModel(id && ms.length ? ms[0].id : "");
            }}
          />

          {judge && (
            <div className="launch-field launch-span">
              <div className="launch-label">
                Baseline Screenshots
                {coverage && (
                  <span className={`bl-badge${fullyCovered ? " ok" : coverageIncomplete ? " warn" : ""}`}>
                    {coveredCount}/{selectedCoverageCount} selected skills ready
                  </span>
                )}
              </div>
              <div className="bl-row">
                <span className="bl-note">
                  {fullyCovered
                    ? "Every selected skill has rendered baselines — Visual Tests will judge them."
                    : needsPreparation.length && missingBaselineCases.length
                      ? `${needsPreparation.length} selected skill${
                          needsPreparation.length === 1 ? "" : "s"
                        } need preparation; ${missingBaselineCases.length} ${
                          missingBaselineCases.length === 1 ? "has" : "have"
                        } missing generated baseline cases that will be created first.`
                      : missingScreenshots.length
                        ? `${missingScreenshots
                            .map((s) => s.skill.replace(/^cesiumjs-/, ""))
                            .join(", ")} need rendering, or Visual Tests will complete "incomplete."`
                        : missingBaselineCases.length
                          ? `${missingBaselineCases.length} selected skill${
                              missingBaselineCases.length === 1 ? " has" : "s have"
                            } missing generated baseline cases; Prepare will generate them before rendering.`
                      : "Generating and rendering complete baseline evidence for the selected scenarios."}
                </span>
                <span className="spacer" />
                <button
                  className="lk-chip"
                  onClick={renderMissing}
                  disabled={rendering || !needsPreparation.length}
                  title={
                    needsPreparation.length
                      ? `Generate missing baseline code and render screenshots for ${needsPreparation.length} skill(s). Agent authentication is required; Cesium ion is optional but improves token-backed scenes.`
                      : missingBaselineCases.length
                        ? `${missingBaselineCases.length} selected skill(s) need baseline generation before rendering`
                        : "All selected skills already have baseline screenshots"
                  }
                >
                  {rendering
                    ? "Preparing…"
                    : needsPreparation.length
                      ? `Prepare ${needsPreparation.length}`
                      : missingBaselineCases.length
                        ? "Prepare cases"
                        : "Rendered"}
                </button>
              </div>
              {rootDiverged && (
                <div className="launch-hint">
                  <AlertTriangle size={11} aria-hidden /> Coverage above is measured at <code>{coverage?.root}</code>,
                  but this launch judges <code>{bundleRoot}</code>. Clear Bundle Root to judge what was measured.
                </div>
              )}
              {coverageErr && (
                <div className="launch-hint">
                  <AlertTriangle size={11} aria-hidden /> {coverageErr}
                </div>
              )}
            </div>
          )}

          <div className="launch-field">
            <label className="launch-model">
              <span className="launch-label">
                Visual Test Model <code className="launch-flag">--judge-model</code>
              </span>
              <select
                value={judgeModel}
                disabled={!judge}
                onChange={(e) => {
                  const next = e.target.value;
                  setJudgeModel(next);
                  setJudgeVariant((v) =>
                    v && !effortLevelsFor(judgeHarnessSpec, next).includes(v) ? "" : v
                  );
                }}
              >
                <option value="">auto (discovered)</option>
                {judgeModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-judge-effort-label">
              Thinking Effort <code className="launch-flag">--judge-variant</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-labelledby="launch-judge-effort-label">
              <button
                className={`lk-chip${judgeVariant === "" ? " on" : ""}`}
                role="radio"
                aria-checked={judgeVariant === ""}
                disabled={!judge}
                onClick={() => setJudgeVariant("")}
                title="Harness default reasoning effort"
              >
                Auto
              </button>
              {judgeEffortLevels.map((lv) => (
                <button
                  key={lv}
                  className={`lk-chip${judgeVariant === lv ? " on" : ""}`}
                  role="radio"
                  aria-checked={judgeVariant === lv}
                  disabled={!judge}
                  onClick={() => setJudgeVariant(lv)}
                  title={`Visual Test reasoning effort: ${effortLabel(lv)}`}
                >
                  {effortLabel(lv)}
                </button>
              ))}
            </div>
            <div className="launch-hint">
              How much reasoning each Visual Test call spends. Auto uses the harness default
              {judgeHarnessSpec ? ` (${effortLabel(judgeHarnessSpec.default_effort)})` : ""}.
            </div>
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-judges-label">
              AI Reviewers <code className="launch-flag">--n-judges</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-labelledby="launch-judges-label">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`lk-chip${nJudges === n ? " on" : ""}`}
                  role="radio"
                  aria-checked={nJudges === n}
                  disabled={!judge}
                  onClick={() => setNJudges(n)}
                  title={`${n} AI reviewers per case`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-concurrency-label">
              Concurrency <code className="launch-flag">--concurrency</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-labelledby="launch-concurrency-label">
              {[1, 2, 4, 6, 8].map((n) => (
                <button
                  key={n}
                  className={`lk-chip${concurrency === n ? " on" : ""}`}
                  role="radio"
                  aria-checked={concurrency === n}
                  disabled={!judge}
                  onClick={() => setConcurrency(n)}
                  title={n === 1 ? "One case at a time" : `${n} cases visually tested in parallel`}
                >
                  {n === 1 ? "1 · Serial" : `${n}×`}
                </button>
              ))}
            </div>
            <div className="launch-hint">
              How many cases Visual Tests process at once. Each case still gets {nJudges} AI reviewers; the
              trial board shows every in-flight case live.
            </div>
          </div>
        </fieldset>

        <details className="launch-advanced">
          <summary>Advanced Audit Flags</summary>
          <div className="launch-advanced-grid">
            <label className="launch-adv-field">
              <span className="launch-label">
                Pass Threshold <code className="launch-flag">--threshold</code>
              </span>
              <input
                type="number"
                min="0.05"
                max="1"
                step="0.05"
                placeholder="config default"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
            <label className="launch-adv-field">
              <span className="launch-label">
                Bundle Root <code className="launch-flag">--bundle-root</code>
              </span>
              <input
                type="text"
                placeholder="default: archived baselines"
                title="The directory the audit judges. Prefilled with the root baseline coverage is measured at; clearing it restores that default."
                value={bundleRoot}
                onChange={(e) => {
                  // Once typed, stop tracking the measured root — an operator
                  // pointing at their own bundles keeps that choice. Emptying
                  // the field hands it back.
                  bundleRootEdited.current = e.target.value !== "";
                  setBundleRoot(e.target.value);
                }}
              />
            </label>
          </div>
        </details>

        <div className="launch-field launch-span">
          <div className="launch-label">
            <Terminal size={11} aria-hidden /> Command
            <span className="spacer" />
            <button
              className={`launch-copy${copied ? " copied" : ""}`}
              onClick={() => {
                navigator.clipboard
                  .writeText(cliPreview)
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                  .catch(() => {});
              }}
              title="Copy the exact CLI invocation this launch runs"
            >
              {copied ? <CheckCircle2 size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="launch-cmd mono">{cliPreview}</pre>
        </div>

        <div className="launch-field launch-go">
          {!confirming ? (
            <button
              className="launch-btn"
              onClick={() => setConfirming(true)}
              disabled={busy || selectedCount === 0 || noVisualEvidence}
              title={
                noVisualEvidence
                  ? "Visual Tests are on, but no selected skill has baseline screenshots to judge. Use Baseline Screenshots → Render above, or turn Visual Tests off."
                  : undefined
              }
            >
              <Rocket size={13} aria-hidden />
              {`Review & Launch · ${selectedCount} ${selectedCount === 1 ? "Skill" : "Skills"}`}
            </button>
          ) : (
            <div className="launch-preflight" role="group" aria-label="Launch preflight">
              <div className="launch-preflight-body">
                <strong>Preflight</strong>
                <span>
                  {selectedCount} {selectedCount === 1 ? "skill" : "skills"}
                  {allSelected ? " (all)" : `: ${selectedSkills.map((s) => s.replace(/^cesiumjs-/, "")).join(", ")}`}
                </span>
                <span>
                  {judge
                    ? `Visual Tests on · ${nJudges} AI reviewers · ${
                        concurrency > 1 ? `${concurrency} cases in parallel` : "one case at a time"
                      } · ${harnessLabel(judgeHarness)} harness · model ${
                        judgeModel || "auto"
                      } · effort ${judgeVariant ? effortLabel(judgeVariant) : "auto"} (real LLM calls per case)`
                    : "Code Tests only · no visual-test calls"}
                </span>
                {codegenHarness && (
                  <span>
                    Codegen stamp: {harnessLabel(codegenHarness)}
                    {codegenModel ? ` · ${codegenModel}` : ""}
                    {codegenVariant ? ` · effort ${effortLabel(codegenVariant)}` : ""}
                  </span>
                )}
                {threshold && <span>Pass threshold {threshold}</span>}
                <span className="launch-preflight-note">
                  Runs as a detached process. Cancel it any time from its run card.
                </span>
              </div>
              <div className="launch-preflight-actions">
                <button className="launch-btn" onClick={() => void launch()} disabled={busy}>
                  <Rocket size={13} aria-hidden /> {busy ? "Launching…" : "Confirm Launch"}
                </button>
                <button className="pill" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {studyRunning && <div className="launch-note">A study is already in progress. Parallel studies are fine.</div>}
        </div>
      </div>
    </div>
  );
}

function LiveEmptyState() {
  // Baseline rendering is real in-progress work on this machine, so it must
  // occupy the live slot rather than sit behind an idle "nothing running"
  // banner while screenshots are being produced a panel below.
  const [coverage, setCoverage] = useState<BaselineCoverageDTO | null>(null);
  useEffect(() => {
    let disposed = false;
    const poll = () =>
      loadBaselineCoverage([])
        .then((c) => {
          if (!disposed) setCoverage(c);
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  if (coverage?.rendering?.active) {
    const withCases = coverage.skills.filter((s) => s.cases > 0);
    const shots = withCases.reduce((n, s) => n + s.screenshots, 0);
    const total = withCases.reduce((n, s) => n + s.cases, 0);
    const covered = withCases.filter((s) => s.covered).length;
    const pct = total ? Math.round((shots / total) * 100) : 0;
    return (
      <div className="dash-card live-empty rendering">
        <div className="le-icon" aria-hidden>
          <Camera size={22} />
        </div>
        <div className="le-title">Rendering Baseline Screenshots…</div>
        <div className="le-sub">
          {shots}/{total} screenshots · {covered}/{withCases.length} skills complete
          {coverage.rendering.skill ? ` · now: ${coverage.rendering.skill.replace(/^cesiumjs-/, "")}` : ""}. Each
          skill's baseline code runs in a headless browser; the launcher unlocks Visual Tests as coverage completes.
        </div>
        <div className="le-render-bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="dash-card live-empty">
      <div className="le-icon" aria-hidden>
        <Activity size={22} />
      </div>
      <div className="le-title">No Eval Run in Progress</div>
      <div className="le-sub">
        Configure and launch an evaluation study below. Every Code Test and Visual Test journals to disk and streams
        here within a few seconds.
      </div>
      <pre className="le-cmd mono">
        node packages/eval/bin/cesium-eval.js audit --skills all --journal &lt;dir&gt;/progress.jsonl
      </pre>
    </div>
  );
}

export function LiveStation() {
  const { live, studyRuns: runs } = useStore();
  const runningRuns = useMemo(() => runs.filter((r) => r.status === "running"), [runs]);
  const failedRuns = useMemo(() => runs.filter((r) => r.status === "failed"), [runs]);
  const stalledRuns = useMemo(() => runs.filter((r) => r.status === "stalled"), [runs]);

  return (
    <div className="overview dashboard-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Run</div>
          <div className="dash-sub">
            Launch evaluation studies and watch their Code Tests, Visual Tests, and journal progress straight from
            disk. Optimization activity stays in Optimize.
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

      {failedRuns.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: "var(--sp-4)" }}>
            Failed Launches
          </div>
          <div className="dash-sub" style={{ marginBottom: "var(--sp-3)" }}>
            Studies that were launched but exited before recording any data, usually a bad flag or an unavailable
            harness CLI. The card carries the launch log so you can see why.
          </div>
          {failedRuns.map((run) => (
            <LiveRunCard key={`${run.skill}/${run.iteration}`} run={run} />
          ))}
        </>
      )}

      <LaunchPanel />

      <HarnessHealthPanel />

      <AdapterPanel />

      {stalledRuns.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: "var(--sp-4)" }}>
            Stalled on Disk
          </div>
          <div className="dash-sub" style={{ marginBottom: "var(--sp-3)" }}>
            Journals that started but reached no terminal event and have gone quiet, usually a loop that was
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

/** Lane-specific "happening now" strips for the Dashboard. */
export function LiveNowBanner() {
  const { studyRuns, optimizationRuns, setStation } = useStore();
  const running = [
    ...studyRuns.filter((run) => run.status === "running").map((run) => ({ run, lane: "study" as const })),
    ...optimizationRuns
      .filter((run) => run.status === "running")
      .map((run) => ({ run, lane: "optimization" as const }))
  ];
  if (!running.length) return null;
  return (
    <div className="live-now-stack">
      {running.map(({ run, lane }) => {
        const study = lane === "study";
        const pct = Math.round(run.progress * 100);
        return (
          <button
            key={`${lane}/${run.skill}/${run.iteration}`}
            className={`live-now-banner${study ? "" : " optimization"}`}
            onClick={() => setStation(study ? "live" : "optimize")}
            title={study ? "Open Run (1)" : "Open Optimize (4)"}
          >
            <span className="lrc-dot on" aria-hidden />
            <span className="lnb-label">
              {study ? "Evaluation study" : "Optimization"} in progress: <strong>{liveRunTitle(run)}</strong>
              <span className="mono">
                {" "}
                {run.kind === "audit"
                  ? run.judge
                    ? "Code + Visual"
                    : "Code Only"
                  : run.kind === "baseline"
                    ? "Baseline"
                    : run.iteration}
              </span>
              {run.current_phase_label ? ` · ${run.current_phase_label}` : ""}
            </span>
            <span className="lnb-bar">
              <LiveProgressBar run={run} slim />
            </span>
            <span className="mono lnb-pct">{pct}%</span>
            <span className="lnb-cta">
              {study ? "Watch Run" : "Watch Optimize"} <ArrowRight size={11} aria-hidden />
            </span>
          </button>
        );
      })}
    </div>
  );
}
