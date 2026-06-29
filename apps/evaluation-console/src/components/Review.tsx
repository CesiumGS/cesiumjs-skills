import { useStore } from "../store";
import { artifactUrl } from "../api";
import type { AdaptedDimension, CaseView, RawCheck } from "../types";
import { dimensionShortLabel } from "../lib/adapt";
import { dimToneClass } from "../lib/dimtone";
import {
  DecisionChip,
  MetaTag,
  Score01,
  Score10,
  StatusGlyph,
  UnknownChip
} from "./primitives";

function jsonInline(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function CheckRow({ c }: { c: RawCheck }) {
  const cls = c.critical ? "check crit" : "check fail";
  return (
    <div className={cls}>
      <StatusGlyph state={c.critical ? "crit" : "fail"} />
      <div>
        <div className="c-id">
          {c.check_id}
          {c.critical && <span className="c-crit-tag">CRITICAL</span>}
        </div>
        <div className="c-exp">
          exp <b>{jsonInline(c.expected)}</b> · act <b>{jsonInline(c.actual)}</b>
        </div>
        {c.detail && <div className="c-detail">{c.detail}</div>}
      </div>
      <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
        {c.type}
      </span>
    </div>
  );
}

function CheckLedgerHero({ v }: { v: CaseView }) {
  const fails = v.failedChecks;
  return (
    <div className="hero">
      <div className="ledger">
        <div className="ledger-head">
          ▣ deterministic check ledger · no render captured
        </div>
        {fails.length === 0 ? (
          <div className="checks-pass-row">
            <StatusGlyph state="pass" /> all {v.checks.length} checks pass — nothing failing to inspect
          </div>
        ) : (
          fails.map((c) => <CheckRow key={c.check_id} c={c} />)
        )}
        {fails.length > 0 && v.checks.length > fails.length && (
          <div className="checks-pass-row">
            <StatusGlyph state="pass" /> {v.checks.length - fails.length} more checks pass
          </div>
        )}
      </div>
    </div>
  );
}

function RenderHero({ v }: { v: CaseView }) {
  const { shotIndex, openOverlay, setShotIndex } = useStore();
  const shots = v.screenshots;
  const multi = shots.length > 1;
  const idx = Math.min(shotIndex, shots.length - 1);
  const CARDINAL = ["N", "E", "S", "W"];
  return (
    <div className="hero contact">
      {multi && (
        <div className="contact-strip">
          {shots.map((p, i) => (
            <button
              key={p}
              className={`contact-thumb${i === idx ? " on" : ""}`}
              onClick={() => setShotIndex(() => i)}
              title={`angle ${i + 1}`}
            >
              <span className="cc-dir">{v.screenshotMode === "cardinal_panorama" ? CARDINAL[i] ?? i + 1 : i + 1}</span>
              <img src={artifactUrl(p)} alt={`${v.case_name} angle ${i + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <div className="hero-render" onClick={() => openOverlay("lightbox")} style={{ cursor: "zoom-in" }}>
        <img src={artifactUrl(shots[idx])} alt={`${v.case_name} render`} loading="lazy" />
        <div className="hero-corner">
          {v.visualScore !== null ? <Score10 value={v.visualScore} /> : <UnknownChip small />}
          <DecisionChip decision={v.decision} source={v.source} />
        </div>
      </div>
    </div>
  );
}

function QuantBand({ v }: { v: CaseView }) {
  const passing = v.checks.length - v.failedChecks.length;
  return (
    <div className="band machine">
      <div className="band-head">
        ▣ deterministic · machine <span className="bh-score"><Score01 value={v.score} /></span>
      </div>
      <div className="band-body">
        <div style={{ fontSize: "var(--fs-100)", color: "var(--text-2)", marginBottom: "var(--sp-2)" }}>
          {passing}/{v.checks.length} checks pass
          {v.criticalFailedChecks.length > 0 && (
            <span style={{ color: "var(--crit)" }}> · {v.criticalFailedChecks.length} critical ✗</span>
          )}
        </div>
        {v.failedChecks.slice(0, 4).map((c) => (
          <CheckRow key={c.check_id} c={c} />
        ))}
      </div>
    </div>
  );
}

function DimRow({ d }: { d: AdaptedDimension }) {
  if (!d.hasScore) {
    return (
      <div className="dim-row unknown">
        <span className="dim-name" title={d.label}>
          {dimensionShortLabel(d.key)}
        </span>
        <span className="dim-bar" />
        <UnknownChip small />
      </div>
    );
  }
  const pct = Math.round((d.score! / 10) * 100);
  return (
    <div className={`dim-row ${dimToneClass(d.status)}`}>
      <span className="dim-name" title={d.label}>
        {dimensionShortLabel(d.key)}
      </span>
      <span className="dim-bar">
        <span className="dim-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--ink-eye)" }}>
        {d.score!.toFixed(0)}
      </span>
      {d.note && <span className="dim-note">{d.note}</span>}
    </div>
  );
}

function QualBand({ v }: { v: CaseView }) {
  const reviewed = v.visualStatus !== "not_reviewed" && v.visualStatus !== "not_applicable";
  return (
    <div className="band eye">
      <div className="band-head">
        ◈ visual judge · eye{" "}
        <span className="bh-score">
          {v.visualScore !== null ? <Score10 value={v.visualScore} /> : <UnknownChip small text="not reviewed" />}
        </span>
      </div>
      <div className="band-body">
        {!reviewed && (
          <div className="empty-note" style={{ padding: "var(--sp-2)" }}>
            Not visually reviewed — the deterministic ledger is the evidence.
          </div>
        )}
        {v.dimensions.map((d) => (
          <DimRow key={d.key} d={d} />
        ))}
        {v.observations.length > 0 && (
          <details className="disclose">
            <summary>▸ observations ({v.observations.length})</summary>
            <ul>
              {v.observations.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </details>
        )}
        {v.risks.length > 0 && (
          <details className="disclose">
            <summary>▸ risks ({v.risks.length})</summary>
            <ul>
              {v.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export function ReviewStage() {
  const { selectedView: v, detailsOpen } = useStore();
  if (!v) return <div className="stage col"><div className="empty-note">No case selected.</div></div>;
  const hasRender = v.screenshots.length > 0;
  return (
    <main className="stage col" role="main">
      <div className="stage-head">
        <div>
          <div className="stage-title">{v.case_name || v.case_id}</div>
          <div className="stage-sub">
            <span>{v.skill.replace("cesiumjs-", "")}</span>
            <span>· {v.case_id}</span>
            {v.difficulty && <MetaTag k="difficulty" v={v.difficulty} />}
            {v.landmark && <MetaTag k="landmark" v={v.landmark} />}
            {v.perspective && <MetaTag k="perspective" v={v.perspective} />}
          </div>
        </div>
        <DecisionChip decision={v.decision} source={v.source} />
      </div>

      {hasRender ? <RenderHero v={v} /> : <CheckLedgerHero v={v} />}

      {v.visualSummary && (
        <div className="intent">
          <span style={{ color: "var(--ink-eye)" }}>◈ </span>
          {v.visualSummary}
        </div>
      )}

      <details className="disclose" open={detailsOpen}>
        <summary>▸ scenario intent</summary>
        <div className="intent">
          {v.task && <div className="task-q">{v.task}</div>}
          {v.expectedBehaviors.length > 0 && (
            <ul className="behaviors">
              {v.expectedBehaviors.map((b, i) => (
                <li key={i}>
                  <StatusGlyph state="unknown" /> {b}
                </li>
              ))}
            </ul>
          )}
          {v.visualExpectations && (
            <div style={{ color: "var(--text-3)", fontStyle: "italic" }}>“{v.visualExpectations}”</div>
          )}
        </div>
      </details>
    </main>
  );
}

export function ReviewInspector() {
  const { selectedView: v } = useStore();
  if (!v) return <aside className="inspector col" />;
  return (
    <aside className="inspector col" aria-label="Evidence inspector">
      <QuantBand v={v} />
      <QualBand v={v} />
    </aside>
  );
}
