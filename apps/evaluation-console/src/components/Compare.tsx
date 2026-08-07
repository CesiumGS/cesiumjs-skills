import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { useStore } from "../store";
import {
  fmtDuration,
  harnessLabel,
  modelShort,
  pluralize,
  priceBandIndex,
  priceBandLabel,
  relativeTime,
  skillLabel
} from "../lib/format";
import { UnknownChip } from "./primitives";
import type { ComboInsight, HarnessSpec, IterationSummary, ModelSpec, RunSummary } from "../types";

/* ============================================================================
   MODELS & HARNESSES (Insights, key 6).
   Two truths, visually separated and never conflated (the provenance rule):
     DECLARED  what the registry says a harness or model CAN do (capability
               cards and the model catalog: vendor, price, effort, vision,
               release metadata).
     OBSERVED  what the artifacts on disk actually recorded (run outcomes per
               harness; per model-and-effort combo: keep rate, win rate with
               stability, wall clock, recency) with drill-down to the exact
               iterations, then into Optimize for the evidence.
   Three dashboards behind one segmented control: Harnesses (the harness as
   the unit), Models (observed performance as the unit), Catalog (declared
   availability as the unit, joined back to the evidence by one column).
   Ink law holds: deterministic rates are steel 0-1/%; the harness dimension is
   the categorical indigo; unknown renders dashed slate, never as a zero.
   Copy convention: Title Case for headers, sentence case for prose; only real
   identifiers (model ids, binaries, CLI flags) stay lowercase mono.
   ============================================================================ */

const UNRECORDED = "unrecorded";

export function HarnessChip({ harness }: { harness: string }) {
  const unknown = harness === "unknown" || harness === UNRECORDED;
  const synthetic = harness === "fixtures" || harness === "mixed";
  const label = unknown
    ? harness === UNRECORDED
      ? "Unrecorded"
      : "Unknown"
    : harness === "fixtures"
      ? "Synthetic"
      : harness === "mixed"
        ? "Real + Synthetic"
        : harnessLabel(harness);
  return (
    <span
      className={`harness-pill${unknown ? " unrecorded" : ""}${synthetic ? " synthetic" : ""}`}
      data-harness={unknown || synthetic ? undefined : harness}
    >
      <span
        className={`harness-dot${unknown ? " unknown" : ""}${synthetic ? " synthetic" : ""}`}
        data-harness={unknown || synthetic ? undefined : harness}
        aria-hidden
      />
      {label}
    </span>
  );
}

/** Relative cost at a glance: a labeled five-step meter, not glyph spam.
 *  Tooltip carries the real per-M-token price when known, plus the effort
 *  caveat: reasoning bills as output tokens, so effort scales realized spend. */
function CostMeter({
  band,
  usd,
  effort
}: {
  band: string | null;
  usd: { input: number; output: number } | null;
  effort?: string | null;
}) {
  const idx = priceBandIndex(band);
  if (idx === null) return <UnknownChip small />;
  const price = usd ? `$${usd.input} in / $${usd.output} out per M tokens.` : "Per-token price not published.";
  const effortNote = effort
    ? ` Reasoning bills as output tokens, so realized spend at ${effort} effort sits ${
        effort === "none" || effort === "low" ? "well below" : effort === "medium" ? "near" : "above"
      } the middle of this band.`
    : " Reasoning bills as output tokens, so realized spend scales with the effort level used.";
  return (
    <span className="cost-meter" title={`${priceBandLabel(band)} cost tier. ${price}${effortNote}`}>
      <span className="cm-dots" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={`cm-dot${i <= idx ? " on" : ""}${idx >= 3 && i <= idx ? " hot" : ""}`} />
        ))}
      </span>
      <span className="cm-word">{priceBandLabel(band)}</span>
    </span>
  );
}

function VisionChip({ enabled, note }: { enabled: boolean | null; note?: string }) {
  if (enabled === null) return <UnknownChip small />;
  return enabled ? (
    <span className="vision-chip on" title={note ?? "Accepts image input"}>
      <Eye size={11} aria-hidden /> Vision
    </span>
  ) : (
    <span className="vision-chip off" title={note ?? "Text only"}>
      <EyeOff size={11} aria-hidden /> Text only
    </span>
  );
}

/* ---------------------------------------------------------------------------
   DECLARED: harness capability cards from the registry.
   --------------------------------------------------------------------------- */
