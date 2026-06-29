import { useStore } from "../store";
import { LoopBadge, MetaTag, Pill } from "./primitives";
import type { IterationSummary, SkillOverview } from "../types";

/** ▣ / ◈ / ⚑ ink law (P3): steel for the machine, amber for the eye, magenta for the human flag. */

function shortSkill(skill: string): string {
  return skill.replace("cesiumjs-", "");
}

/** Per-iteration history tick class — keep / reject / baseline / failed. */
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
          {s.kept} kept
        </span>
        <span className="mono" style={{ color: "var(--reject)" }}>
          · {s.rejected} rejected
        </span>
        <span>· {s.iteration_count} iter</span>
      </div>
      <div className="st-hist">
        {ticks.length === 0 ? (
          <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
            no iterations yet
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

export function EvaluateOverview() {
  const { scorecard, counts, needsYouCount, confirmedFlagKeys, skills, setStation, selectSkill } =
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
      <div className="ov-hero">
        <div>
          <div className="ov-big" style={{ color: pass ? "var(--pass)" : "var(--fail)" }}>
            {pass ? "PASS" : "FAIL"}
          </div>
          <div className="stage-sub" style={{ marginTop: "var(--sp-3)" }}>
            <span className="mono">{scorecard.runId}</span>
            <MetaTag k="commit" v={scorecard.gitCommit.slice(0, 7) || "—"} />
            <MetaTag k="score" v={`${Math.round(scorecard.overallScore * 100)}%`} />
            <MetaTag k="threshold" v={`${Math.round(scorecard.threshold * 100)}%`} />
          </div>
        </div>
        <button
          onClick={() => setStation("review")}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "1px solid var(--hairline-strong)",
            borderRadius: "var(--r-2)",
            color: needsYouCount > 0 ? "var(--ink-human)" : "var(--text-2)",
            padding: "var(--sp-2) var(--sp-4)",
            cursor: "pointer",
            fontSize: "var(--fs-100)"
          }}
        >
          {needsYouCount > 0 ? (
            <>
              <span aria-hidden>⚑ </span>
              {needsYouCount} {needsYouCount === 1 ? "case needs" : "cases need"} your eyes → press 2 for Review
            </>
          ) : (
            <>Nothing needs your eyes → press 2 for Review</>
          )}
        </button>
      </div>

      {/* Decision distribution only — accept/flag/defer sum to total. "Not reviewed"
          is a separate visual-status axis (it would double-count here), shown as a note. */}
      <div className="ov-distribution" aria-label="decision distribution">
        <span className="seg-accept" style={seg(counts.accept)} title={`accept ${counts.accept}`} />
        <span className="seg-flag" style={seg(counts.flag)} title={`flag ${counts.flag}`} />
        <span className="seg-defer" style={seg(counts.defer)} title={`defer ${counts.defer}`} />
      </div>
      <div className="stage-sub" style={{ marginBottom: "var(--sp-5)" }}>
        <span style={{ color: "var(--pass)" }}>● accept {counts.accept}</span>
        <span style={{ color: "var(--fail)" }}>● flag {counts.flag}</span>
        <span style={{ color: "var(--defer)" }}>● defer {counts.defer}</span>
        <span style={{ color: "var(--text-3)" }}>· {Math.round((counts.accept / total) * 100)}% accepted</span>
        {counts.neutral > 0 && (
          <span style={{ color: "var(--unknown)" }}>· {counts.neutral} not visually reviewed</span>
        )}
      </div>

      <div className="cards">
        <div className="card">
          <div className="card-k">total cases</div>
          <div className="card-v mono">{counts.total}</div>
        </div>
        <div className="card">
          <div className="card-k">need you</div>
          <div className="card-v mono" style={{ color: needsYouCount > 0 ? "var(--ink-human)" : undefined }}>
            {needsYouCount}
          </div>
        </div>
        <div className="card">
          <div className="card-k">→ focus</div>
          <div className="card-v mono">{confirmedFlagKeys.length}</div>
        </div>
        <div className="card">
          <div className="card-k">skills</div>
          <div className="card-v mono">{skills.length}</div>
        </div>
        <div className="card">
          <div className="card-k">kept</div>
          <div className="card-v mono" style={{ color: "var(--keep)" }}>{kept}</div>
        </div>
        <div className="card">
          <div className="card-k">rejected</div>
          <div className="card-v mono" style={{ color: "var(--reject)" }}>{rejected}</div>
        </div>
      </div>

      <div className="section-title">
        Skill health
        <span className="section-sub">click a skill → Optimize</span>
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
  );
}

export function PromotePanel() {
  const { skills, pushToast } = useStore();

  const promotable = skills.filter((s) => s.latest?.decision === "KEEP");

  return (
    <div className="overview">
      <div className="section-title" style={{ marginTop: 0 }}>
        Promote
        <span className="section-sub">guarded — promotion is a deliberate manual step</span>
      </div>

      {promotable.length === 0 ? (
        <div className="empty-note">No KEEP candidates awaiting promotion.</div>
      ) : (
        <div className="skill-grid">
          {promotable.map((s) => {
            const it = s.latest!;
            const c = it.counts;
            const cmd = `python3 optimization/scripts/run-loop.py ${s.skill} --promote`;
            return (
              <div key={s.skill} className="skill-tile" style={{ cursor: "default" }}>
                <div className="st-top">
                  <span className="st-name">{shortSkill(s.skill)}</span>
                  <LoopBadge decision="KEEP" rule={it.rule_fired} />
                </div>
                <div className="stage-sub" style={{ marginTop: "var(--sp-2)" }}>
                  <MetaTag k="iter" v={it.iteration} />
                  <span className="mono" style={{ color: "var(--keep)" }}>{c.wins}W</span>
                  <span className="mono" style={{ color: "var(--reject)" }}>· {c.losses}L</span>
                  <span className="mono" style={{ color: "var(--text-3)" }}>· {c.ties}T</span>
                  {s.skill_md.exists && s.skill_md.lines != null && (
                    <span>· SKILL.md {s.skill_md.lines} lines</span>
                  )}
                </div>
                <div
                  style={{
                    marginTop: "var(--sp-3)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-2)",
                    flexWrap: "wrap"
                  }}
                >
                  <button
                    onClick={() => pushToast(`Guarded: run  ${cmd}`, "info")}
                    style={{
                      background: "none",
                      border: "1px solid var(--hairline-strong)",
                      borderRadius: "var(--r-pill)",
                      color: "var(--text)",
                      padding: "var(--sp-1) var(--sp-3)",
                      cursor: "pointer",
                      fontSize: "var(--fs-100)"
                    }}
                  >
                    <span aria-hidden>⚑ </span>Promote candidate → SKILL.md
                  </button>
                  <Pill tone="machine">guarded</Pill>
                </div>
                <div
                  className="mono"
                  style={{
                    marginTop: "var(--sp-2)",
                    fontSize: "var(--fs-50)",
                    color: "var(--text-3)",
                    userSelect: "all"
                  }}
                >
                  {cmd}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
