import { useStore } from "../store";
import { artifactUrl } from "../api";
import type { AdaptedDimension, CaseView, RawCheck } from "../types";
import { dimensionShortLabel, humanize } from "../lib/adapt";
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

function compactInline(v: unknown): string {
  const raw = jsonInline(v);
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

function stripOrdinal(id: string): string {
  return id.replace(/_\d+$/, "");
}

function patternValue(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const record = v as Record<string, unknown>;
  const value = typeof record.match === "string" && record.match
    ? record.match
    : typeof record.pattern === "string" && record.pattern
      ? record.pattern
      : null;
  return value;
}

function checkLabel(c: RawCheck): string {
  if (c.type === "pattern_present" || c.type === "pattern_absent") {
    const value = patternValue(c.actual) ?? patternValue(c.expected);
    return value ? `Pattern · ${value}` : humanize(c.type);
  }
  return humanize(stripOrdinal(c.check_id || c.type));
}

function shouldShowExpectedActual(c: RawCheck): boolean {
  if (c.expected === undefined && c.actual === undefined) return false;
  if (
    c.result === "pass" &&
    ["no_runtime_errors", "code_runs", "pattern_present", "pattern_absent", "artifact_text_absent"].includes(c.type)
  ) {
    return false;
  }
  return true;
}

function DeterministicCheckRow({ c }: { c: RawCheck }) {
  const passed = c.result === "pass";
  const state = passed ? "pass" : c.critical ? "crit" : "fail";
  const cls = `det-check ${passed ? "pass" : c.critical ? "crit" : "fail"}`;
  const hasExpectedActual = shouldShowExpectedActual(c);
  return (
    <div className={cls}>
      <StatusGlyph state={state} />
      <div className="det-check-main">
        <div className="det-check-title">
          <span className="det-check-name" title={c.check_id}>
            {checkLabel(c)}
          </span>
          {!passed && c.critical && <span className="det-check-critical">Critical</span>}
        </div>
        <div className="det-check-meta">
          <span>{c.type}</span>
          {c.category && <span>{humanize(c.category)}</span>}
        </div>
        {hasExpectedActual && (
          <div className="det-check-values">
            Expected <b>{compactInline(c.expected)}</b> · Actual <b>{compactInline(c.actual)}</b>
          </div>
        )}
        {c.detail && <div className="det-check-detail">{c.detail}</div>}
      </div>
    </div>
  );
}

function DeterministicBreakdown({ checks }: { checks: RawCheck[] }) {
  if (checks.length === 0) {
    return <div className="empty-note">No deterministic checks recorded.</div>;
  }
  return (
    <div className="det-check-list">
      {checks.map((c) => (
        <DeterministicCheckRow key={c.check_id} c={c} />
      ))}
    </div>
  );
}

function CheckLedgerHero({ v }: { v: CaseView }) {
  return (
    <div className="hero">
      <div className="ledger">
        <div className="ledger-head">
          ▣ deterministic check ledger · no render captured
        </div>
        <DeterministicBreakdown checks={v.checks} />
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
        <DeterministicBreakdown checks={v.checks} />
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
            Not visually reviewed; the deterministic ledger is the evidence.
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
