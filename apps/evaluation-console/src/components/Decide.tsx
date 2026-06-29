import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { artifactUrl } from "../api";
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

function DiffViewer({ scn }: { scn: ScenarioDetail }) {
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
  const showCand = swiping || blinkShowCand;

  return (
    <div className="diff">
      <div className="diff-stageframe" ref={frameRef}>
        {!baseline && !candidate ? (
          <div className="empty-note">No renders captured for this scenario.</div>
        ) : (
          <>
            {/* BASELINE fills the frame. Hidden in blink while the candidate flashes. */}
            {baseline ? (
              <div
                className="diff-img"
                style={diffMode === "blink" && blinkShowCand && candidate ? { visibility: "hidden" } : undefined}
              >
                <img src={artifactUrl(baseline)} alt={`baseline · ${scn.label}`} loading="lazy" />
              </div>
            ) : (
              <div className="empty-note">baseline render missing</div>
            )}
            <span className="diff-tag base">baseline (best)</span>

            {/* CANDIDATE — clipped to swipePos in swipe mode, flashed in blink mode. */}
            {candidate ? (
              <div
                className="diff-clip"
                style={{
                  width: swiping ? `${swipePos}%` : "100%",
                  visibility: showCand ? "visible" : "hidden"
                }}
              >
                <div className="diff-img">
                  <img src={artifactUrl(candidate)} alt={`candidate · ${scn.label}`} loading="lazy" />
                </div>
              </div>
            ) : (
              <span className="diff-tag cand">candidate missing</span>
            )}
            {candidate && <span className="diff-tag cand">candidate</span>}

            {swiping && candidate && baseline && (
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
                  }
                }}
                tabIndex={0}
                role="slider"
                aria-label="reveal candidate vs baseline"
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
          <button className={diffMode === "blink" ? "on" : ""} onClick={() => setDiffMode("blink")}>
            blink
          </button>
        </span>
        <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)", marginLeft: "auto" }}>
          [ ] scenario
        </span>
      </div>
    </div>
  );
}

export function DecideStage() {
  const { iterationDetail, selectedScenarioIndex } = useStore();
  const scn = iterationDetail?.scenarios[selectedScenarioIndex];

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
          </div>
        </div>
        <ScenarioChip verdict={scn.verdict} count={scn.majority_count} />
      </div>

      <DiffViewer scn={scn} />
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
        Visual judges unavailable for this scenario — the programmatic ledger is the evidence.
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

      <div className="authorized">
        <span className="prov-glyph pg-human" aria-hidden>⚑</span>
        authorized by your review flag
      </div>
    </aside>
  );
}
