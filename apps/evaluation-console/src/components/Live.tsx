import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
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
import { loadLaunchSkills } from "../api";
import type { HarnessSpec, LivePhase, LiveRun, LiveTrial } from "../types";
import { fmtDuration, harnessLabel, pluralize, relativeTime, skillLabel, titleCase } from "../lib/format";

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
  judged: "Judged",
  skipped: "Review-Only"
};

// Audit cases skip codegen (evidence is pre-rendered): queued -> scored -> judged.
const AUDIT_STAGE_WORD: Record<TrialStage, string> = {
  queued: "Queued",
  inflight: "In Flight",
  coded: "Queued",
  rendered: "Scored",
  judged: "Judged",
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
        text: `Visual Judge opened — ${pluralize(Number(e.total ?? 0), "case")}, ${e.n_judges}-judge panel${par > 1 ? ` · ${par} workers in parallel` : ""}`,
        tone: "eye"
      };
    }
    case "judge_case_started":
      return { text: `${workerTag(e)}judging ${journalCaseRef(e)}…`, tone: "eye" };
    case "judge_case_completed": {
      const status = typeof e.status === "string" && e.status ? titleCase(e.status) : "Done";
      const dur = durationText(e.duration_ms);
      return {
        text: `${workerTag(e)}${journalCaseRef(e)} judged — ${status} (${e.index}/${e.total})${dur ? ` · ${dur}` : ""}`,
        tone: e.status === "fail" ? "fail" : "eye"
      };
    }
    case "judge_completed":
      return { text: `Visual Judge complete — ${e.judged_count}/${e.total} judged`, tone: "eye" };
    case "scoring_started":
      return { text: `Deterministic Score opened — ${pluralize(Number(e.total ?? 0), "case")}`, tone: "machine" };
    case "scoring_case_completed":
      return {
        text: `${journalCaseRef(e)} scored — ${titleCase(String(e.result ?? ""))} (${e.index}/${e.total})`,
        tone: e.result === "fail" ? "fail" : "machine"
      };
    case "scoring_completed":
      return { text: "Deterministic Score complete", tone: "machine" };
    case "scorecard_written":
      return {
        text: `Scorecard written — ${titleCase(String(e.overall_result ?? "done"))}`,
        tone: e.overall_result === "pass" ? "pass" : "plain"
      };
    case "audit_completed":
      return {
        text: `Audit complete — ${titleCase(String(e.overall_result ?? "done"))}`,
        tone: e.overall_result === "pass" ? "pass" : "fail"
      };
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
    <div className={`dash-card live-run-card${running ? " running" : ""}${failed ? " failed" : ""}`}>
      <div className="lrc-head">
        <span className={`lrc-dot${running ? " on" : ""}`} aria-hidden />
        <span className="lrc-skill">{liveRunTitle(run)}</span>
        <span className="lrc-iter mono">
          {isAudit
            ? run.judge
              ? "Checks + Visual Review"
              : "Checks Only"
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
        <span className="lrc-meta" title="Wall clock since the run's first journal event.">
          <Clock size={11} aria-hidden /> {fmtDuration(run.elapsed_s)}
        </span>
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
            title="Open this skill's iteration log and pipeline in Optimize (3)"
          >
            Optimize <ArrowRight size={11} aria-hidden />
          </button>
        )}
      </div>

      {failed && run.error && <div className="lrc-error">{run.error}</div>}

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
          <div className="lrc-col-head">
            {pluralize(run.trials.length, isAudit ? "Case" : "Trial")}
            {(() => {
              const groupCount = new Set(run.trials.map((t) => t.group ?? "")).size;
              return isAudit && groupCount > 1 ? ` · ${groupCount} Skills` : "";
            })()}
            {isAudit && (run.concurrency ?? 1) > 1 ? (
              <span className="lrc-concurrency mono" title={`Judge lane runs ${run.concurrency} cases in parallel`}>
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

function LaunchPanel() {
  const { launchEvalRun, liveRunning, registry } = useStore();
  const [available, setAvailable] = useState<string[]>([]);
  // Tri-state selection (error prevention): "all" is an explicit choice, and
  // an emptied custom set stays empty; it never silently re-arms all skills.
  const [mode, setMode] = useState<"all" | "custom">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [judge, setJudge] = useState(true);
  const [judgeHarness, setJudgeHarness] = useState<string>("opencode");
  const [nJudges, setNJudges] = useState(3);
  const [concurrency, setConcurrency] = useState(4);
  const [judgeModel, setJudgeModel] = useState("");
  const [judgeVariant, setJudgeVariant] = useState("");
  const [codegenHarness, setCodegenHarness] = useState("");
  const [codegenModel, setCodegenModel] = useState("");
  const [codegenVariant, setCodegenVariant] = useState("");
  const [threshold, setThreshold] = useState("");
  const [bundleRoot, setBundleRoot] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
  const judgeHarnessModels = judgeHarnessSpec?.models ?? [];
  const judgeEffortLevels = effortLevelsFor(judgeHarnessSpec, judgeModel);
  const codegenHarnessSpec = harnessSpec(codegenHarness);
  const codegenHarnessModels = codegenHarnessSpec?.models ?? [];
  const codegenEffortLevels = effortLevelsFor(codegenHarnessSpec, codegenModel);

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
    if (judge && judgeVariant) parts.push(`--judge-variant ${judgeVariant}`);
    if (codegenHarness) parts.push(`--codegen-harness ${codegenHarness}`);
    if (codegenModel) parts.push(`--codegen-model ${codegenModel}`);
    if (codegenVariant) parts.push(`--codegen-variant ${codegenVariant}`);
    if (threshold) parts.push(`--threshold ${threshold}`);
    if (bundleRoot) parts.push(`--bundle-root ${bundleRoot}`);
    parts.push("--journal <run-dir>/progress.jsonl", "--output-dir <run-dir>");
    return parts.join(" \\\n  ");
  }, [
    allSelected,
    selectedSkills,
    judgeHarness,
    nJudges,
    judge,
    judgeModel,
    judgeVariant,
    concurrency,
    codegenHarness,
    codegenModel,
    codegenVariant,
    threshold,
    bundleRoot
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
        judge_variant: judge && judgeVariant ? judgeVariant : undefined,
        codegen_harness: codegenHarness || undefined,
        codegen_model: codegenModel || undefined,
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
          Combined baseline audit over the archived baselines: deterministic checks
          {judge ? " plus a visual judge panel" : " only"}. Every field maps to a cesium-eval audit flag.
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
                {codegenHarnessModels.map((m) => (
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
            <Eye size={11} aria-hidden /> Visual Judging
          </legend>
          <div className="launch-field">
            <div className="launch-label">
              Judge Panel <code className="launch-flag">--no-judge</code>
            </div>
            <button
              className={`judge-toggle${judge ? " on" : ""}`}
              role="switch"
              aria-checked={judge}
              onClick={() => setJudge((j) => !j)}
              title={
                judge
                  ? "A judge panel reviews every rendered screenshot (recommended)."
                  : "Automated checks only. Nobody will look at the rendered screenshots."
              }
            >
              <span className="jt-track" aria-hidden>
                <span className="jt-knob" />
              </span>
              {judge ? (
                <>
                  <Eye size={12} aria-hidden /> <span className="jt-state">On</span> · Screenshots Reviewed
                </>
              ) : (
                <>
                  <EyeOff size={12} aria-hidden /> <span className="jt-state">Off</span> · Checks Only
                </>
              )}
            </button>
            {!judge && (
              <div className="launch-warn">
                <AlertTriangle size={11} aria-hidden /> The scorecard will say nothing about how the renders actually
                look. Automated checks only.
              </div>
            )}
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-judge-harness-label">
              Judge Harness <code className="launch-flag">--judge-harness</code>
            </div>
            <div className="launch-steppers" role="radiogroup" aria-labelledby="launch-judge-harness-label">
              {judgeHarnesses.map((a) => {
                const spec = harnessSpec(a);
                const textOnly = spec ? !spec.multimodal : false;
                return (
                  <button
                    key={a}
                    className={`lk-chip lk-harness${judgeHarness === a ? " on" : ""}`}
                    role="radio"
                    aria-checked={judgeHarness === a}
                    disabled={!judge}
                    onClick={() => {
                      setJudgeHarness(a);
                      setJudgeModel("");
                      setJudgeVariant((v) =>
                        v && !effortLevelsFor(harnessSpec(a), "").includes(v) ? "" : v
                      );
                    }}
                    title={spec?.vision_note ?? `Judge via the ${harnessLabel(a)} harness`}
                  >
                    {harnessLabel(a)}
                    {textOnly && <span className="lk-chip-note">text-only</span>}
                  </button>
                );
              })}
            </div>
            {judge && judgeHarnessSpec && !judgeHarnessSpec.multimodal && (
              <div className="launch-hint">
                {harnessLabel(judgeHarness)} models are text-only here, so screenshot judging reroutes each image call
                to {harnessLabel(judgeHarnessSpec.vision_fallback_to ?? "codex")} automatically.
              </div>
            )}
          </div>

          <div className="launch-field">
            <label className="launch-model">
              <span className="launch-label">
                Judge Model <code className="launch-flag">--judge-model</code>
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
                {judgeHarnessModels.map((m) => (
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
                  title={`Judge reasoning effort: ${effortLabel(lv)}`}
                >
                  {effortLabel(lv)}
                </button>
              ))}
            </div>
            <div className="launch-hint">
              How much reasoning each judge call spends. Auto uses the harness default
              {judgeHarnessSpec ? ` (${effortLabel(judgeHarnessSpec.default_effort)})` : ""}.
            </div>
          </div>

          <div className="launch-field">
            <div className="launch-label" id="launch-judges-label">
              Judges <code className="launch-flag">--n-judges</code>
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
                  title={`${n}-judge panel`}
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
                  title={n === 1 ? "One case at a time" : `${n} cases judged in parallel`}
                >
                  {n === 1 ? "1 · Serial" : `${n}×`}
                </button>
              ))}
            </div>
            <div className="launch-hint">
              How many cases the Visual Judge works at once. Each case still gets its own {nJudges}-judge panel; the
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
                value={bundleRoot}
                onChange={(e) => setBundleRoot(e.target.value)}
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
              disabled={busy || selectedCount === 0}
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
                    ? `Judging on · ${nJudges}-judge panel · ${
                        concurrency > 1 ? `${concurrency} cases in parallel` : "one case at a time"
                      } · ${harnessLabel(judgeHarness)} harness · model ${
                        judgeModel || "auto"
                      } · effort ${judgeVariant ? effortLabel(judgeVariant) : "auto"} (real LLM calls per case)`
                    : "Checks only · no judge calls"}
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
          {liveRunning && <div className="launch-note">A run is already in progress. Parallel runs are fine.</div>}
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
      <div className="le-title">No Eval Run in Progress</div>
      <div className="le-sub">
        Launch a baseline audit below, or start the optimization loop from a terminal. Either way, every phase and
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
  const failedRuns = useMemo(() => runs.filter((r) => r.status === "failed"), [runs]);
  const stalledRuns = useMemo(() => runs.filter((r) => r.status === "stalled"), [runs]);

  return (
    <div className="overview dashboard-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Run Studies</div>
          <div className="dash-sub">
            Launch eval runs against the CLI and watch their real-time progress: phases, trials, and journal, straight
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
        Eval run in progress: <strong>{liveRunTitle(run)}</strong>
        <span className="mono">
          {" "}
          {run.kind === "audit" ? (run.judge ? "Checks + Judge" : "Checks Only") : run.kind === "baseline" ? "Baseline" : run.iteration}
        </span>
        {run.current_phase_label ? ` · ${run.current_phase_label}` : ""}
      </span>
      <span className="lnb-bar">
        <LiveProgressBar run={run} slim />
      </span>
      <span className="mono lnb-pct">{pct}%</span>
      <span className="lnb-cta">
        Watch Live <ArrowRight size={11} aria-hidden />
      </span>
    </button>
  );
}
