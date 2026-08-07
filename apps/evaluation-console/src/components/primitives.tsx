import type { ReactNode } from "react";
import { Check, X, Flag, Minus, AlertTriangle } from "lucide-react";
import type { Decision, LoopDecision, ScenarioVerdict } from "../types";

/* ============================================================================
   The legibility law (DESIGN-SPEC P3) lives here as TYPED primitives so the two
   score worlds physically cannot share an axis:
     Score01  steel  ▣  0-1 / %     (the deterministic machine)
     Score10  amber  ◈  N.N/10      (the visual judge)
   Unknown is never a red zero (P4) — it is a dashed slate chip.
   ============================================================================ */

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Code Test 0-1 magnitude — steel bar + % + machine glyph. */
export function Score01({ value, label }: { value: number | null | undefined; label?: string }) {
  if (value === null || value === undefined) return <UnknownChip />;
  const pct = Math.round(clamp01(value) * 100);
  return (
    <span className="score score-machine" title={`${label ?? "Code Tests"} ${pct}% (0-1 scale)`}>
      <span className="score-glyph" aria-hidden>
        ▣
      </span>
      <span className="score-bar">
        <span className="score-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="score-num">{value.toFixed(2).replace(/^0/, "")}</span>
    </span>
  );
}

/** Visual Test score — accepts a 0-10 value (already normalized by the adapter). */
export function Score10({ value, label }: { value: number | null | undefined; label?: string }) {
  if (value === null || value === undefined) return <UnknownChip />;
  const v = Math.max(0, Math.min(10, value));
  const pips = Math.round(v);
  return (
    <span className="score score-eye" title={`${label ?? "Visual Tests"} ${v.toFixed(1)}/10 (visual scale)`}>
      <span className="score-glyph" aria-hidden>
        ◈
      </span>
      <span className="pips" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`pip${i < pips ? " on" : ""}`} />
        ))}
      </span>
      <span className="score-num">{v.toFixed(1)}</span>
    </span>
  );
}

/** Win-rate / percentage — steel ring text. 0..100. */
export function Pct({ value, label }: { value: number | null | undefined; label?: string }) {
  if (value === null || value === undefined) return <UnknownChip small />;
  return (
    <span className="pct-chip" title={`${label ?? "rate"} ${value.toFixed(0)}%`}>
      {value.toFixed(0)}
      <span className="pct-unit">%</span>
    </span>
  );
}

export function UnknownChip({ small, text = "Unknown" }: { small?: boolean; text?: string }) {
  return (
    <span className={`unknown-chip${small ? " sm" : ""}`} title="Visual Tests not run: unknown, not a low score">
      <span className="unknown-ring" aria-hidden />
      {!small && text}
    </span>
  );
}

export type CheckState = "pass" | "fail" | "crit" | "unknown";

export function StatusGlyph({ state }: { state: CheckState }) {
  if (state === "pass") return <Check size={13} className="glyph-pass" aria-label="pass" />;
  if (state === "crit")
    return <AlertTriangle size={13} className="glyph-crit" aria-label="critical failure" />;
  if (state === "fail") return <X size={13} className="glyph-fail" aria-label="fail" />;
  return (
    <span className="glyph-unknown" aria-label="unknown">
      ◌
    </span>
  );
}

/** accept / flag / defer (review verdict). */
export function DecisionChip({ decision, source }: { decision: Decision; source?: "auto" | "human" }) {
  const human = source === "human";
  const icon =
    decision === "accept" ? <Check size={12} /> : decision === "flag" ? <Flag size={12} /> : <Minus size={12} />;
  const word = decision === "accept" ? "accept" : decision === "flag" ? "flag" : "defer";
  return (
    <span className={`verdict-chip v-${decision}${human ? " human" : ""}`} title={`${word}${human ? " · you" : " · auto"}`}>
      {icon}
      <span>{word}</span>
      {human && <span className="prov-human" aria-hidden>⚑</span>}
    </span>
  );
}

/** KEEP / REJECT / TIE (loop decision). */
export function LoopBadge({ decision, rule }: { decision: LoopDecision | "TIE"; rule?: string | null }) {
  const d = decision ?? "—";
  const cls = d === "KEEP" ? "keep" : d === "REJECT" ? "reject" : "tie";
  return (
    <span className={`loop-badge lb-${cls}`} title={rule ?? undefined}>
      {d}
    </span>
  );
}

/** Per-scenario judge verdict, de-aliased to WIN / LOSS / TIE (candidate-relative). */
export function ScenarioChip({ verdict, count }: { verdict: ScenarioVerdict; count?: number | null }) {
  const map: Record<string, { label: string; cls: string; mark: string }> = {
    CANDIDATE: { label: "WIN", cls: "win", mark: "✓" },
    BASELINE: { label: "LOSS", cls: "loss", mark: "✗" },
    TIE: { label: "TIE", cls: "tie", mark: "=" }
  };
  const m = verdict ? map[verdict] : null;
  if (!m) return <span className="scn-chip scn-na" title="Visual Tests unavailable">N/A</span>;
  return (
    <span className={`scn-chip scn-${m.cls}`} title={count != null ? `${m.label} (${count}/3 AI reviewers)` : m.label}>
      <span className="scn-mark" aria-hidden>
        {m.mark}
      </span>
      {m.label}
    </span>
  );
}

export function ProvGlyph({ kind }: { kind: "machine" | "eye" | "human" | "live" }) {
  const map = { machine: "▣", eye: "◈", human: "⚑", live: "●" };
  return (
    <span className={`prov-glyph pg-${kind}`} aria-hidden>
      {map[kind]}
    </span>
  );
}

/** Tiny inline sparkline of decisions or scores across iterations. */
export function Sparkline({ points, kind = "wins" }: { points: number[]; kind?: "wins" | "score" }) {
  if (points.length === 0) return <span className="spark-empty" />;
  const max = Math.max(1, ...points);
  return (
    <span className={`spark spark-${kind}`} aria-hidden>
      {points.map((p, i) => (
        <span key={i} className="spark-bar" style={{ height: `${Math.max(8, (p / max) * 100)}%` }} />
      ))}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "live" | "machine" | "eye" | "human" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function MetaTag({ k, v }: { k: string; v: string }) {
  return (
    <span className="meta-tag">
      <span className="meta-k">{k}</span>
      <span className="meta-v">{v}</span>
    </span>
  );
}
