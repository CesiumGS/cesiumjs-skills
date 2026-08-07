import type { ReactNode } from "react";
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

/** Regex source → readable text: drop escapes so `Cesium3DTileset\.fromUrl`
 * reads as `Cesium3DTileset.fromUrl` for a non-regex-literate reader. */
function prettyPattern(p: string): string {
  return p.replace(/\\(.)/g, "$1");
}

/** A token is showable as an API name if it still reads like code after
 * cleaning — has letters and carries no leftover regex metacharacters. */
function isShowableToken(t: string): boolean {
  return /[A-Za-z]/.test(t) && !/[\\^$*+?{}[\]()|]/.test(t) && !t.includes("(?");
}

interface PatternShape {
  tokens: string[];
  /** Every token reads like a plain API name — safe to show as code chips. */
  showable: boolean;
  /** Every token is numeric — a coordinate/value assertion, not an API name. */
  numeric: boolean;
}

/** Best-effort humanization of a source-check regex: collapse simple
 * non-capturing groups, split the alternation, and classify the result so the
 * rationale can show clean API chips, describe a coordinate/value match, or
 * fall back to generic prose for genuinely complex regex. */
function patternShape(raw: string): PatternShape {
  const collapsed = raw
    .replace(/\(\?:([^()|]*)\)\?/g, "$1") // (?:X)? -> X
    .replace(/\(\?:([^()|]*)\)/g, "$1"); // (?:X)  -> X
  const tokens = collapsed
    .split("|")
    .map((part) =>
      prettyPattern(
        part
          .trim()
          .replace(/^\(\?:/, "") // group open left over from splitting an alternation
          .replace(/\)$/, "") // group close left over from splitting
          .replace(/^\^/, "")
          .replace(/\$$/, "")
      ).trim()
    )
    .filter(Boolean);
  const showable = tokens.length > 0 && tokens.every(isShowableToken);
  const numeric = tokens.length > 0 && tokens.every((t) => /^[-\d.\s,]+$/.test(t));
  return { tokens, showable, numeric };
}

/** Render pattern tokens as a comma-separated run of code chips. */
function tokenChips(tokens: string[]): ReactNode {
  return tokens.map((t, i) => (
    <span key={t}>
      {i > 0 ? ", " : ""}
      <code>{t}</code>
    </span>
  ));
}

/** Plain-English explanation of what a code test verifies and why. Rendered
 * directly under each row so a non-expert reads the deterministic intent before
 * the raw expected/actual values. Interpolates the concrete API pattern for
 * source checks; falls back to a category-aware sentence for unmapped types. */
function checkRationale(c: RawCheck): ReactNode {
  const pattern = patternValue(c.expected) ?? patternValue(c.actual);
  const shape = pattern ? patternShape(pattern) : null;
  switch (c.type) {
    case "code_runs":
      return "Runs the generated snippet in a real headless browser and requires it to finish without throwing. The floor check: proof the code actually executes, not just that it looks plausible.";
    case "no_runtime_errors":
      return "Watches the browser console during that run and requires zero errors. Catches failures that don't halt execution but still break the scene, like a rejected tile load or a bad API call.";
    case "pattern_present": {
      if (shape?.showable) {
        return shape.tokens.length === 1 ? (
          <>Requires the generated source to contain {tokenChips(shape.tokens)} — the deterministic fingerprint that the intended CesiumJS API was actually called.</>
        ) : (
          <>Requires the generated source to call at least one of {tokenChips(shape.tokens)} — the deterministic fingerprint that the intended CesiumJS API was used rather than approximated.</>
        );
      }
      if (shape?.numeric) {
        return "Requires the generated source to reference the specific coordinates or numeric values the scenario expects — proof the scene was aimed at the right place, not an arbitrary one.";
      }
      return "Requires the generated source to match the API pattern the scenario expects (shown below) — the deterministic fingerprint that the intended CesiumJS call was used.";
    }
    case "pattern_absent": {
      if (shape?.showable) {
        return (
          <>Requires the source to use none of {tokenChips(shape.tokens)} — a guardrail against a shortcut the scenario forbids, such as an Ion-only asset where a public one is required.</>
        );
      }
      return "Requires the source to avoid the forbidden pattern shown below — a guardrail against a shortcut the scenario explicitly disallows.";
    }
    case "artifact_text_absent":
      return "Requires a specific string to be absent from the run's output text, usually an error marker or a disallowed fallback.";
    case "camera_target_view":
      return "Checks the camera came to rest aimed at the expected target within tolerance — proof the view was framed on the subject instead of left at the default globe.";
    case "collection_count":
      return "Counts the objects in a collection after the run and requires the expected number — proof the right quantity was created, not zero and not duplicated.";
    case "entity_exists":
      return "Requires a specific named entity to be present in the scene once the run settles.";
    case "entity_translation_delta":
      return "Measures how far an entity moved between two time samples and compares it against the expected distance — proof of time-dynamic motion.";
    case "json_value_equals":
    case "json_value_compare":
      return "Reads a specific value out of the run's structured output and compares it against the expected value within tolerance.";
    default:
      return `Deterministic ${humanize(c.category || "source contract").toLowerCase()} check: compares the observed result against the expected value.`;
  }
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
        <div className="det-check-rationale">{checkRationale(c)}</div>
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
    return <div className="empty-note">No Code Tests recorded.</div>;
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
          ▣ Code Test ledger · no render captured
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
        ▣ Code Tests <span className="bh-score"><Score01 value={v.score} /></span>
      </div>
      <div className="band-body">
        <div style={{ fontSize: "var(--fs-100)", color: "var(--text-2)", marginBottom: "var(--sp-2)" }}>
          {passing}/{v.checks.length} Code Tests pass
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
      <span className="dim-score">
        {d.score!.toFixed(1)}
        <span className="dim-score-max">/10</span>
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
        ◈ Visual Tests{" "}
        <span className="bh-score">
          {v.visualScore !== null ? <Score10 value={v.visualScore} /> : <UnknownChip small text="not run" />}
        </span>
      </div>
      <div className="band-body">
        {!reviewed && (
          <div className="empty-note" style={{ padding: "var(--sp-2)" }}>
            Visual Tests were not run; the Code Test ledger is the evidence.
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
