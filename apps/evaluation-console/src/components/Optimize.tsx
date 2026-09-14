import { useState } from "react";
import { Activity, Play, Terminal } from "lucide-react";
import { useStore } from "../store";
import type { IterationSummary, JournalEvent, ScenarioDetail } from "../types";
import { harnessLabel, modelShort, relativeTime } from "../lib/format";
import { LoopBadge, Pct, ProvGlyph, ScenarioChip } from "./primitives";
import { LivePhasePipeline, LiveProgressBar } from "./Live";

/** The loaded iteration's recorded codegen provenance — or an honest "unrecorded". */
function IterationProvenanceChips() {
  const { iterationDetail } = useStore();
  if (!iterationDetail) return null;
  const p = iterationDetail.provenance;
  if (!p || (!p.harness && !p.model_id)) {
    return (
      <span
        className="prov-unrecorded"
        title="This iteration's generated metas carry no harness or model stamp (they predate provenance stamping)."
      >
        Provenance unrecorded
      </span>
    );
  }
  return (
    <span className="iter-prov" title="Recorded by the iteration's codegen metas">
      {p.harness ? (
        <span className="harness-pill" data-harness={p.harness}>
          <span className="harness-dot" data-harness={p.harness} aria-hidden />
          {harnessLabel(p.harness)}
        </span>
      ) : (
        <span className="harness-pill unrecorded">Harness ?</span>
      )}
      <span className="mono">{modelShort(p.model_id)}</span>
      {p.model_variant && <span className="effort-chip">@{p.model_variant}</span>}
      {p.mixed && (
        <span className="prov-mixed" title="Scenarios within this iteration disagree on provenance.">
          Mixed!
        </span>
      )}
    </span>
  );
}

/* ============================================================================
   OPTIMIZE — launch + live-loop monitor (DESIGN-SPEC §4c). The handoff launch
   is explicit; every progress surface below remains read-only over the real
   optimization artifacts the store loads via selectSkill / selectIteration.
   Three columns: ITERATION LOG (commit history) · PIPELINE TRAIN (journal 1:1)
   · SCENARIO BOARD (+ journal tail). The right inspector is the skill summary.
   ============================================================================ */

const TRAIN_STEPS = [
  "proposer",
  "skills_adapter",
  "browser_runner",
  "judges",
  "decision",
  "report",
  "archive"
] as const;

const TRAIN_STEP_LABELS: Record<(typeof TRAIN_STEPS)[number], string> = {
  proposer: "Propose",
  skills_adapter: "Prepare Skill",
  browser_runner: "Render",
  judges: "Visual Tests",
  decision: "Decide",
  report: "Report",
  archive: "Archive"
};

type CarState = "done" | "run" | "fail" | "pending";

interface CarStatus {
  state: CarState;
  error?: string;
}

/** Derive each pipeline car's state 1:1 from the journal's step events. */
function carStatuses(journal: JournalEvent[]): Record<string, CarStatus> {
  const out: Record<string, CarStatus> = {};
  for (const step of TRAIN_STEPS) out[step] = { state: "pending" };
  for (const e of journal) {
    const step = e.step;
    if (!step || !(step in out)) continue;
    if (e.event === "step_failed") {
      const err =
        (typeof e.error === "string" && e.error) ||
        (e.result && typeof (e.result as Record<string, unknown>).error === "string"
          ? ((e.result as Record<string, unknown>).error as string)
          : undefined);
      out[step] = { state: "fail", error: err };
    } else if (e.event === "step_completed" && out[step].state !== "fail") {
      out[step] = { state: "done" };
    } else if (e.event === "step_started" && out[step].state === "pending") {
      out[step] = { state: "run" };
    }
  }
  return out;
}

function wlt(it: IterationSummary): string {
  const c = it.counts;
  return `W${c.wins} L${c.losses} T${c.ties}`;
}

function journalError(event: JournalEvent | undefined): string | null {
  if (!event) return null;
  if (typeof event.error === "string" && event.error.trim()) return event.error.trim();
  const result = event.result;
  return result && typeof result.error === "string" && result.error.trim() ? result.error.trim() : null;
}

