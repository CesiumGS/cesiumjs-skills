import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { artifactUrl } from "../api";
import { relativeTime } from "../lib/format";
import type { IterationDetail, ScenarioDetail } from "../types";
import { LoopBadge, ScenarioChip } from "./primitives";

/* The 5-rule cascade, in the exact order the loop evaluates them (decision.json
   `rule_fired` matches one of these names). DESIGN-SPEC §4(d). */
const RUNGS: { name: string; label: string }[] = [
  { name: "rule_1_check_failure", label: "check failure" },
  { name: "rule_2_critical_judge_loss", label: "critical judge loss" },
  { name: "rule_3_more_wins", label: "net wins" },
  { name: "rule_4_more_losses", label: "net losses" },
  { name: "rule_5_tie_keep_current", label: "tie → keep current" }
];

function DiffViewer({ scn, roundLabel }: { scn: ScenarioDetail; roundLabel?: string }) {
  const { diffMode, swipePos, setSwipePos, setDiffMode } = useStore();
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [blinkShowCand, setBlinkShowCand] = useState(false);

  const baseline = scn.baseline_screenshots[0];
  const candidate = scn.candidate_screenshots[0];

  // Blink mode: alternate baseline / candidate on a ~600ms beat.
  useEffect(() => {
    if (diffMode !== "blink") {
      setBlinkShowCand(false);
      return;
    }
    const id = window.setInterval(() => setBlinkShowCand((s) => !s), 600);
    return () => window.clearInterval(id);
  }, [diffMode, scn.dir]);

  // Swipe drag geometry — translate cursor x within the frame into a 0..100 %.
  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = frameRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      setSwipePos(((clientX - rect.left) / rect.width) * 100);
    },
    [setSwipePos]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateFromClientX]);

  const onHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    updateFromClientX(e.clientX);
  };

  const swiping = diffMode === "swipe";
  const blinking = diffMode === "blink";
  const showCand = swiping || blinkShowCand;
  const canSwipe = swiping && Boolean(baseline) && Boolean(candidate);

  /* Identity plates: dim whichever side is (mostly) hidden right now, and in
     blink mode light the one currently on screen so a glance answers
     "which frame am I looking at?" */
  const baseDim = blinking ? blinkShowCand : canSwipe && swipePos < 12;
  const candDim = blinking ? !blinkShowCand : canSwipe && swipePos > 88;
  const frameCls = `diff-stageframe${canSwipe ? " swiping" : ""}${
    blinking && candidate ? (blinkShowCand ? " blink-cand" : " blink-base") : ""
  }`;

  // Scrub from anywhere in the frame — not just the 2px divider.
  const onFrameDown = (e: React.MouseEvent) => {
    if (!canSwipe) return;
    e.preventDefault();
    draggingRef.current = true;
    updateFromClientX(e.clientX);
  };

  return (
    <div className="diff">
      <div className={frameCls} ref={frameRef} onMouseDown={onFrameDown} onDoubleClick={() => canSwipe && setSwipePos(50)}>
        {!baseline && !candidate ? (
          <div className="empty-note">No renders captured for this scenario.</div>
        ) : (
          <>
            {/* BASELINE fills the frame; in swipe mode it owns the LEFT of the divider.
                Hidden in blink while the candidate flashes. */}
            {baseline ? (
              <div
                className="diff-img"
                style={blinking && blinkShowCand && candidate ? { visibility: "hidden" } : undefined}
              >
                <img src={artifactUrl(baseline)} alt={`baseline · ${scn.label}`} loading="lazy" />
              </div>
            ) : (
              <div className="empty-note">baseline render missing</div>
            )}

            {/* CANDIDATE — same geometry as the baseline, clip-path revealed from the
                RIGHT of the divider in swipe mode (never resized), flashed in blink mode. */}
            {candidate && (
              <div
                className="diff-clip"
                style={{
                  clipPath: canSwipe ? `inset(0 0 0 ${swipePos}%)` : undefined,
                  visibility: showCand ? "visible" : "hidden"
                }}
              >
                <div className="diff-img">
                  <img src={artifactUrl(candidate)} alt={`candidate · ${scn.label}`} loading="lazy" />
                </div>
              </div>
            )}

            {/* Identity plates — baseline anchored left, candidate anchored right,
                matching the swipe geometry (left of handle = baseline). */}
            <span className={`diff-plate base${baseDim ? " dim" : ""}${blinking && !blinkShowCand ? " lit" : ""}`}>
              <span className="dp-dot" aria-hidden />
              <span className="dp-name">Baseline</span>
              <span className="dp-sub">current best</span>
            </span>
            {candidate ? (
              <span className={`diff-plate cand${candDim ? " dim" : ""}${blinking && blinkShowCand ? " lit" : ""}`}>
                <span className="dp-dot" aria-hidden />
                <span className="dp-name">Candidate</span>
                {roundLabel && <span className="dp-sub">round {roundLabel}</span>}
              </span>
            ) : (
              <span className="diff-plate cand missing">
                <span className="dp-dot" aria-hidden />
                <span className="dp-name">Candidate missing</span>
              </span>
            )}

            {canSwipe && (
              <div
                className="diff-handle"
                style={{ left: `${swipePos}%` }}
                onMouseDown={onHandleDown}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 1 : 5;
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setSwipePos(swipePos - step);
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setSwipePos(swipePos + step);
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setSwipePos(0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setSwipePos(100);
                  }
                }}
                tabIndex={0}
                role="slider"
                aria-label="comparison divider — baseline left, candidate right"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(swipePos)}
              />
            )}
          </>
        )}
      </div>

      <div className="diff-toolbar">
        <span className="seg">
          <button className={swiping ? "on" : ""} onClick={() => setDiffMode("swipe")}>
            swipe
          </button>
          <button className={blinking ? "on" : ""} onClick={() => setDiffMode("blink")}>
            blink
          </button>
        </span>

        {/* Live legend: in swipe, how the frame is split; in blink, which side is showing. */}
        {(baseline || candidate) && (
          <span className="diff-readout mono" aria-live="polite">
            {blinking && candidate ? (
              <>
                showing&nbsp;
                <b className={blinkShowCand ? "cand" : "base"}>{blinkShowCand ? "candidate" : "baseline"}</b>
              </>
            ) : canSwipe ? (
              <>
                <b className="base">baseline {Math.round(swipePos)}%</b>
                <span className="sep">⇆</span>
                <b className="cand">{100 - Math.round(swipePos)}% candidate</b>
              </>
            ) : null}
          </span>
        )}

        <span className="mono diff-hint">
          {blinking ? "auto-flipping every 600ms · [ ] scenario" : "drag to compare · dbl-click recenters · [ ] scenario"}
        </span>
      </div>
    </div>
  );
}