function HarnessCard({ spec }: { spec: HarnessSpec }) {
  const defaultModel = spec.models.find((m) => m.id === spec.default_model) ?? null;
  return (
    <div className="hx-card" data-harness={spec.id}>
      <div className="hx-head">
        <HarnessChip harness={spec.id} />
        <span className="hx-name">{spec.name}</span>
        <code className="hx-binary">{spec.binary}</code>
        <span className="spacer" />
        <VisionChip enabled={spec.multimodal} note={spec.vision_note} />
      </div>
      <div className="hx-provider">{spec.provider_label}</div>
      <div className="hx-default">
        <span className="hx-k">Default</span>
        <span className="mono hx-model">{modelShort(spec.default_model)}</span>
        <span className="effort-chip">@{spec.default_effort}</span>
        {defaultModel && (
          <CostMeter band={defaultModel.price_band} usd={defaultModel.price_usd_per_mtok} effort={spec.default_effort} />
        )}
        {spec.defaults_source && (
          <span className="hx-defaults-src" title={`Where the default was resolved from: ${spec.defaults_source}`}>
            {spec.defaults_source.startsWith("live") ? "Live default" : "Registry fallback"}
          </span>
        )}
      </div>
      <div className="hx-note">{spec.vision_note}</div>
      <div className="hx-meta">
        <span>{pluralize(spec.models.length, "model")}</span>
        <span>· Roles: {spec.roles.join(", ")}</span>
        <span>
          · Effort via <code>{spec.effort_mechanism}</code>
        </span>
      </div>
      <div className="hx-catalog-src" title={spec.catalog_source}>
        Catalog: {spec.catalog_source.split(",")[0].split(";")[0].trim()} · As of {spec.catalog_as_of}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   OBSERVED: run-level scorecard outcomes grouped by harness.
   --------------------------------------------------------------------------- */
interface HarnessRuns {
  harness: string;
  runs: RunSummary[];
  passRate: number | null;
  meanScore: number | null;
  scoreStddev: number | null;
  latest: RunSummary | null;
}

/** Which row a run aggregates under. A stamped harness always wins; harness-less
 *  runs group by their evidence source (fixtures / mixed sweeps) instead of all
 *  piling into "unknown"; "unknown" is reserved for true unstamped agent runs. */
function runBucket(r: RunSummary): string {
  const harness = r.harness ?? "unknown";
  if (harness !== "unknown") return harness;
  if (r.source === "fixtures" || r.source === "mixed") return r.source;
  return "unknown";
}

const BUCKET_HINTS: Record<string, string> = {
  fixtures: "Hand-authored test fixtures that validate the evaluator itself; no AI agent involved.",
  mixed: "Scores a mix of real agent output and hand-authored test fixtures in a single sweep.",
  unknown: "These scorecards predate provenance stamping, so the producing harness is unknown."
};

function bucketRank(bucket: string): number {
  return bucket === "unknown" ? 3 : bucket === "fixtures" ? 2 : bucket === "mixed" ? 1 : 0;
}

function harnessRunAgg(runs: RunSummary[]): HarnessRuns[] {
  const by = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const h = runBucket(r);
    (by.get(h) ?? by.set(h, []).get(h)!).push(r);
  }
  return [...by.entries()]
    .map(([harness, list]) => {
      const scored = list.filter((r) => typeof r.overall_score === "number");
      const mean = scored.length
        ? scored.reduce((sum, r) => sum + (r.overall_score as number), 0) / scored.length
        : null;
      const stddev =
        scored.length >= 2 && mean !== null
          ? Math.sqrt(
              scored.reduce((sum, r) => sum + ((r.overall_score as number) - mean) ** 2, 0) /
                (scored.length - 1)
            )
          : null;
      return {
        harness,
        runs: list,
        passRate: list.length ? list.filter((r) => r.overall_result === "pass").length / list.length : null,
        meanScore: mean,
        scoreStddev: stddev,
        latest: list.reduce<RunSummary | null>(
          (best, r) => (!best || r.timestamp_utc > best.timestamp_utc ? r : best),
          null
        )
      };
    })
    .sort((a, b) => bucketRank(a.harness) - bucketRank(b.harness) || a.harness.localeCompare(b.harness));
}

function StabilityChip({ stddev, n, unit }: { stddev: number | null; n: number; unit: "%" | "pt" }) {
  if (stddev === null) {
    return (
      <span className="stab-chip insufficient" title={`Stability needs at least 2 scored samples (have ${n}).`}>
        n = {n}
      </span>
    );
  }
  const pct = stddev * 100;
  const band = pct <= 10 ? "Steady" : pct <= 25 ? "Wobbly" : "Volatile";
  return (
    <span
      className={`stab-chip ${band.toLowerCase()}`}
      title={`Standard deviation of the per-sample rate across ${n} samples. Lower is steadier.`}
    >
      ±{pct.toFixed(0)}{unit === "%" ? "pp" : ""} {band}
    </span>
  );
}

function RateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <UnknownChip small />;
  const pct = Math.round(rate * 100);
  return (
    <span className="hc-rate">
      <span className="hc-bar" style={{ width: `${pct}%`, opacity: 0.16 + rate * rate * 0.84 }} />
      <span className="mono hc-rate-num">{pct}%</span>
    </span>
  );
}

