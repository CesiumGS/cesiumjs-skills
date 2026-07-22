import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Copy } from "lucide-react";
import { useStore } from "../store";
import { harnessLabel, modelShort, relativeTime } from "../lib/format";
import { LoopBadge, MetaTag, Pill, UnknownChip } from "./primitives";
import type { BaselineDiff, IterationSummary, SkillOverview } from "../types";

/** ▣ / ◈ / ⚑ ink law (P3): steel for the machine, amber for the eye, magenta for the human flag. */

function shortSkill(skill: string): string {
  return skill.replace("cesiumjs-", "");
}

/** Per-iteration history tick class: keep / reject / baseline / failed. */
function histTickClass(h: IterationSummary): string {
  if (h.is_baseline) return "baseline";
  if (h.status === "failed") return "failed";
  if (h.decision === "KEEP") return "keep";
  if (h.decision === "REJECT") return "reject";
  return "baseline";
}

function SkillTile({ s, onClick }: { s: SkillOverview; onClick: () => void }) {
  const ticks = s.history.slice(-8);
  return (
    <div
      className="skill-tile"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="st-top">
        <span className="st-name">{shortSkill(s.skill)}</span>
        {s.latest && <LoopBadge decision={s.latest.decision ?? "TIE"} rule={s.latest.rule_fired} />}
      </div>
      <div className="stage-sub" style={{ marginTop: "var(--sp-2)" }}>
        <span className="mono" style={{ color: "var(--keep)" }}>
          {s.kept} Kept
        </span>
        <span className="mono" style={{ color: "var(--reject)" }}>
          · {s.rejected} Rejected
        </span>
        <span>· {s.iteration_count} Iterations</span>
      </div>
      <div className="st-hist">
        {ticks.length === 0 ? (
          <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
            No iterations yet
          </span>
        ) : (
          ticks.map((h) => (
            <span
              key={h.iteration}
              className={`hist-tick ${histTickClass(h)}`}
              title={`${h.is_baseline ? "baseline" : h.iteration} · ${h.decision ?? h.status}`}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Score bar with a threshold notch: the pass/fail geometry made visible. */
function ScoreVsThreshold({ score, threshold }: { score: number; threshold: number }) {
  const pct = Math.round(score * 100);
  const tPct = Math.round(threshold * 100);
  const ok = score >= threshold;
  return (
    <div className="score-thresh" title={`Overall ${pct}% vs threshold ${tPct}%`}>
      <div className="st-track">
        <span className={`st-fill${ok ? "" : " under"}`} style={{ width: `${pct}%` }} />
        <span className="st-notch" style={{ left: `${tPct}%` }} title={`Threshold ${tPct}%`} />
      </div>
      <span className="mono st-nums">
        ▣ {pct}% <span className="st-vs">/ {tPct}%</span>
      </span>
    </div>
  );
}

/** Signed score delta vs the comparison baseline: steel magnitude, diverging arrow. */
function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return <UnknownChip small text="No baseline score" />;
  const pp = Math.round(delta * 100);
  if (pp === 0) return <span className="delta-chip flat" title="Unchanged vs baseline">= 0pp</span>;
  const up = pp > 0;
  return (
    <span className={`delta-chip ${up ? "up" : "down"}`} title="Overall score vs the comparison baseline">
      {up ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
      {up ? "+" : "−"}
      {Math.abs(pp)}pp
    </span>
  );
}

/** One "what changed" bucket card: count + drill into the exact cases. */
function DiffCard({
  label,
  keys,
  tone,
  hint,
  onDrill
}: {
  label: string;
  keys: string[];
  tone: "good" | "bad" | "warn" | "neutral";
  hint: string;
  onDrill: () => void;
}) {
  const empty = keys.length === 0;
  return (
    <button className={`diff-card ${tone}${empty ? " empty" : ""}`} onClick={onDrill} disabled={empty} title={hint}>
      <span className="dc-count mono">{keys.length}</span>
      <span className="dc-label">{label}</span>
    </button>
  );
}

function ChangedVsBaseline({ diff }: { diff: BaselineDiff | null }) {
  const { baselineRun, baselineRunId, baselineLoading, runs, setBaselineRun, setCaseScope, setStation, scorecard, caseViews } =
    useStore();

  const incompleteKeys = useMemo(
    () =>
      caseViews
        .filter((v) => v.visualStatus === "not_reviewed" || v.visualStatus === "needs_review")
        .map((v) => v.key),
    [caseViews]
  );

  const drill = (label: string, keys: string[]) => {
    setCaseScope({ label, keys });
    setStation("review");
  };

  const otherRuns = runs.filter((r) => r.run_id !== scorecard?.runId);

  return (
    <>
      <div className="section-title">
        Changed vs Baseline
        <span className="section-sub">Deterministic result flips between the two runs. Click a card to open the exact cases.</span>
        <span className="spacer" />
        <label className="baseline-pick">
          <span>Baseline</span>
          <select
            value={baselineRunId ?? ""}
            onChange={(e) => setBaselineRun(e.target.value || null)}
            title="The comparison run this run is diffed against"
          >
            <option value="">None</option>
            {otherRuns.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id.slice(0, 34)} · {harnessLabel(r.harness ?? "unknown")} · {r.timestamp_utc.slice(0, 16).replace("T", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!baselineRunId ? (
        <div className="empty-note">No comparison baseline selected. Pick an earlier run above to see what changed.</div>
      ) : baselineLoading ? (
        <div className="empty-note">Loading baseline cases…</div>
      ) : !diff ? (
        <div className="empty-note">Could not load the baseline run's cases.</div>
      ) : (
        <>
          <div className="diff-cards">
            <DiffCard label="Regressed" keys={diff.regressed} tone="bad" hint="Passed in the baseline, fails now. The first thing to look at." onDrill={() => drill(`Regressed vs ${diff.baselineRunId.slice(0, 24)}`, diff.regressed)} />
            <DiffCard label="Fixed" keys={diff.fixed} tone="good" hint="Failed in the baseline, passes now." onDrill={() => drill(`Fixed vs ${diff.baselineRunId.slice(0, 24)}`, diff.fixed)} />
            <DiffCard label="Still Failing" keys={diff.stillFailing} tone="warn" hint="Failed in both runs." onDrill={() => drill("Still failing", diff.stillFailing)} />
            <DiffCard label="New Cases" keys={diff.added} tone="neutral" hint="Cases only the current run has." onDrill={() => drill("New cases", diff.added)} />
            {/* Removed cases have no current evidence to open — render a plain
                summary, not a control that promises a drill-down it can't do. */}
            <div
              className="diff-card neutral diff-card-static"
              title="Cases only the baseline had. They have no evidence in the current run, so there is nothing to open here."
            >
              <span className="dc-count mono">{diff.removed.length}</span>
              <span className="dc-label">Removed · baseline-only</span>
            </div>
            <DiffCard label="Incomplete" keys={incompleteKeys} tone="warn" hint="Visual verdict still missing (not reviewed or needs review). Absence of evidence, not a failure." onDrill={() => drill("Incomplete visual review", incompleteKeys)} />
          </div>
          {baselineRun && (
            <div className="baseline-meta stage-sub">
              Baseline <span className="mono">{baselineRun.run_id}</span>
              <MetaTag k="commit" v={baselineRun.git_commit.slice(0, 7) || "—"} />
              <MetaTag k="harness" v={baselineRun.harness ?? "unknown"} />
              {typeof baselineRun.overall_score === "number" && (
                <MetaTag k="score" v={`${Math.round(baselineRun.overall_score * 100)}%`} />
              )}
              <span style={{ color: "var(--text-3)" }}>{relativeTime(baselineRun.timestamp_utc)}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Where this run came from and how to reproduce its configuration. */
function ProvenanceCard() {
  const { scorecard, config, pushToast } = useStore();
  const [copied, setCopied] = useState(false);
  if (!scorecard) return null;

  const harness = scorecard.harness;
  const model = scorecard.model;
  const judge = scorecard.harnessJudge ?? (config?.harness_judge || null);

  const lines = [
    `git checkout ${scorecard.gitCommit || "<commit unrecorded>"}`,
    harness && harness !== "unknown" ? `export AGENT_HARNESS=${harness}` : `# harness unrecorded by this run`,
    model
      ? `# codegen model: ${model}${scorecard.modelVariant ? ` @ ${scorecard.modelVariant}` : ""}`
      : `# codegen model unrecorded by this run`,
    `node packages/eval/bin/cesium-eval.js score \\`,
    `  ${harness && harness !== "unknown" ? `--harness ${harness} ` : ""}${model ? `--model ${model} ` : ""}${scorecard.modelVariant ? `--model-variant ${scorecard.modelVariant} ` : ""}--threshold ${scorecard.threshold}`
  ];
  const cmd = lines.join("\n");

  const copy = () => {
    navigator.clipboard
      .writeText(cmd)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => pushToast("Clipboard unavailable", "bad"));
  };

  const chip = (k: string, v: string | null, unrecorded = "Not recorded") =>
    v ? <MetaTag k={k} v={v} /> : (
      <span className="meta-tag unrecorded" title={`${k}: this run did not record it.`}>
        <span className="meta-k">{k}</span>
        <span className="meta-v">{unrecorded}</span>
      </span>
    );

  return (
    <>
      <div className="section-title">
        Provenance &amp; Reproduce
        <span className="section-sub">What produced these numbers. Unrecorded values stay visibly unrecorded.</span>
      </div>
      <div className="prov-card">
        <div className="prov-chips">
          {chip("commit", scorecard.gitCommit ? scorecard.gitCommit.slice(0, 12) : null)}
          {chip("when", scorecard.timestampUtc ? `${scorecard.timestampUtc.slice(0, 16).replace("T", " ")} (${relativeTime(scorecard.timestampUtc)})` : null)}
          {chip("harness", harness !== "unknown" ? harness : null)}
          {chip("model", model ? `${modelShort(model)}${scorecard.modelVariant ? ` @${scorecard.modelVariant}` : ""}` : null)}
          {chip("judge", judge)}
          {chip("mode", scorecard.visualReviewSupplied ? "A · det + visual" : "B · det-only")}
          {chip("schema", scorecard.schemaVersion || null)}
          {chip("threshold", `${Math.round(scorecard.threshold * 100)}%`)}
        </div>
        <div className="prov-repro">
          <pre className="mono">{cmd}</pre>
          <button className="pill" onClick={copy} title="Copy the reproduce sketch">
            <Copy size={12} aria-hidden /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="prov-note">
          Reproduce sketch, not a replay: evidence inputs (cases root, fixture set) live with the original
          scorecard at <span className="mono">{config?.scorecard_path?.replace(config.repo_root + "/", "") ?? "—"}</span>.
        </div>
      </div>
    </>
  );
}

export function EvaluateOverview() {
  const { scorecard, counts, needsYouCount, confirmedFlagKeys, skills, setStation, selectSkill, diff } =
    useStore();

  if (!scorecard) {
    return (
      <div className="overview">
        <div className="empty-note">No scorecard loaded yet.</div>
      </div>
    );
  }

  const pass = scorecard.overallResult === "pass";
  const total = counts.total || 1;
  const seg = (n: number) => ({ flexGrow: n, flexBasis: 0 });

  const kept = skills.reduce((acc, s) => acc + s.kept, 0);
  const rejected = skills.reduce((acc, s) => acc + s.rejected, 0);

  return (
    <div className="overview">
      <div className="dash-head">
        <div>
          <div className="dash-title">Evaluation Health</div>
          <div className="dash-sub">
            The loaded run at a glance: verdict, what changed vs the baseline, and where these numbers came from.
          </div>
        </div>
      </div>

      {/* HERO — the verdict with its gates named, beside the score geometry. */}
      <div className="hero-card">
        <div>
          <div className="ov-big" style={{ color: pass ? "var(--pass)" : "var(--fail)" }}>
            {pass ? "PASS" : "FAIL"}
            <DeltaChip delta={diff?.scoreDelta ?? null} />
          </div>
          <div className="gate-chips" aria-label="Verdict composition">
            <span className={`gate-chip ${scorecard.deterministicResult === "pass" ? "ok" : "bad"}`}>
              ▣ Deterministic {scorecard.deterministicResult.toUpperCase()}
            </span>
            {scorecard.visualReviewSupplied ? (
              <span
                className={`gate-chip ${pass || scorecard.deterministicResult === "fail" ? (pass ? "ok" : "neutral") : "bad"}`}
                title="The visual judge gate. Blocking failures fail the run even at a passing deterministic score."
              >
                ◈ Visual {pass ? "PASS" : scorecard.deterministicResult === "pass" ? "FAIL, the gate that failed" : "FAIL"}
              </span>
            ) : (
              <span className="gate-chip neutral" title="Mode B: no visual review supplied">
                ◈ Visual not reviewed
              </span>
            )}
          </div>
          <ScoreVsThreshold score={scorecard.overallScore} threshold={scorecard.threshold} />
          <div className="stage-sub" style={{ marginTop: "var(--sp-3)" }}>
            <span className="mono">{scorecard.runId}</span>
            <MetaTag k="Commit" v={scorecard.gitCommit.slice(0, 7) || "—"} />
            <span style={{ color: "var(--text-3)" }}>{relativeTime(scorecard.timestampUtc)}</span>
          </div>
        </div>
        <div className="hero-right">
          <button className={`review-cta${needsYouCount > 0 ? " hot" : ""}`} onClick={() => setStation("review")}>
            {needsYouCount > 0 ? (
              <>
                <span aria-hidden>⚑ </span>
                {needsYouCount} {needsYouCount === 1 ? "case needs" : "cases need"} your eyes → Review (2)
              </>
            ) : (
              <>Nothing needs your eyes → Review (2)</>
            )}
          </button>
          <div style={{ width: "100%" }}>
            <div className="ov-distribution" aria-label="Decision distribution">
              <span className="seg-accept" style={seg(counts.accept)} title={`Accept ${counts.accept}`} />
              <span className="seg-flag" style={seg(counts.flag)} title={`Flag ${counts.flag}`} />
              <span className="seg-defer" style={seg(counts.defer)} title={`Defer ${counts.defer}`} />
            </div>
            <div className="stage-sub" style={{ marginTop: "var(--sp-2)", justifyContent: "flex-end" }}>
              <span style={{ color: "var(--pass)" }}>● Accept {counts.accept}</span>
              <span style={{ color: "var(--fail)" }}>● Flag {counts.flag}</span>
              <span style={{ color: "var(--defer)" }}>● Defer {counts.defer}</span>
              <span style={{ color: "var(--text-3)" }}>· {Math.round((counts.accept / total) * 100)}% accepted</span>
            </div>
            {counts.neutral > 0 && (
              <div className="stage-sub" style={{ justifyContent: "flex-end" }}>
                <span style={{ color: "var(--unknown)" }}>{counts.neutral} not visually reviewed</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <span className="kpi-label">Total Cases</span>
          <span className="kpi-value">{counts.total}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Need You</span>
          <span className="kpi-value" style={{ color: needsYouCount > 0 ? "var(--ink-human)" : undefined }}>
            {needsYouCount}
          </span>
          <span className="kpi-sub">Failing or ambiguous</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Focus Set</span>
          <span className="kpi-value">{confirmedFlagKeys.length}</span>
          <span className="kpi-sub">Flags for the optimizer</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Skills</span>
          <span className="kpi-value">{skills.length}</span>
          <span className="kpi-sub">Under optimization</span>
        </div>
        <div className="kpi good">
          <span className="kpi-label">Kept</span>
          <span className="kpi-value">{kept}</span>
          <span className="kpi-sub">Iterations promoted</span>
        </div>
        <div className="kpi bad">
          <span className="kpi-label">Rejected</span>
          <span className="kpi-value">{rejected}</span>
          <span className="kpi-sub">Iterations discarded</span>
        </div>
      </div>

      <div className="dash-card">
        <ChangedVsBaseline diff={diff} />
      </div>
      <div className="dash-card">
        <ProvenanceCard />
      </div>

      <div className="dash-card">
        <div className="section-title">
          Skill Health
          <span className="section-sub">Click a skill to open it in Optimize.</span>
        </div>
        {skills.length === 0 ? (
          <div className="empty-note">No optimization runs on disk yet.</div>
        ) : (
          <div className="skill-grid">
            {skills.map((s) => (
              <SkillTile
                key={s.skill}
                s={s}
                onClick={() => {
                  selectSkill(s.skill);
                  setStation("optimize");
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PromotePanel() {
  const { skills, promoteSkillCandidate, pushToast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  const withKeep = skills.filter((s) => s.latest?.decision === "KEEP");
  const staged = withKeep.filter((s) => s.latest?.promotion === "staged");
  const promoted = withKeep.filter((s) => s.latest?.promotion === "promoted");
  const unknown = withKeep.filter((s) => !s.latest?.promotion || s.latest?.promotion === "unknown");

  const copyCmd = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      pushToast("Command copied to clipboard", "good");
    } catch {
      pushToast(`Copy failed. Command: ${cmd}`, "bad");
    }
  };

  const promote = async (skill: string, iteration: string) => {
    setBusy(`${skill}/${iteration}`);
    try {
      await promoteSkillCandidate(skill, iteration);
    } finally {
      setBusy(null);
    }
  };

  const card = (s: (typeof skills)[number], body: React.ReactNode) => {
    const it = s.latest!;
    const c = it.counts;
    return (
      <div key={s.skill} className="skill-tile" style={{ cursor: "default" }}>
        <div className="st-top">
          <span className="st-name">{shortSkill(s.skill)}</span>
          <LoopBadge decision="KEEP" rule={it.rule_fired} />
        </div>
        {body}
        <div className="stage-sub" style={{ marginTop: "var(--sp-2)" }}>
          <MetaTag k="iter" v={it.iteration} />
          <span className="mono" style={{ color: "var(--keep)" }}>{c.wins}W</span>
          <span className="mono" style={{ color: "var(--reject)" }}>· {c.losses}L</span>
          <span className="mono" style={{ color: "var(--text-3)" }}>· {c.ties}T</span>
          {s.skill_md.exists && s.skill_md.lines != null && <span>· SKILL.md {s.skill_md.lines} lines</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="overview">
      <div className="section-title" style={{ marginTop: 0 }}>
        Promote
        <span className="section-sub">
          The human gate: a KEEP candidate is only <em>staged</em> by the loop; nothing touches a live SKILL.md until you
          promote it here (or run the CLI command). The current version is archived first.
        </span>
      </div>

      <div className="section-title">Pending promotion</div>
      {staged.length === 0 ? (
        <div className="empty-note">Nothing staged. KEEP candidates appear here awaiting your approval.</div>
      ) : (
        <div className="skill-grid">
          {staged.map((s) => {
            const it = s.latest!;
            const cmd = `node packages/eval/bin/cesium-eval.js optimize promote ${s.skill} ${it.iteration}`;
            const key = `${s.skill}/${it.iteration}`;
            return card(
              s,
              <div style={{ marginTop: "var(--sp-2)" }}>
                <div style={{ fontSize: "var(--fs-100)", color: "var(--text-2)", lineHeight: 1.5 }}>
                  Staged candidate <span className="mono">{it.iteration}</span> awaits your approval
                  {it.finished_utc ? ` (won ${relativeTime(it.finished_utc)})` : ""}. The live{" "}
                  <span className="mono">skills/{s.skill}/SKILL.md</span> is untouched.
                </div>
                <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)", flexWrap: "wrap" }}>
                  <button className="promote-btn" disabled={busy === key} onClick={() => void promote(s.skill, it.iteration)}>
                    {busy === key ? "Promoting…" : `Promote ${it.iteration} → live`}
                  </button>
                  <button className="pill" onClick={() => void copyCmd(cmd)} title={cmd}>
                    Copy CLI command
                  </button>
                </div>
                <div style={{ marginTop: "var(--sp-2)" }}>
                  <Pill tone="human">awaiting your approval</Pill>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="section-title">Promoted</div>
      {promoted.length === 0 ? (
        <div className="empty-note">No promoted candidates yet. Approved promotions land here with their archive record.</div>
      ) : (
        <div className="skill-grid">
          {promoted.map((s) => {
            const it = s.latest!;
            return card(
              s,
              <div style={{ marginTop: "var(--sp-2)", fontSize: "var(--fs-100)", color: "var(--text-2)", lineHeight: 1.5 }}>
                Updated <span className="mono">skills/{s.skill}/SKILL.md</span> from the{" "}
                <span className="mono">{it.iteration}</span> candidate
                {it.finished_utc ? ` (won ${relativeTime(it.finished_utc)})` : ""}. Previous version archived as{" "}
                <span className="mono">current-best-before.md</span>.
                <div style={{ marginTop: "var(--sp-3)" }}>
                  <Pill tone="machine">promoted</Pill>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unknown.length > 0 && (
        <>
          <div className="section-title">Unverified state</div>
          <div className="dash-sub" style={{ marginBottom: "var(--sp-3)" }}>
            These KEEPs carry neither a staging marker nor a promotion archive; the console will not guess. Inspect{" "}
            <span className="mono">optimization/history/&lt;skill&gt;/</span> to confirm what shipped.
          </div>
          <div className="skill-grid">
            {unknown.map((s) =>
              card(
                s,
                <div style={{ marginTop: "var(--sp-2)" }}>
                  <Pill tone="neutral">promotion state unknown</Pill>
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