export function DecideStage() {
  const { iterationDetail, selectedScenarioIndex, selectedSkillData } = useStore();
  const scn = iterationDetail?.scenarios[selectedScenarioIndex];

  // Freshness: is the loaded iteration this skill's most recent round, or history?
  const newest = selectedSkillData?.history
    .slice()
    .reverse()
    .find((h) => !h.is_baseline);
  const isLatestRound = newest != null && iterationDetail != null && newest.iteration === iterationDetail.iteration;

  if (!iterationDetail) {
    return (
      <main className="stage col" role="main">
        <div className="empty-note">Enter Optimize and pick a skill to decide on its candidate.</div>
      </main>
    );
  }
  if (!scn) {
    return (
      <main className="stage col" role="main">
        <div className="empty-note">This iteration produced no scenario runs to diff.</div>
      </main>
    );
  }

  return (
    <main className="stage col" role="main">
      <div className="stage-head">
        <div>
          <div className="stage-title">{scn.label}</div>
          <div className="stage-sub">
            <span className="mono">{scn.scenario_id}</span>
            <span>· candidate vs baseline</span>
            <span className="mono">· {iterationDetail.iteration}</span>
            {iterationDetail.finished_utc && <span>· ran {relativeTime(iterationDetail.finished_utc)}</span>}
            {newest != null &&
              (isLatestRound ? (
                <span className="fresh-chip latest" title="You are deciding on this skill's most recent optimization round.">
                  Latest Round
                </span>
              ) : (
                <span
                  className="fresh-chip stale"
                  title={`An older round is loaded. The most recent is ${newest.iteration}${
                    newest.finished_utc ? ` (finished ${relativeTime(newest.finished_utc)})` : ""
                  }; pick it in the Optimize iteration log.`}
                >
                  Older Round · Latest: {newest.iteration}
                </span>
              ))}
          </div>
        </div>
        <ScenarioChip verdict={scn.verdict} count={scn.majority_count} />
      </div>

      <DiffViewer scn={scn} roundLabel={iterationDetail.iteration} />
    </main>
  );
}