export function RunsByHarness() {
  const { runs, openOverlay } = useStore();
  const aggs = useMemo(() => harnessRunAgg(runs), [runs]);
  return (
    <div className="dash-card">
      <div className="section-title">
        Runs by Harness
        <span className="section-sub">Run-level outcomes, steel 0-1. Click a row to open the Run Browser (h).</span>
      </div>
      {aggs.length === 0 ? (
        <div className="empty-note">No scorecard runs discovered on disk.</div>
      ) : (
        <table className="matrix harness-compare">
          <caption className="sr-only">Scorecard run outcomes grouped by harness.</caption>
          <thead>
            <tr>
              <th scope="col">Harness</th>
              <th scope="col">Runs</th>
              <th scope="col">Pass Rate</th>
              <th scope="col">Avg Score</th>
              <th scope="col" title="Standard deviation of the overall score across runs. Lower is steadier.">
                Stability
              </th>
              <th scope="col">Latest</th>
            </tr>
          </thead>
          <tbody>
            {aggs.map((a) => (
              <tr
                key={a.harness}
                className="hc-row"
                onClick={() => openOverlay("harness")}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openOverlay("harness");
                  }
                }}
              >
                <th scope="row" className="hc-name">
                  <span className="cell-flex">
                    <HarnessChip harness={a.harness} />
                    {BUCKET_HINTS[a.harness] && (
                      <span className="hint-unrecorded" title={BUCKET_HINTS[a.harness]}>
                        {a.harness === "unknown" ? "Origin unknown" : a.harness === "fixtures" ? "Test data" : "Mixed evidence"}
                      </span>
                    )}
                  </span>
                </th>
                <td className="mono hc-num">{a.runs.length}</td>
                <td>
                  <RateBar rate={a.passRate} />
                </td>
                <td className="mono hc-num">
                  {a.meanScore === null ? <UnknownChip small /> : `${Math.round(a.meanScore * 100)}%`}
                </td>
                <td>
                  <StabilityChip stddev={a.scoreStddev} n={a.runs.length} unit="pt" />
                </td>
                <td className="mono hc-latest">{a.latest ? relativeTime(a.latest.timestamp_utc) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   OBSERVED: codegen model-and-effort combos from the optimization metas.
   --------------------------------------------------------------------------- */
function ComboRow({ combo }: { combo: ComboInsight }) {
  const { selectSkill, selectIteration, setStation, registry } = useStore();
  const [open, setOpen] = useState(false);
  const catalogMatch = useMemo(() => {
    for (const h of registry?.harnesses ?? []) {
      const m = h.models.find((x) => x.id === combo.model_id);
      if (m) return m;
    }
    return null;
  }, [registry, combo.model_id]);

  const drill = (skill: string, iteration: string) => {
    selectSkill(skill);
    selectIteration(iteration);
    setStation("optimize");
  };

  return (
    <>
      <tr
        className="combo-row"
        onClick={() => setOpen((o) => !o)}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <th scope="row" className="combo-id">
          <span className="cell-flex">
            {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
            <HarnessChip harness={combo.harness} />
            <span className="mono combo-model">{modelShort(combo.model_id)}</span>
            {combo.model_variant ? (
              <span className="effort-chip">@{combo.model_variant}</span>
            ) : (
              <span className="effort-chip unrecorded" title="Effort level not recorded by these runs.">
                @?
              </span>
            )}
            {catalogMatch && (
              <CostMeter
                band={catalogMatch.price_band}
                usd={catalogMatch.price_usd_per_mtok}
                effort={combo.model_variant}
              />
            )}
          </span>
        </th>
        <td className="mono hc-num">{combo.iterations}</td>
        <td>
          <RateBar rate={combo.keep_rate} />
          <span className="combo-kr mono">
            {combo.keeps}K / {combo.rejects}R{combo.undecided ? ` / ${combo.undecided}?` : ""}
          </span>
        </td>
        <td className="mono combo-wlt">
          <span style={{ color: "var(--keep)" }}>{combo.wins}W</span>{" "}
          <span style={{ color: "var(--reject)" }}>{combo.losses}L</span>{" "}
          <span style={{ color: "var(--tie)" }}>{combo.ties}T</span>
        </td>
        <td>
          {combo.win_rate === null ? (
            <UnknownChip small />
          ) : (
            <span className="mono">{Math.round(combo.win_rate * 100)}%</span>
          )}{" "}
          <StabilityChip stddev={combo.win_rate_stddev} n={combo.scored_iterations} unit="%" />
        </td>
        <td className="mono hc-num" title="Mean wall clock per iteration, journal start to finish.">
          {fmtDuration(combo.mean_duration_s)}
        </td>
        <td className="mono hc-num">{combo.skills.length}</td>
        <td className="mono hc-latest" title="Most recent time this combo generated code or was evaluated by a run.">
          {combo.last_active ? relativeTime(combo.last_active) : "—"}
        </td>
      </tr>
      {open && (
        <tr className="combo-members">
          <td colSpan={8}>
            <div className="combo-member-list">
              {combo.members.map((m) => (
                <button
                  key={`${m.skill}/${m.iteration}`}
                  className="combo-member"
                  onClick={(e) => {
                    e.stopPropagation();
                    drill(m.skill, m.iteration);
                  }}
                  title={`Open ${skillLabel(m.skill)} iteration ${m.iteration} in Optimize`}
                >
                  <span>{m.skill.replace("cesiumjs-", "")}</span>
                  <span className="mono">#{m.iteration}</span>
                  <span
                    className={`cm-dec ${m.decision === "KEEP" ? "keep" : m.decision === "REJECT" ? "reject" : "none"}`}
                  >
                    {m.decision ?? m.status}
                  </span>
                  {m.win_rate !== null && <span className="mono cm-wr">{Math.round(m.win_rate * 100)}%</span>}
                </button>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function Combos() {
  const { insights } = useStore();
  const combos = insights?.combos ?? [];
  return (
    <div className="dash-card" id="observed-combos">
      <div className="section-title">
        Model Performance, Observed
        <span className="section-sub">
          Model × effort × harness from the optimization metas. Click a row for its iterations.
        </span>
      </div>
      {combos.length === 0 ? (
        <div className="empty-note">No optimization iterations with recorded provenance yet.</div>
      ) : (
        <table className="matrix combo-table">
          <caption className="sr-only">Observed performance per model, effort, and harness combination.</caption>
          <thead>
            <tr>
              <th scope="col">Combination</th>
              <th scope="col">Iterations</th>
              <th scope="col" title="KEEP decisions over decided iterations.">Keep Rate</th>
              <th scope="col" title="Scenario wins, losses, and ties against the running baseline.">W / L / T</th>
              <th scope="col" title="Visual Test win rate W/(W+L), with per-iteration stability.">Win Rate · Stability</th>
              <th scope="col">Avg Time</th>
              <th scope="col">Skills</th>
              <th scope="col" title="Most recent time this combo generated code or was evaluated by a run.">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => (
              <ComboRow key={`${c.harness}|${c.model_id}|${c.model_variant ?? ""}`} combo={c} />
            ))}
          </tbody>
        </table>
      )}
      <div className="honesty-note">
        <span className="unknown-ring" aria-hidden /> "Unrecorded" groups iterations whose metas predate
        harness and effort stamping: visible, but never guessed.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   CHART SCAFFOLD: a real coordinate frame shared by both trend charts.
   HTML gutters carry the tick text (so labels never stretch), the SVG carries
   only geometry (non-scaling strokes), and data points are HTML elements so
   they stay perfectly round, hoverable, and keyboard-focusable.
   --------------------------------------------------------------------------- */
interface XTick {
  frac: number;
  label: string;
  sub?: string;
  subClass?: string;
}

// Inner padding of the plot box, in fractions of each axis. Keeps extreme
// points (100 %, first, last) from clipping while ticks share the mapping.
const padY = (f: number) => 0.07 + f * 0.9;
const padX = (f: number) => 0.035 + f * 0.93;

function ChartScaffold({
  height,
  yTicks,
  xTicks,
  ariaLabel,
  children,
  overlay
}: {
  height: number;
  yTicks: Array<{ frac: number; label: string }>;
  xTicks: XTick[];
  ariaLabel: string;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="chart-frame" style={{ gridTemplateRows: `${height}px auto` }}>
      <div className="chart-y" aria-hidden>
        {yTicks.map((t) => (
          <span key={t.label} style={{ top: `${t.frac * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="chart-plot" role="img" aria-label={ariaLabel}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden focusable="false">
          {yTicks.map((t) =>
            t.frac > 0.95 ? null : (
              <line
                key={t.label}
                x1={0}
                x2={100}
                y1={t.frac * 100}
                y2={t.frac * 100}
                stroke="var(--hairline)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )
          )}
          {children}
        </svg>
        {overlay}
      </div>
      <div aria-hidden />
      <div className="chart-x">
        {xTicks.map((t, i) => (
          <span key={`${t.label}-${i}`} className="cx-tick" style={{ left: `${t.frac * 100}%` }}>
            <span className="cx-l">{t.label}</span>
            {t.sub && <span className={`cx-s${t.subClass ? ` ${t.subClass}` : ""}`}>{t.sub}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 0-100 % y axis, ticks every 25 points, 100 % at the top. */
function scoreTicks(): Array<{ frac: number; label: string }> {
  return [100, 75, 50, 25, 0].map((v) => ({ frac: padY(1 - v / 100), label: `${v}%` }));
}

/** Day-of-month labels; collapses to HH:MM when the previous tick is the same day. */
function timeTickLabel(iso: string, prevIso: string | null): string {
  const d = new Date(iso);
  if (prevIso && new Date(prevIso).toDateString() === d.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------------------------------------------------------------------------
   TRENDS: run score across time or repository progression (run sequence).
   A real chart: y is the bounded steel score (0-100 %), x is labeled with run
   dates, the pass threshold is drawn and named. A flat line at 100 % now
   reads as exactly that -- every run passed everything.
   --------------------------------------------------------------------------- */
export function RunTrend() {
  const { runs, switchRun, scorecard } = useStore();
  const [axis, setAxis] = useState<"time" | "sequence">("sequence");

  const points = useMemo(() => {
    return runs
      .filter((r) => typeof r.overall_score === "number" && r.timestamp_utc)
      .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
  }, [runs]);

  if (points.length === 0) {
    return (
      <div className="dash-card">
        <div className="section-title">
          Run Score Trend
          <span className="section-sub">Across runs, chronological or by run sequence.</span>
        </div>
        <div className="empty-note">No scored runs on disk yet, so there is nothing to trend.</div>
      </div>
    );
  }

  const n = points.length;
  const t0 = Date.parse(points[0].timestamp_utc);
  const t1 = Date.parse(points[n - 1].timestamp_utc);
  const fx = (r: RunSummary, i: number): number => {
    if (n === 1) return 0.5;
    if (axis === "sequence" || t1 === t0) return i / (n - 1);
    return (Date.parse(r.timestamp_utc) - t0) / (t1 - t0);
  };
  const X = (r: RunSummary, i: number) => padX(fx(r, i)) * 100;
  const Y = (score: number) => padY(1 - score) * 100;

  const linePath = points
    .map((r, i) => `${i === 0 ? "M" : "L"}${X(r, i).toFixed(2)},${Y(r.overall_score as number).toFixed(2)}`)
    .join(" ");
  const floorY = (padY(1) * 100).toFixed(2);
  const areaPath =
    n >= 2
      ? `${linePath} L${X(points[n - 1], n - 1).toFixed(2)},${floorY} L${X(points[0], 0).toFixed(2)},${floorY} Z`
      : null;
  const threshold = points[n - 1].threshold;

  // Label every run when few; subsample toward ~6 ticks when many.
  const step = Math.max(1, Math.ceil(n / 6));
  const tickPts = points.map((r, i) => ({ r, i })).filter(({ i }) => i % step === 0 || i === n - 1);
  const xTicks: XTick[] = tickPts.map(({ r, i }, k) => ({
    frac: padX(fx(r, i)),
    label: timeTickLabel(r.timestamp_utc, k > 0 ? tickPts[k - 1].r.timestamp_utc : null)
  }));

  return (
    <div className="dash-card">
      <div className="section-title">
        Run Score Trend
        <span className="section-sub">▣ Code Test score per run (y) across runs (x). Dot color is the run result.</span>
        <span className="spacer" />
        <div className="axis-toggle" role="tablist" aria-label="X axis">
          <button
            role="tab"
            aria-selected={axis === "sequence"}
            className={axis === "sequence" ? "active" : ""}
            onClick={() => setAxis("sequence")}
          >
            Run sequence
          </button>
          <button
            role="tab"
            aria-selected={axis === "time"}
            className={axis === "time" ? "active" : ""}
            onClick={() => setAxis("time")}
          >
            Wall clock
          </button>
        </div>
      </div>
      <ChartScaffold
        height={168}
        yTicks={scoreTicks()}
        xTicks={xTicks}
        ariaLabel={`Overall score per run, ${n} ${pluralize(n, "run", "runs")}`}
        overlay={
          <>
            {typeof threshold === "number" && (
              <span
                className={`chart-flag thr${threshold >= 0.85 ? " below" : ""}`}
                style={{ top: `${Y(threshold)}%` }}
              >
                pass ≥ {Math.round(threshold * 100)}%
              </span>
            )}
            {points.map((r, i) => {
              const loaded = scorecard?.runId === r.run_id;
              const pct = Math.round((r.overall_score as number) * 100);
              return (
                <button
                  key={r.run_id}
                  type="button"
                  className={`chart-pt ${r.overall_result === "pass" ? "pass" : "fail"}${loaded ? " loaded" : ""}`}
                  style={{ left: `${X(r, i)}%`, top: `${Y(r.overall_score as number)}%` }}
                  title={`${r.run_id}\nCode Tests ${pct}% · ${r.overall_result} · ${r.total_cases} cases\n${r.timestamp_utc.slice(0, 16).replace("T", " ")} UTC · ${r.git_commit.slice(0, 7)}\nClick to focus this run.`}
                  aria-label={`${r.run_id}: Code Tests ${pct}%, run ${r.overall_result}. Click to focus this run.`}
                  onClick={() => void switchRun(r.run_id)}
                />
              );
            })}
          </>
        }
      >
        {typeof threshold === "number" && (
          <line
            x1={0}
            x2={100}
            y1={Y(threshold)}
            y2={Y(threshold)}
            stroke="var(--defer)"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {areaPath && <path d={areaPath} fill="var(--ink-machine)" opacity={0.08} stroke="none" />}
        {n >= 2 && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--ink-machine)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </ChartScaffold>
      <div className="trend-legend">
        <span><span className="dotex pass" /> Pass</span>
        <span><span className="dotex fail" /> Fail</span>
        <span><span className="dotex thr" /> Pass threshold</span>
        <span><span className="dotex loaded" /> Focused run</span>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          {n === 1
            ? "One scored run so far; the trend grows with each run."
            : axis === "sequence"
              ? "Even spacing in run order (repository progression)."
              : "True wall-clock spacing."}{" "}
          Click a dot to focus that run.
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   TRENDS: per-skill optimization win rate (matured from the old Trends lens).
   --------------------------------------------------------------------------- */
function winRate(it: IterationSummary): number | null {
  const { wins, losses } = it.counts;
  const denom = wins + losses;
  if (denom === 0) return null; // A gap, not a zero dip.
  return (wins / denom) * 100;
}

export function SkillTrend() {
  const { skills, selectSkill, setStation } = useStore();
  const optimized = skills.filter((s) => s.history.some((h) => !h.is_baseline));
  const [skillId, setSkillId] = useState<string>(optimized[0]?.skill ?? "");
  const skill = optimized.find((s) => s.skill === skillId) ?? optimized[0] ?? null;

  if (!skill) {
    return (
      <div className="dash-card">
        <div className="section-title">
          Skill Optimization Trend
          <span className="section-sub">Visual Test win rate per iteration for one skill.</span>
        </div>
        <div className="empty-note">No optimized skill yet. Run the loop to grow a trend.</div>
      </div>
    );
  }

  const iters = skill.history.filter((h) => !h.is_baseline);
  const n = iters.length;
  const fx = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
  const X = (i: number) => padX(fx(i)) * 100;
  const Y = (pct: number) => padY(1 - pct / 100) * 100;

  const points = iters.map((it, i) => ({ it, i, rate: winRate(it) }));
  const segments: string[] = [];
  let run: string[] = [];
  for (const p of points) {
    if (p.rate === null) {
      if (run.length > 1) segments.push(run.join(" "));
      run = [];
      continue;
    }
    run.push(`${run.length ? "L" : "M"}${X(p.i).toFixed(2)},${Y(p.rate).toFixed(2)}`);
  }
  if (run.length > 1) segments.push(run.join(" "));

  // Label every iteration when few; subsample toward ~10 ticks when many.
  const step = Math.max(1, Math.ceil(n / 10));
  const xTicks: XTick[] = points
    .filter((p) => p.i % step === 0 || p.i === n - 1)
    .map((p) => ({
      frac: padX(fx(p.i)),
      label: `#${p.it.iteration}`,
      sub: p.it.decision ?? (p.rate === null ? "unscored" : undefined),
      subClass:
        p.it.decision === "KEEP" ? "tick-keep" : p.it.decision === "REJECT" ? "tick-reject" : "tick-muted"
    }));

  return (
    <div className="dash-card">
      <div className="section-title">
        Skill Optimization Trend
        <span className="section-sub">
          ▣ Visual Test win rate W/(W+L) per iteration (y) across the loop (x). Gaps mean Visual Tests were not run.
        </span>
        <span className="spacer" />
        <label className="baseline-pick">
          <span>Skill</span>
          <select value={skill.skill} onChange={(e) => setSkillId(e.target.value)} title="Pick the skill to trend">
            {optimized.map((s) => (
              <option key={s.skill} value={s.skill}>
                {skillLabel(s.skill)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="pill link-pill"
          onClick={() => {
            selectSkill(skill.skill);
            setStation("optimize");
          }}
          title="Open this skill in Optimize"
        >
          Open in Optimize →
        </button>
      </div>
      <ChartScaffold
        height={150}
        yTicks={scoreTicks()}
        xTicks={xTicks}
        ariaLabel={`Win rate per iteration for ${skillLabel(skill.skill)}, ${n} ${pluralize(n, "iteration", "iterations")}`}
        overlay={
          <>
            <span className="chart-flag parity" style={{ top: `${Y(50)}%` }}>
              parity
            </span>
            {points.map((p) =>
              p.rate === null ? (
                <span
                  key={p.i}
                  className="chart-pt none"
                  style={{ left: `${X(p.i)}%`, top: `${Y(0)}%` }}
                  title={`#${p.it.iteration}: Visual Tests were not run (no wins or losses); a gap, not a zero.`}
                />
              ) : (
                <span
                  key={p.i}
                  className="chart-pt machine"
                  style={{ left: `${X(p.i)}%`, top: `${Y(p.rate)}%` }}
                  title={`#${p.it.iteration} · ${Math.round(p.rate)}% win rate${p.it.decision ? ` · ${p.it.decision}` : ""}`}
                />
              )
            )}
          </>
        }
      >
        <line
          x1={0}
          x2={100}
          y1={Y(50)}
          y2={Y(50)}
          stroke="var(--unknown)"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--ink-machine)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </ChartScaffold>
      <div className="trend-legend">
        <span><span className="dotex machine" /> Scored iteration</span>
        <span><span className="dotex none" /> Not scored (sits on the axis)</span>
        <span><span className="dotex thr" /> Parity 50%</span>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          {n === 1 ? "One iteration so far; the trend grows with the loop." : `${n} iterations.`} KEEP / REJECT
          under each tick.
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DECLARED: full model catalogs.
   One harness at a time, grouped by vendor (who makes the model), newest
   release first, with an OBSERVED column joining each row to the optimization
   evidence on disk and an exercised/unexercised filter. The provenance rule
   holds: catalog metadata is DECLARED; the Observed column is the only cell
   that reads from artifacts, and it never guesses.
   --------------------------------------------------------------------------- */

/** Aggregated observed evidence for one (harness, model): all effort variants folded together.
 *  Keys use the bare model name (provider prefix stripped): iteration metas may record ids
 *  through a different provider alias (e.g. openai/gpt-5.5) than the catalog lists. */
interface CatalogEvidence {
  iterations: number;
  lastActive: string | null;
}

function observedEvidence(combos: ComboInsight[]): Map<string, CatalogEvidence> {
  const map = new Map<string, CatalogEvidence>();
  for (const c of combos) {
    const key = `${c.harness}|${modelShort(c.model_id)}`;
    const cur = map.get(key) ?? { iterations: 0, lastActive: null };
    cur.iterations += c.iterations;
    if (c.last_active && (!cur.lastActive || c.last_active > cur.lastActive)) cur.lastActive = c.last_active;
    map.set(key, cur);
  }
  return map;
}

/** The evidence key for a catalog row. */
function evidenceKey(spec: HarnessSpec, m: ModelSpec): string {
  return `${spec.id}|${modelShort(m.id)}`;
}

/* ---------------------------------------------------------------------------
   PROVIDER-KEYED CATALOG. A model belongs to the provider that serves it, so
   the catalog is purely provider-organized: one row per (provider, model).
   Harnesses are a launch-time concern and appear nowhere in this view; the
   registry's per-harness catalogs are only the raw ingredient this collapses.
   --------------------------------------------------------------------------- */

interface CatalogRow {
  key: string;
  model: ModelSpec;
  observed: CatalogEvidence | null;
}

/** Collapse the registry's per-harness catalogs into unique (provider, model)
 * rows, merging observed evidence across every route that exercised a model. */
function buildProviderCatalog(harnesses: HarnessSpec[], evidence: Map<string, CatalogEvidence>) {
  const rows = new Map<string, CatalogRow>();
  for (const harness of harnesses) {
    for (const model of harness.models) {
      const key = `${harness.provider}|${modelShort(model.id)}`;
      let row = rows.get(key);
      if (!row) {
        row = { key, model, observed: null };
        rows.set(key, row);
      }
      // Richer metadata wins: catalogs disagree on how much they fill in.
      if ((model.notes ?? "").length > (row.model.notes ?? "").length) row.model = model;
      const seen = evidence.get(evidenceKey(harness, model));
      if (seen) {
        const merged = row.observed ?? { iterations: 0, lastActive: null };
        merged.iterations += seen.iterations;
        if (seen.lastActive && (!merged.lastActive || seen.lastActive > merged.lastActive)) merged.lastActive = seen.lastActive;
        row.observed = merged;
      }
    }
  }
  const byProvider = new Map<string, CatalogRow[]>();
  for (const row of rows.values()) {
    const providerId = row.key.split("|")[0];
    (byProvider.get(providerId) ?? byProvider.set(providerId, []).get(providerId)!).push(row);
  }
  return byProvider;
}

const VENDOR_ORDER = ["OpenAI", "Anthropic", "Google", "Microsoft"];

function vendorRank(vendor: string | null): number {
  const idx = VENDOR_ORDER.indexOf(vendor ?? "");
  return idx === -1 ? VENDOR_ORDER.length : idx;
}

/** Release-date recency inside a vendor group: newest first, unknown last. */
function byReleaseDesc(a: ModelSpec, b: ModelSpec): number {
  if ((a.release === null) !== (b.release === null)) return a.release === null ? 1 : -1;
  if (a.release !== b.release) return (a.release ?? "") < (b.release ?? "") ? 1 : -1;
  return a.id.localeCompare(b.id);
}

function EffortRange({ levels }: { levels: string[] }) {
  if (!levels.length) {
    return (
      <span className="mono catalog-noeffort" title="No reasoning-effort control exposed for this model.">
        —
      </span>
    );
  }
  const range = levels.length === 1 ? levels[0] : `${levels[0]}–${levels[levels.length - 1]}`;
  return (
    <span className="mono catalog-effort-range" title={`${levels.length} levels: ${levels.join(" · ")}`}>
      {range}
      <span className="catalog-effort-n">{levels.length}</span>
    </span>
  );
}

/** Vision here is a MODEL attribute, nothing more: capable, text-only, or
 * unknown. Route-level concerns live where launches happen, not in a catalog. */
function CatalogVisionCell({ row }: { row: CatalogRow }) {
  const m = row.model;
  if (m.native_vision === null) return <UnknownChip small />;
  if (!m.native_vision) {
    return (
      <span className="mono catalog-novision" title="Text-only: this model accepts no images.">
        —
      </span>
    );
  }
  return (
    <span className="vision-cell on" title="Accepts image input.">
      <Eye size={13} aria-label="Vision capable" />
    </span>
  );
}

type CatalogFilter = "all" | "run" | "unrun";

function CatalogTable({
  rows,
  filter,
  onShowObserved
}: {
  rows: CatalogRow[];
  filter: CatalogFilter;
  onShowObserved: () => void;
}) {
  const groups = useMemo(() => {
    const visible = rows.filter((r) => filter === "all" || (filter === "run" ? r.observed : !r.observed));
    const byVendor = new Map<string, CatalogRow[]>();
    for (const r of visible) {
      const vendor = r.model.vendor ?? "Other";
      (byVendor.get(vendor) ?? byVendor.set(vendor, []).get(vendor)!).push(r);
    }
    return [...byVendor.entries()]
      .map(([vendor, list]) => ({ vendor, rows: [...list].sort((a, b) => byReleaseDesc(a.model, b.model)) }))
      .sort((a, b) => vendorRank(a.vendor) - vendorRank(b.vendor) || a.vendor.localeCompare(b.vendor));
  }, [rows, filter]);

  if (!groups.length) {
    return (
      <div className="empty-note">
        {filter === "run"
          ? "No model from this provider has optimization evidence on disk yet."
          : "Every model from this provider has been exercised; nothing left untested."}
      </div>
    );
  }

  return (
    <table className="matrix catalog-table">
      <caption className="sr-only">Model catalog for this provider, grouped by model vendor, with observed evidence.</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col" title="Relative per-token cost tier. Realized spend also scales with the reasoning effort used.">
            Cost
          </th>
          <th scope="col" title="Whether the model accepts image input.">
            Vision
          </th>
          <th scope="col" title="Reasoning-effort levels the model exposes. Hover a value for the full list.">
            Effort
          </th>
          <th scope="col">Context</th>
          <th scope="col">Released</th>
          <th scope="col" title="Optimization iterations recorded with this model, joined from the evidence on disk.">
            Observed
          </th>
        </tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.vendor} className="catalog-vendor">
          <tr className="catalog-group-row">
            <th colSpan={7} scope="colgroup">
              <span className="catalog-vendor-name">{g.vendor}</span>
              <span className="catalog-vendor-count">{pluralize(g.rows.length, "model")}</span>
            </th>
          </tr>
          {g.rows.map((row) => {
            const m = row.model;
            const seen = row.observed;
            return (
              <tr key={row.key}>
                <th scope="row" className="catalog-model">
                  <span className="cell-flex">
                    <span className="mono catalog-model-id">{modelShort(m.id)}</span>
                    {m.notes && (
                      <span className="catalog-note" title={m.notes}>
                        ⓘ
                      </span>
                    )}
                  </span>
                  <span className="catalog-model-sub">
                    {m.name}
                    {m.tier ? ` · ${titleWord(m.tier)}` : ""}
                  </span>
                </th>
                <td>
                  <CostMeter band={m.price_band} usd={m.price_usd_per_mtok} effort={null} />
                </td>
                <td>
                  <CatalogVisionCell row={row} />
                </td>
                <td>
                  <EffortRange levels={m.effort_levels} />
                </td>
                <td className="mono">{m.context_k ? `${m.context_k}k` : <UnknownChip small />}</td>
                <td className="mono catalog-release" title={m.release ? relativeTime(m.release) : "Release date unknown."}>
                  {m.release ?? <UnknownChip small />}
                </td>
                <td>
                  {seen ? (
                    <button
                      className="catalog-observed"
                      onClick={onShowObserved}
                      title={`${pluralize(seen.iterations, "optimization iteration")} recorded with this model. Click to open the observed table.`}
                    >
                      {pluralize(seen.iterations, "iter")}
                      {seen.lastActive ? ` · ${relativeTime(seen.lastActive)}` : ""}
                    </button>
                  ) : (
                    <span className="catalog-unrun" title="Available from this provider, but no optimization iteration or run has exercised it yet.">
                      not run
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

function titleWord(value: string): string {
  const s = value.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PROVIDER_KIND_LABEL: Record<string, string> = {
  first_party: "first-party",
  broker: "broker",
  aggregator: "aggregator",
  cloud_platform: "cloud",
  local_runtime: "local"
};

function Catalogs({ onShowObserved }: { onShowObserved: () => void }) {
  const { registry, insights } = useStore();
  const harnesses = registry?.harnesses ?? [];
  const evidence = useMemo(() => observedEvidence(insights?.combos ?? []), [insights]);
  // Purely provider-organized: one row per (provider, model).
  const catalog = useMemo(() => buildProviderCatalog(harnesses, evidence), [harnesses, evidence]);
  const providers = useMemo(() => {
    const declared = new Map((registry?.providers ?? []).map((p) => [p.id, p]));
    return [...catalog.entries()]
      .map(([id, rows]) => ({
        id,
        name: declared.get(id)?.display_name ?? id,
        kind: declared.get(id)?.kind ?? null,
        rows
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  }, [catalog, registry]);

  const [active, setActive] = useState<string>("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const provider = providers.find((p) => p.id === active) ?? providers[0] ?? null;
  if (!provider) return null;

  const runCount = provider.rows.filter((r) => r.observed).length;
  const filters: Array<{ id: CatalogFilter; label: string; count: number; hint: string }> = [
    { id: "all", label: "All", count: provider.rows.length, hint: "Every model this provider serves." },
    { id: "run", label: "Exercised", count: runCount, hint: "Models with optimization evidence on disk." },
    {
      id: "unrun",
      label: "Never run",
      count: provider.rows.length - runCount,
      hint: "Available, but no iteration or run has exercised them yet."
    }
  ];

  return (
    <div className="dash-card">
      <div className="section-title">
        <span className="st-label">Model Catalog</span>
        <span className="section-sub">
          Every model the registry knows, organized by the provider that serves it. Grouped by model vendor, newest
          release first; the Observed column joins each row to the evidence on disk.
        </span>
      </div>
      <div className="catalog-controls">
        <div className="harness-switch" role="tablist" aria-label="Catalog provider">
          {providers.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === provider.id}
              className={`harness-chip${p.id === provider.id ? " active" : ""}`}
              data-provider={p.id}
              onClick={() => setActive(p.id)}
              title={`${p.name}${p.kind ? `, ${PROVIDER_KIND_LABEL[p.kind] ?? p.kind} provider` : ""}: ${pluralize(p.rows.length, "model")}`}
            >
              {p.name}
              {p.kind && <span className="hc-provider">{PROVIDER_KIND_LABEL[p.kind] ?? p.kind}</span>}
              <span className="hc-count">{p.rows.length}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="seg-control catalog-filter" role="radiogroup" aria-label="Exercised filter">
          {filters.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={filter === f.id}
              className={filter === f.id ? "active" : ""}
              onClick={() => setFilter(f.id)}
              title={f.hint}
            >
              {f.label} <span className="mono">{f.count}</span>
            </button>
          ))}
        </div>
      </div>
      <CatalogTable rows={provider.rows} filter={filter} onShowObserved={onShowObserved} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   KPI stat tile (eval-dashboard idiom: big number, small uppercase label).
   --------------------------------------------------------------------------- */
export function Kpi({
  label,
  value,
  sub,
  tone,
  small
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "brand";
  small?: boolean;
}) {
  return (
    <div className={`kpi${tone ? ` ${tone}` : ""}`}>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value${small ? " sm" : ""}`} title={value}>{value}</span>
      {sub && <span className="kpi-sub" title={sub}>{sub}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   HARNESSES STATION (key 8): the harness as the unit of analysis: what each
   harness is, and how scorecard runs behave per harness.
   --------------------------------------------------------------------------- */
export function HarnessesStation() {
  const { registry, runs } = useStore();
  const harnesses = registry?.harnesses ?? [];

  const scored = runs.filter((r) => typeof r.overall_score === "number");
  const passRate = runs.length
    ? Math.round((runs.filter((r) => r.overall_result === "pass").length / runs.length) * 100)
    : null;
  const meanScore = scored.length
    ? Math.round((scored.reduce((s, r) => s + (r.overall_score as number), 0) / scored.length) * 100)
    : null;
  const multimodal = harnesses.filter((h) => h.multimodal).length;
  const stamped = runs.filter((r) => (r.harness ?? "unknown") !== "unknown").length;

  return (
    <div className="overview compare-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Harnesses</div>
          <div className="dash-sub">
            Declared capability (registry) beside observed run outcomes (artifacts), kept separate on purpose.
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Harnesses" value={String(harnesses.length)} sub="Registered in the registry" tone="brand" />
        <Kpi label="Runs on Disk" value={String(runs.length)} sub={`${stamped} stamped with a harness`} />
        <Kpi
          label="Run Pass Rate"
          value={passRate === null ? "—" : `${passRate}%`}
          sub="Across all runs"
          tone={passRate !== null && passRate >= 90 ? "good" : undefined}
        />
        <Kpi label="Avg Run Score" value={meanScore === null ? "—" : `${meanScore}%`} sub={`${scored.length} scored runs`} />
        <Kpi
          label="Multimodal"
          value={`${multimodal} of ${harnesses.length}`}
          sub="Codex runs Visual Tests natively"
          tone={multimodal > 0 ? "good" : "bad"}
        />
      </div>

      {harnesses.length === 0 ? (
        <div className="empty-note">Registry unavailable. The server could not read harness-registry.json.</div>
      ) : (
        <div className="hx-grid">
          {harnesses.map((h) => (
            <HarnessCard key={h.id} spec={h} />
          ))}
        </div>
      )}

      <RunsByHarness />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   MODELS STATION (key 6): the model as the unit of analysis: what is available
   at what cost, and how each exercised model actually performed.
   --------------------------------------------------------------------------- */
export function ModelsStation() {
  const { registry, insights } = useStore();
  const harnesses = registry?.harnesses ?? [];
  const combos = insights?.combos ?? [];

  // Count DISTINCT (provider, model) pairs: summing per-harness catalogs
  // double-counts every model that more than one harness can reach.
  const uniqueModels = new Set(harnesses.flatMap((h) => h.models.map((m) => `${h.provider}|${modelShort(m.id)}`)));
  const providerCount = new Set(harnesses.map((h) => h.provider)).size;
  const exercised = combos.length;
  const iterations = combos.reduce((n, c) => n + c.iterations, 0);
  const best = combos
    .filter((c) => c.win_rate !== null && c.scored_iterations >= 2)
    .sort((a, b) => (b.win_rate as number) - (a.win_rate as number))[0];
  const defaultSpec = harnesses[0];

  return (
    <div className="overview compare-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Models</div>
          <div className="dash-sub">
            Declared catalogs and cost tiers (registry) beside observed win rates (optimization metas).
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi
          label="Models Available"
          value={String(uniqueModels.size)}
          sub={`Across ${pluralize(providerCount, "provider")}`}
          tone="brand"
        />
        <Kpi label="Models Exercised" value={String(exercised)} sub="With optimization evidence on disk" />
        <Kpi
          label="Pipeline Default"
          value={defaultSpec ? modelShort(defaultSpec.default_model) : "—"}
          sub={defaultSpec ? `@${defaultSpec.default_effort} effort · ${defaultSpec.name}` : undefined}
          small
        />
        <Kpi
          label="Best Win Rate"
          value={best?.win_rate != null ? `${Math.round(best.win_rate * 100)}%` : "—"}
          sub={best ? `${modelShort(best.model_id)}, ±σ qualified` : "Needs 2+ scored iterations"}
          tone={best ? "good" : undefined}
        />
        <Kpi label="Iterations Recorded" value={String(iterations)} sub="Optimization loop total" />
      </div>

      <Combos />
      <SkillTrend />
      <Catalogs
        onShowObserved={() =>
          document.getElementById("observed-combos")?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />
    </div>
  );
}