/** ITERATION LOG — git-style commit history, newest first, baseline at foot. */
function IterationLog() {
  const { selectedSkillData, selectedIterationId, selectIteration } = useStore();
  const history = selectedSkillData?.history ?? [];
  const nonBaseline = history.filter((h) => !h.is_baseline).slice().reverse();
  const baseline = history.find((h) => h.is_baseline) ?? null;

  return (
    <div className="panel">
      <div className="panel-head">Iteration Log</div>
      <div className="panel-body">
        {nonBaseline.length === 0 && !baseline && (
          <div className="empty-note">No iterations recorded for this skill.</div>
        )}
        {nonBaseline.map((it) => {
          const sel = it.iteration === selectedIterationId;
          const failed = it.status === "failed";
          const isNewest = it === nonBaseline[0];
          return (
            <div
              key={it.iteration}
              className={`commit${sel ? " sel" : ""}`}
              onClick={() => selectIteration(it.iteration)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectIteration(it.iteration);
                }
              }}
              role="button"
              tabIndex={0}
              title={it.rationale ?? undefined}
            >
              <span className="c-iter">{it.iteration}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", minWidth: 0 }}>
                {isNewest && (
                  <span
                    className="fresh-chip latest"
                    title={it.finished_utc ? `Most recent round · finished ${relativeTime(it.finished_utc)}` : "Most recent round"}
                  >
                    latest
                  </span>
                )}
                {failed ? (
                  <span style={{ color: "var(--fail)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span aria-hidden>✗</span>
                    <span className="mono" style={{ fontSize: "var(--fs-50)" }}>
                      {it.failed_step ?? "failed"}
                    </span>
                  </span>
                ) : (
                  <>
                    <LoopBadge decision={it.decision ?? "TIE"} rule={it.rule_fired} />
                    {it.rule_fired && (
                      <span
                        className="mono"
                        style={{
                          fontSize: "var(--fs-50)",
                          color: "var(--text-3)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {it.rule_fired}
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="c-wlt">{wlt(it)}</span>
            </div>
          );
        })}
        {baseline && (
          <div
            className={`commit${baseline.iteration === selectedIterationId ? " sel" : ""}`}
            onClick={() => selectIteration(baseline.iteration)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectIteration(baseline.iteration);
              }
            }}
            role="button"
            tabIndex={0}
            title={baseline.error ?? "Baseline preparation for the current best skill"}
          >
            <span className="c-iter">{baseline.iteration}</span>
            {baseline.status === "failed" ? (
              <span className="iteration-failed">
                <span aria-hidden>✗</span>
                {baseline.failed_step?.replace(/^baseline_/, "").replaceAll("_", " ") ?? "failed"}
              </span>
            ) : baseline.status === "running" ? (
              <span className="iteration-running">● Preparing baseline</span>
            ) : baseline.status === "stalled" ? (
              <span className="iteration-stalled">Baseline stalled</span>
            ) : (
              <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
                Baseline ready
              </span>
            )}
            <span className="c-wlt">{baseline.status === "baseline" ? "ready" : baseline.status}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** PIPELINE TRAIN — 7 cars derived 1:1 from the journal. */
function PipelineTrain() {
  const { iterationDetail, iterationLoading } = useStore();
  if (iterationLoading) {
    return (
      <div className="panel">
        <div className="panel-head">Pipeline Train</div>
        <div className="panel-body">
          <div className="empty-note">Loading journal…</div>
        </div>
      </div>
    );
  }
  if (!iterationDetail) {
    return (
      <div className="panel">
        <div className="panel-head">Pipeline Train</div>
        <div className="panel-body">
          <div className="empty-note">No iteration selected.</div>
        </div>
      </div>
    );
  }
  const cars = carStatuses(iterationDetail.journal);
  return (
    <div className="panel">
      <div className="panel-head">Pipeline Train</div>
      <div className="panel-body">
        <div className="train">
          {TRAIN_STEPS.map((step) => {
            const c = cars[step];
            return (
              <div key={step} className={`car ${c.state}`}>
                <span className="car-dot" aria-hidden />
                <span style={{ flex: 1, minWidth: 0 }}>{TRAIN_STEP_LABELS[step]}</span>
                {c.state === "fail" && c.error && <span className="car-err">{c.error}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const JOURNAL_TAIL = 8;

/** SCENARIO BOARD — per-scenario verdicts + a live journal tail. */
function ScenarioBoard() {
  const { iterationDetail, iterationLoading, selectedScenarioIndex, selectScenario } = useStore();

  if (iterationLoading) {
    return (
      <div className="panel">
        <div className="panel-head">Scenario Board</div>
        <div className="panel-body">
          <div className="empty-note">Loading scenarios…</div>
        </div>
      </div>
    );
  }
  if (!iterationDetail) {
    return (
      <div className="panel">
        <div className="panel-head">Scenario Board</div>
        <div className="panel-body">
          <div className="empty-note">No iteration selected.</div>
        </div>
      </div>
    );
  }

  const scenarios = iterationDetail.scenarios;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const s of scenarios) {
    if (s.verdict === "CANDIDATE") wins += 1;
    else if (s.verdict === "BASELINE") losses += 1;
    else if (s.verdict === "TIE") ties += 1;
  }
  const tail = iterationDetail.journal.slice(-JOURNAL_TAIL);

  return (
    <div className="panel">
      <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-2)" }}>
        <span>Scenario board · {scenarios.length}</span>
        <span className="mono" style={{ letterSpacing: 0, textTransform: "none" }}>
          W{wins} L{losses} T{ties}
        </span>
      </div>
      <div className="panel-body">
        {scenarios.length === 0 ? (
          <div className="empty-note">No scenario runs captured yet.</div>
        ) : (
          <div className="scn-board">
            {scenarios.map((s: ScenarioDetail, i) => (
              <div
                key={s.dir}
                className={`scn-line${i === selectedScenarioIndex ? " sel" : ""}`}
                onClick={() => selectScenario(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectScenario(i);
                  }
                }}
                role="button"
                tabIndex={0}
                title={s.label}
              >
                <span className="scn-name">{s.scenario_id}</span>
                <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
                  {s.checks.passed}/{s.checks.total}
                </span>
                <ScenarioChip verdict={s.verdict} count={s.majority_count} />
              </div>
            ))}
          </div>
        )}

        {tail.length > 0 && (
          <>
            <div
              className="panel-head"
              style={{ border: "none", padding: "var(--sp-3) 0 var(--sp-2)" }}
            >
              Journal
            </div>
            {tail.map((e, i) => {
              const failed = typeof e.event === "string" && e.event.endsWith("_failed");
              const ts = typeof e.timestamp_utc === "string" ? e.timestamp_utc.slice(11, 19) : "";
              return (
                <div key={i} className={`journal-line${failed ? " fail" : ""}`}>
                  {ts && <span>{ts}</span>}
                  <span className="jl-ev">{e.event}</span>
                  {e.step && <span>{e.step}</span>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

/** Optimize owns its own live lane. It reuses the journal-driven phase
 * geometry from Run, but only receives optimization rows from the store. */
function OptimizationLivePanel() {
  const { optimizationRuns, optimizationLaunch, selectedSkill, selectSkill } = useStore();
  const active = optimizationRuns.filter((run) => run.status === "running");
  const failed = optimizationRuns.filter((run) => run.status === "failed");
  const stalled = optimizationRuns.filter((run) => run.status === "stalled");
  const focusedFailure = failed.find((run) => run.skill === selectedSkill) ?? failed[0] ?? null;
  const visibleFailed = focusedFailure ? [focusedFailure] : [];
  const visibleRuns = [...active, ...stalled, ...visibleFailed];
  const primary = active[0] ?? focusedFailure ?? stalled[0] ?? null;

  if (!optimizationLaunch && visibleRuns.length === 0) return null;

  return (
    <section className="optimization-live-panel" aria-label="Optimization progress">
      <div className="optimization-live-head">
        <span className="optimization-live-title">
          <Activity size={14} aria-hidden />
          Optimization activity
        </span>
        <span className="spacer" />
        <span
          className={`optimization-live-state${active.length || optimizationLaunch ? " on" : ""}${failed.length ? " failed" : ""}`}
        >
          {active.length
            ? `${active.length} ${active.length === 1 ? "round" : "rounds"} running`
            : optimizationLaunch
              ? "Dispatcher running"
              : failed.length
                ? `${failed.length} failed`
                : `${stalled.length} stalled`}
        </span>
      </div>

      {optimizationLaunch && visibleRuns.length === 0 && (
        <div className="optimization-launch-pending">
          <span className="optimization-orbit" aria-hidden>
            <span />
          </span>
          <div>
            <strong>Dispatcher started</strong>
            <div>
              Waiting for the first iteration journal · {optimizationLaunch.skills.length}{" "}
              {optimizationLaunch.skills.length === 1 ? "skill" : "skills"} queued
            </div>
          </div>
        </div>
      )}

      {visibleRuns.map((run) => {
        const pct = Math.round(run.progress * 100);
        const running = run.status === "running";
        return (
          <button
            key={`${run.kind}/${run.skill}/${run.iteration}`}
            className={`optimization-live-row ${run.status}`}
            onClick={() => selectSkill(run.skill)}
            title={`Open ${run.skill} ${run.iteration}`}
          >
            <span className="optimization-orbit" aria-hidden>
              <span />
            </span>
            <span className="optimization-live-copy">
              <span className="optimization-live-name">
                <strong>{run.skill.replace("cesiumjs-", "")}</strong>
                <span className="mono">{run.kind === "baseline" ? "baseline" : run.iteration}</span>
              </span>
              <span className="optimization-live-meta">
                {running ? "Running" : run.status === "failed" ? "Failed" : "Stalled"}
                {run.current_phase_label ? ` · ${run.current_phase_label}` : " · preparing"}
                {run.last_activity_utc ? ` · ${relativeTime(run.last_activity_utc)}` : ""}
              </span>
            </span>
            <span className="optimization-live-progress">
              <LiveProgressBar run={run} slim />
              <span className="mono">{pct}%</span>
            </span>
            <LivePhasePipeline run={run} />
          </button>
        );
      })}
      {failed.length > visibleFailed.length && (
        <div className="optimization-failure-overflow">
          +{failed.length - visibleFailed.length} more failed skills · select them in the skill rail for their journals
        </div>
      )}
      {primary && (
        <div className={`optimization-journal${primary.status === "failed" ? " failed" : ""}`}>
          <div className="optimization-journal-head">
            <span>
              Event log · {primary.skill.replace("cesiumjs-", "")} ·{" "}
              {primary.kind === "baseline" ? "baseline preparation" : `candidate round ${primary.iteration}`}
            </span>
            <span className="mono">updates live</span>
          </div>
          {primary.status === "failed" && (
            <div className="optimization-error" role="alert">
              <strong>Optimization stopped before a candidate decision.</strong>
              <span>{primary.error ?? journalError(primary.journal_tail.at(-1)) ?? "No error detail was recorded."}</span>
            </div>
          )}
          <div className="optimization-journal-lines" aria-live="polite">
            {primary.journal_tail.slice(-10).map((event, index) => {
              const isFailure = event.event.endsWith("_failed");
              const ts = event.timestamp_utc?.slice(11, 19) ?? "";
              return (
                <div
                  className={`journal-line${isFailure ? " fail" : ""}`}
                  key={`${event.timestamp_utc ?? ""}/${index}`}
                >
                  {ts && <span>{ts}</span>}
                  <span className="jl-ev">{event.event}</span>
                  {event.step && <span>{event.step}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function OptimizeStage() {
  const {
    selectedOptimizationQueueSkill,
    selectedSkillData,
    caseViews,
    optimizationRuns,
    optimizationRunning,
    lastHandoff,
    handoffPanelVisible,
    dismissHandoff,
    showHandoff,
    pushToast,
    startOptimization
  } = useStore();
  const [launching, setLaunching] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const handoffSkillCount = lastHandoff
    ? new Set(lastHandoff.caseKeys.map((key) => key.split("/")[0]).filter(Boolean)).size
    : 0;
  const launchCommand = lastHandoff ? `${lastHandoff.command} \\\n  --concurrency ${concurrency}` : "";

  /* The handoff is deliberately two-step: Review transfers the focus, then
     Optimize visibly starts the configured agents. The exact terminal command
     remains available as a transparent fallback. */
  const handoffPanel = !lastHandoff ? null : handoffPanelVisible ? (
    <div className="handoff-panel" role="region" aria-label="Optimizer handoff">
      <div className="handoff-head">
        <span>
          {lastHandoff.count} flagged {lastHandoff.count === 1 ? "case" : "cases"} across {handoffSkillCount}{" "}
          {handoffSkillCount === 1 ? "skill" : "skills"} ready to optimize →{" "}
          <span className="mono">{lastHandoff.focus_path.split("/").slice(-2).join("/")}</span>
        </span>
        <span className="spacer" />
        <button className="pill" onClick={dismissHandoff} aria-label="Dismiss handoff panel">
          ×
        </button>
      </div>
      <div className="handoff-body">
        <div className="handoff-summary">
          The focus is transferred. Start the configured optimization agents here; any KEEP candidate will stop at
          Promote for your approval.
        </div>
        <label className="handoff-concurrency">
          <span>Parallel skills</span>
          <select
            value={concurrency}
            disabled={launching || optimizationRunning}
            onChange={(event) => setConcurrency(Number(event.target.value))}
          >
            {[1, 2, 3, 4].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          className="handoff-start"
          disabled={launching || optimizationRunning}
          onClick={async () => {
            setLaunching(true);
            try {
              await startOptimization(concurrency);
            } finally {
              setLaunching(false);
            }
          }}
        >
          <Play size={13} fill="currentColor" aria-hidden />
          {optimizationRunning ? "Optimization running" : launching ? "Starting…" : "Start optimization"}
        </button>
        <details className="handoff-terminal">
          <summary>
            <Terminal size={12} aria-hidden /> Terminal fallback
          </summary>
          <pre className="mono handoff-cmd">{launchCommand}</pre>
          <button
            className="pill"
            onClick={() => {
              navigator.clipboard
                .writeText(launchCommand)
                .then(() => pushToast("Command copied to clipboard", "good"))
                .catch(() => pushToast(`Copy failed. Command: ${launchCommand}`, "bad"));
            }}
          >
            Copy command
          </button>
        </details>
      </div>
    </div>
  ) : (
    <button className="handoff-collapsed" onClick={showHandoff}>
      <Play size={12} aria-hidden />
      {lastHandoff.count} queued {lastHandoff.count === 1 ? "case" : "cases"} · Show handoff and start controls
    </button>
  );

  if (!selectedOptimizationQueueSkill) {
    return (
      <main className="stage col optimize-stage" role="main">
        {handoffPanel}
        <OptimizationLivePanel />
        <div className="empty-note">Send flagged Review cases to Optimize to create a queue.</div>
      </main>
    );
  }

  const focus = selectedOptimizationQueueSkill.queuedCaseKeys;
  const caseByKey = new Map(caseViews.map((item) => [item.key, item]));
  const focusCases = focus.map((key) => ({ key, view: caseByKey.get(key) ?? null }));

  const focusPanel = focus.length > 0 ? (
    <section className="queue-focus panel" aria-label={`${focus.length} queued Review cases`}>
      <div className="panel-head">
        Review focus · {focus.length} {focus.length === 1 ? "case" : "cases"} queued
      </div>
      <div className="queue-focus-list">
        {focusCases.map(({ key, view }) => (
          <div className="queue-focus-case" key={key}>
            <span className="queue-focus-mark" aria-hidden />
            <span className="queue-focus-main">
              <span className="queue-focus-name">{view?.case_name || view?.case_id || key.split("/").slice(1).join("/")}</span>
              <span className="queue-focus-id mono">{view?.case_id || key.split("/").slice(1).join("/")}</span>
            </span>
            <span className="queue-focus-signals">
              {view ? (
                <>
                  <span className={`queue-signal ${view.result === "fail" ? "bad" : "good"}`}>
                    Code {view.result}
                  </span>
                  <span
                    className={`queue-signal ${
                      view.visualStatus === "fail"
                        ? "bad"
                        : view.visualStatus === "needs_review"
                          ? "warn"
                          : "good"
                    }`}
                  >
                    Visual {view.visualStatus.replace("_", " ")}
                  </span>
                  <span className="queue-source">{view.source === "human" ? "confirmed" : "suggested"}</span>
                </>
              ) : (
                <span className="queue-source">persisted focus</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  ) : null;

  if (!selectedSkillData) {
    return (
      <main className="stage col optimize-stage" role="main">
        {handoffPanel}
        <OptimizationLivePanel />
        <div className="stage-head">
          <div>
            <div className="stage-title">{selectedOptimizationQueueSkill.skill.replace("cesiumjs-", "")}</div>
            <div className="stage-sub">
              <span>
                {focus.length} flagged {focus.length === 1 ? "case" : "cases"} transferred
              </span>
              <span>· Ready for its first optimization round</span>
            </div>
          </div>
          <span className="pill queue-ready-pill">Queued</span>
        </div>
        {focusPanel}
        <div className="queue-awaiting">
          This skill is in the Optimize workflow now. Start optimization above to create its first iteration; no
          agent has been started by the transfer itself.
        </div>
      </main>
    );
  }

  const selectedSkillRunning = optimizationRuns.some(
    (run) => run.skill === selectedSkillData.skill && run.status === "running"
  );
  const selectedBaseline = selectedSkillData.history.find((item) => item.is_baseline) ?? null;

  return (
    <main className="stage col optimize-stage" role="main">
      {handoffPanel}
      <OptimizationLivePanel />
      <div className="stage-head">
        <div>
          <div className="stage-title">{selectedSkillData.skill.replace("cesiumjs-", "")}</div>
          <div className="stage-sub">
            <span>
              {selectedSkillData.iteration_count} completed candidate{" "}
              {selectedSkillData.iteration_count === 1 ? "round" : "rounds"}
            </span>
            <span>· {selectedSkillData.kept} Kept</span>
            <span>· {selectedSkillData.rejected} Rejected</span>
            {selectedSkillData.latest?.finished_utc && (
              <span
                title={`Newest iteration (${selectedSkillData.latest.iteration}) finished ${new Date(
                  selectedSkillData.latest.finished_utc
                ).toLocaleString()}. Everything below is this skill's full history, newest first.`}
              >
                · latest round {relativeTime(selectedSkillData.latest.finished_utc)}
              </span>
            )}
            <IterationProvenanceChips />
            {(selectedSkillData.running || selectedSkillRunning) && (
              <span style={{ color: "var(--live)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ProvGlyph kind="live" /> Running
              </span>
            )}
          </div>
        </div>
        {selectedSkillData.latest?.decision && (
          <LoopBadge decision={selectedSkillData.latest.decision} rule={selectedSkillData.latest.rule_fired} />
        )}
      </div>

      {selectedBaseline?.status === "failed" && (
        <div className="optimization-baseline-failure" role="alert">
          <strong>Baseline preparation failed; no candidate iteration was started.</strong>
          <span>
            {selectedBaseline.error ??
              `The ${selectedBaseline.failed_step?.replace(/^baseline_/, "").replaceAll("_", " ") ?? "baseline"} step failed.`}
          </span>
        </div>
      )}

      {focusPanel ?? (
        <div className="chasing">
          <ProvGlyph kind="human" />
          <span>No Review focus is queued, so the loop is exploratory.</span>
        </div>
      )}

      <div className="loop-cols">
        <IterationLog />
        <PipelineTrain />
        <ScenarioBoard />
      </div>
    </main>
  );
}

export function OptimizeInspector() {
  const { selectedOptimizationQueueSkill, selectedSkillData, iterationDetail } = useStore();

  if (!selectedSkillData) {
    if (selectedOptimizationQueueSkill) {
      const queued = selectedOptimizationQueueSkill.queuedCaseKeys;
      return (
        <aside className="inspector col" aria-label="Skill summary">
          <div className="band human">
            <div className="band-head">
              ◈ review queue
              <span className="bh-score">
                <span className="pill queue-ready-pill">Queued</span>
              </span>
            </div>
            <div className="band-body">
              <div className="intent">
                {selectedOptimizationQueueSkill.skill.replace("cesiumjs-", "")} is ready for its first optimization
                round.
              </div>
              <div className="queue-inspector-count">
                <span className="mono">{queued.length}</span> transferred {queued.length === 1 ? "case" : "cases"}
              </div>
              <div className="queue-inspector-list">
                {queued.map((key) => (
                  <span className="mono" key={key}>
                    {key.split("/").slice(1).join("/")}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="band">
            <div className="band-head">▣ loop status</div>
            <div className="band-body">
              <div className="empty-note" style={{ padding: "var(--sp-2)", textAlign: "left" }}>
                No iteration artifacts yet. Transferring focus does not start an agent; use Start optimization when
                you are ready.
              </div>
            </div>
          </div>
        </aside>
      );
    }
    return (
      <aside className="inspector col" aria-label="Skill summary">
        <div className="empty-note">No skill selected.</div>
      </aside>
    );
  }

  const latest = selectedSkillData.latest;
  // Prefer the loaded iteration's scores; fall back to the latest summary's.
  const scores = iterationDetail?.scores ?? latest?.scores ?? null;
  const md = selectedSkillData.skill_md;

  return (
    <aside className="inspector col" aria-label="Skill summary">
      <div className="band machine">
        <div className="band-head">
          ▣ loop verdict · machine
          <span className="bh-score">
            {latest?.decision ? (
              <LoopBadge decision={latest.decision} rule={latest.rule_fired} />
            ) : (
              <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
                no decision
              </span>
            )}
          </span>
        </div>
        <div className="band-body">
          {latest?.rule_fired && (
            <div className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-2)", marginBottom: "var(--sp-2)" }}>
              {latest.rule_fired}
            </div>
          )}
          {latest?.rationale ? (
            <div className="intent">{latest.rationale}</div>
          ) : (
            <div className="empty-note" style={{ padding: "var(--sp-2)", textAlign: "left" }}>
              No rationale recorded.
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: "var(--sp-3)",
              marginTop: "var(--sp-3)",
              fontSize: "var(--fs-50)",
              color: "var(--text-3)"
            }}
          >
            <span>
              <span className="mono" style={{ color: "var(--keep)" }}>{selectedSkillData.kept}</span> Kept
            </span>
            <span>
              <span className="mono" style={{ color: "var(--reject)" }}>{selectedSkillData.rejected}</span> Rejected
            </span>
          </div>
        </div>
      </div>

      <div className="band machine">
        <div className="band-head">▣ scores</div>
        <div className="band-body">
          <ScoreRow label="Code Tests" value={scores?.programmatic ?? null} />
          <ScoreRow label="api accuracy" value={scores?.api ?? null} />
          <ScoreRow label="Visual Test Win Rate" value={scores?.visual_win_rate ?? null} />
        </div>
      </div>

      <div className="band eye">
        <div className="band-head">◈ skill.md</div>
        <div className="band-body">
          {md.exists ? (
            <div className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-2)" }}>
              {md.lines ?? "—"} lines · {md.bytes ?? "—"} bytes
            </div>
          ) : (
            <div className="empty-note" style={{ padding: "var(--sp-2)", textAlign: "left" }}>
              No SKILL.md on disk.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-2)",
        padding: "5px 0",
        fontSize: "var(--fs-100)",
        color: "var(--text-2)"
      }}
    >
      <span>{label}</span>
      <Pct value={value} label={label} />
    </div>
  );
}