function Cascade({ iterationDetail }: { iterationDetail: IterationDetail }) {
  const fired = iterationDetail.rule_fired;
  const keep = iterationDetail.decision === "KEEP";
  return (
    <div className="ladder">
      {RUNGS.map((r) => {
        const isFired = r.name === fired;
        const cls = isFired ? `rung fired${keep ? " keep" : ""}` : "rung";
        return (
          <div key={r.name} className={cls}>
            <span>{r.label}</span>
            <span className="rung-name">{r.name}</span>
            <span className="rung-state">{isFired ? "FIRED ▮" : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

function Judges({ scn }: { scn: ScenarioDetail }) {
  if (scn.judge_unavailable || scn.individual_verdicts.length === 0) {
    return (
      <div className="empty-note" style={{ padding: "var(--sp-2)" }}>
        Visual judges unavailable for this scenario, so the programmatic ledger is the evidence.
      </div>
    );
  }
  return (
    <div className="judges">
      {scn.individual_verdicts.map((v, i) => (
        <div className="judge" key={i}>
          <span className="j-seed">{v.seed != null ? `seed ${v.seed}` : `j${v.judge_index ?? i}`}</span>
          <ScenarioChip verdict={v.verdict} />
          <span
            title={v.rationale ?? undefined}
            style={{
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {v.rationale ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DecideInspector() {
  const { iterationDetail, selectedScenarioIndex } = useStore();

  if (!iterationDetail) {
    return <aside className="inspector col" aria-label="Decision inspector" />;
  }
  const scn = iterationDetail.scenarios[selectedScenarioIndex];

  return (
    <aside className="inspector col" aria-label="Decision inspector">
      <div className="band">
        <div className="band-head">
          decision <span className="bh-score"><LoopBadge decision={iterationDetail.decision ?? "TIE"} rule={iterationDetail.rule_fired} /></span>
        </div>
        <div className="band-body">
          {iterationDetail.rationale ? (
            <div className="intent" style={{ color: "var(--text-2)" }}>{iterationDetail.rationale}</div>
          ) : (
            <div style={{ color: "var(--text-3)", fontStyle: "italic", fontSize: "var(--fs-100)" }}>
              No rationale recorded for this iteration.
            </div>
          )}
        </div>
      </div>

      <div className="band">
        <div className="band-head">decision cascade · lit rung = fired</div>
        <div className="band-body">
          <Cascade iterationDetail={iterationDetail} />
        </div>
      </div>

      <div className="band eye">
        <div className="band-head">◈ 3 judges · candidate-relative</div>
        <div className="band-body">{scn ? <Judges scn={scn} /> : <div className="empty-note">No scenario selected.</div>}</div>
      </div>

      {/* Seed provenance: only claim human authorization when the proposer was
          actually seeded by a handed-in decision record — never by default. */}
      {iterationDetail.proposer_seed?.explicit === true ? (
        <div className="authorized" title={iterationDetail.proposer_seed.decision_path ?? undefined}>
          <span className="prov-glyph pg-human" aria-hidden>⚑</span>
          seeded by your review flags
        </div>
      ) : iterationDetail.proposer_seed?.explicit === false ? (
        <div className="authorized machine">
          <span className="prov-glyph pg-machine" aria-hidden>▣</span>
          machine-initiated run
        </div>
      ) : (
        <div className="authorized machine">
          <span className="prov-glyph" aria-hidden>◌</span>
          seed provenance unrecorded (older run)
        </div>
      )}
    </aside>
  );
}
