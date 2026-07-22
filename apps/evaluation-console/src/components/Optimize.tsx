import { useStore } from "../store";
import type { IterationSummary, JournalEvent, ScenarioDetail } from "../types";
import { harnessLabel, modelShort, relativeTime } from "../lib/format";
import { LoopBadge, Pct, ProvGlyph, ScenarioChip } from "./primitives";

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
   OPTIMIZE — live-loop monitor (DESIGN-SPEC §4c). Read-only over the real
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
          <div className="commit" style={{ cursor: "default", opacity: 0.7 }} title="Baseline (current best)">
            <span className="c-iter">{baseline.iteration}</span>
            <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
              Baseline
            </span>
            <span className="c-wlt">{wlt(baseline)}</span>
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
                <span style={{ flex: 1, minWidth: 0 }}>{step}</span>
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

export function OptimizeStage() {
  const { selectedSkill, selectedSkillData, confirmedFlagKeys, lastHandoff, dismissHandoff, pushToast } = useStore();

  /* The server generates the exact seeded CLI command on every handoff — the
     bridge from Review flags to a running loop is this panel, not recall. */
  const handoffPanel = lastHandoff ? (
    <div className="handoff-panel" role="region" aria-label="Optimizer handoff">
      <div className="handoff-head">
        <span>
          ⚑ {lastHandoff.count} confirmed {lastHandoff.count === 1 ? "flag" : "flags"} handed off →{" "}
          <span className="mono">{lastHandoff.focus_path.split("/").slice(-2).join("/")}</span>
        </span>
        <span className="spacer" />
        <button className="pill" onClick={dismissHandoff} aria-label="Dismiss handoff panel">
          ×
        </button>
      </div>
      <div className="handoff-body">
        <span>Run the seeded loop from a terminal:</span>
        <pre className="mono handoff-cmd">{lastHandoff.command}</pre>
        <button
          className="pill"
          onClick={() => {
            navigator.clipboard
              .writeText(lastHandoff.command)
              .then(() => pushToast("Command copied to clipboard", "good"))
              .catch(() => pushToast(`Copy failed. Command: ${lastHandoff.command}`, "bad"));
          }}
        >
          Copy command
        </button>
      </div>
    </div>
  ) : null;

  if (!selectedSkillData) {
    return (
      <main className="stage col" role="main">
        {handoffPanel}
        <div className="empty-note">Pick a skill on the rail to watch its optimization loop.</div>
      </main>
    );
  }

  // confirmedFlagKeys are "skill/case_id" — keep only this skill's human focus.
  const focus = selectedSkill
    ? confirmedFlagKeys.filter((k) => k.split("/")[0] === selectedSkill)
    : [];

  return (
    <main className="stage col" role="main">
      {handoffPanel}
      <div className="stage-head">
        <div>
          <div className="stage-title">{selectedSkillData.skill.replace("cesiumjs-", "")}</div>
          <div className="stage-sub">
            <span>{selectedSkillData.iteration_count} Iterations</span>
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
            {selectedSkillData.running && (
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

      <div className="chasing">
        <ProvGlyph kind="human" />
        {focus.length === 0 ? (
          <span>No human focus yet, so the loop is exploratory</span>
        ) : (
          <>
            <span style={{ marginRight: "var(--sp-1)" }}>Chasing your flags:</span>
            {focus.map((k) => (
              <span key={k} className="mono" style={{ fontSize: "var(--fs-50)" }}>
                {k.split("/").slice(1).join("/")}
              </span>
            ))}
          </>
        )}
      </div>

      <div className="loop-cols">
        <IterationLog />
        <PipelineTrain />
        <ScenarioBoard />
      </div>
    </main>
  );
}

export function OptimizeInspector() {
  const { selectedSkillData, iterationDetail } = useStore();

  if (!selectedSkillData) {
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
          <ScoreRow label="programmatic" value={scores?.programmatic ?? null} />
          <ScoreRow label="api accuracy" value={scores?.api ?? null} />
          <ScoreRow label="visual win rate" value={scores?.visual_win_rate ?? null} />
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
