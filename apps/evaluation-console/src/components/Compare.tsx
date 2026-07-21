import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Star } from "lucide-react";
import { useStore } from "../store";
import {
  fmtDuration,
  modelShort,
  pluralize,
  priceBandIndex,
  priceBandLabel,
  relativeTime,
  skillLabel
} from "../lib/format";
import { Pct, UnknownChip } from "./primitives";
import type { ComboInsight, HarnessSpec, IterationSummary, ModelSpec, RunSummary } from "../types";

/* ============================================================================
   MODELS & HARNESSES (Insights, key 6).
   Two truths, visually separated and never conflated (the provenance rule):
     DECLARED  what the registry says a harness or model CAN do (capability
               cards and catalogs: price, effort, vision metadata).
     OBSERVED  what the artifacts on disk actually recorded (run outcomes per
               harness; per model-and-effort combo: keep rate, win rate with
               stability, wall clock, recency) with drill-down to the exact
               iterations, then into Optimize for the evidence.
   Ink law holds: deterministic rates are steel 0-1/%; the harness dimension is
   the categorical indigo; unknown renders dashed slate, never as a zero.
   Copy convention: Title Case for headers, sentence case for prose; only real
   identifiers (model ids, binaries, CLI flags) stay lowercase mono.
   ============================================================================ */

const UNRECORDED = "unrecorded";

function HarnessChip({ harness }: { harness: string }) {
  const unknown = harness === "unknown" || harness === UNRECORDED;
  const label = unknown ? (harness === UNRECORDED ? "Unrecorded" : "Unknown") : harness;
  return (
    <span className={`harness-pill${unknown ? " unrecorded" : ""}`} data-harness={unknown ? undefined : harness}>
      <span className={`harness-dot${unknown ? " unknown" : ""}`} data-harness={unknown ? undefined : harness} aria-hidden />
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

function harnessRunAgg(runs: RunSummary[]): HarnessRuns[] {
  const by = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const h = r.harness ?? "unknown";
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
    .sort((a, b) => a.harness.localeCompare(b.harness));
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
                    {a.harness === "unknown" && (
                      <span className="hint-unrecorded" title="These scorecards predate harness stamping.">
                        Not stamped
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
        <td className="mono hc-latest">{combo.last_used ? relativeTime(combo.last_used) : "—"}</td>
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
    <div className="dash-card">
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
              <th scope="col" title="Visual win rate W/(W+L), with per-iteration stability.">Win Rate · Stability</th>
              <th scope="col">Avg Time</th>
              <th scope="col">Skills</th>
              <th scope="col">Last Used</th>
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
   TRENDS: run score across time or repository progression (run sequence).
   --------------------------------------------------------------------------- */
export function RunTrend() {
  const { runs, switchRun, scorecard } = useStore();
  const [axis, setAxis] = useState<"time" | "sequence">("sequence");

  const points = useMemo(() => {
    return runs
      .filter((r) => typeof r.overall_score === "number" && r.timestamp_utc)
      .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
  }, [runs]);

  if (points.length < 2) {
    return (
      <div className="dash-card">
        <div className="section-title">
          Run Score Trend
          <span className="section-sub">Across runs, chronological or by run sequence.</span>
        </div>
        <div className="empty-note">
          {points.length === 0
            ? "No scored runs on disk yet, so there is nothing to trend."
            : "Only one scored run so far. A second run grows the trend."}
        </div>
      </div>
    );
  }

  const W = 860;
  const H = 150;
  const padX = 34;
  const padY = 18;
  const t0 = Date.parse(points[0].timestamp_utc);
  const t1 = Date.parse(points[points.length - 1].timestamp_utc);
  const x = (r: RunSummary, i: number) => {
    if (axis === "sequence" || t1 === t0) {
      return points.length === 1 ? W / 2 : padX + (i / (points.length - 1)) * (W - padX * 2);
    }
    return padX + ((Date.parse(r.timestamp_utc) - t0) / (t1 - t0)) * (W - padX * 2);
  };
  const y = (score: number) => padY + (1 - score) * (H - padY * 2);
  const path = points
    .map((r, i) => `${i === 0 ? "M" : "L"}${x(r, i).toFixed(1)},${y(r.overall_score as number).toFixed(1)}`)
    .join(" ");
  const threshold = points[points.length - 1].threshold;

  return (
    <div className="dash-card">
      <div className="section-title">
        Run Score Trend
        <span className="section-sub">▣ Steel overall score per run. Dot color is the run result.</span>
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
      <div className="trend-chart trend-runs">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="Overall score per run">
          {[0, 0.5, 1].map((g) => (
            <line key={g} x1={padX} x2={W - padX} y1={y(g)} y2={y(g)} stroke="var(--hairline)" strokeWidth={1} />
          ))}
          {typeof threshold === "number" && (
            <line
              x1={padX}
              x2={W - padX}
              y1={y(threshold)}
              y2={y(threshold)}
              stroke="var(--defer)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          <path d={path} fill="none" stroke="var(--ink-machine)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((r, i) => {
            const loaded = scorecard?.runId === r.run_id;
            return (
              <circle
                key={r.run_id}
                cx={x(r, i)}
                cy={y(r.overall_score as number)}
                r={loaded ? 6 : 4.5}
                fill={r.overall_result === "pass" ? "var(--pass)" : "var(--fail)"}
                stroke={loaded ? "var(--live)" : "var(--canvas)"}
                strokeWidth={loaded ? 2.5 : 1.5}
                style={{ cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-label={`${r.run_id}: ${Math.round((r.overall_score as number) * 100)}% ${r.overall_result}. Click to load.`}
                onClick={() => void switchRun(r.run_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void switchRun(r.run_id);
                }}
              >
                <title>
                  {r.run_id} · {Math.round((r.overall_score as number) * 100)}% · {r.overall_result} ·{" "}
                  {r.git_commit.slice(0, 7)} · {r.timestamp_utc.slice(0, 16).replace("T", " ")}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>
      <div className="trend-legend">
        <span><span className="dotex pass" /> Pass</span>
        <span><span className="dotex fail" /> Fail</span>
        <span><span className="dotex thr" /> Threshold</span>
        <span><span className="dotex loaded" /> Loaded run</span>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
          {axis === "sequence" ? "Even spacing in run order (repository progression)." : "True wall-clock spacing."}{" "}
          Click a dot to load that run.
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
          <span className="section-sub">Visual win rate per iteration for one skill.</span>
        </div>
        <div className="empty-note">No optimized skill yet. Run the loop to grow a trend.</div>
      </div>
    );
  }

  const iters = skill.history.filter((h) => !h.is_baseline);
  const W = 860;
  const H = 134;
  const padX = 30;
  const padY = 16;
  const n = iters.length;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2));
  const y = (pct: number) => padY + (1 - pct / 100) * (H - padY * 2);

  const points = iters.map((it, i) => ({ it, i, rate: winRate(it) }));
  const segments: string[] = [];
  let run: string[] = [];
  for (const p of points) {
    if (p.rate === null) {
      if (run.length) segments.push(run.join(" "));
      run = [];
      continue;
    }
    run.push(`${run.length ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.rate).toFixed(1)}`);
  }
  if (run.length) segments.push(run.join(" "));

  return (
    <div className="dash-card">
      <div className="section-title">
        Skill Optimization Trend
        <span className="section-sub">▣ Visual win rate W/(W+L) per iteration. Gaps mean the judges did not score.</span>
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
      <div className="trend-chart">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="Win rate trend">
          {[0, 50, 100].map((g) => (
            <line key={g} x1={padX} x2={W - padX} y1={y(g)} y2={y(g)} stroke="var(--hairline)" strokeWidth={1} />
          ))}
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--ink-machine)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {points.map((p) =>
            p.rate === null ? (
              <circle key={p.i} cx={x(p.i)} cy={y(50)} r={3} fill="none" stroke="var(--unknown)" strokeWidth={1} strokeDasharray="2 2" />
            ) : (
              <circle key={p.i} cx={x(p.i)} cy={y(p.rate)} r={3.5} fill="var(--ink-machine)" />
            )
          )}
        </svg>
      </div>
      <div className="skill-trend-ticks">
        {points.map((p) => (
          <span key={p.i} className="mono">
            #{p.it.iteration}{" "}
            {p.rate === null ? (
              <span style={{ color: "var(--unknown)" }} title="Not scored">◌</span>
            ) : (
              <Pct value={p.rate} />
            )}
            {p.it.decision && (
              <span className={p.it.decision === "KEEP" ? "tick-keep" : "tick-reject"}> {p.it.decision}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DECLARED: full model catalogs, one harness at a time.
   --------------------------------------------------------------------------- */
function CatalogTable({ spec }: { spec: HarnessSpec }) {
  const effective = (m: ModelSpec): boolean | null => {
    if (!spec.multimodal) return false; // Provider-level kill switch.
    return m.native_vision;
  };
  return (
    <table className="matrix catalog-table">
      <caption className="sr-only">{spec.name} model catalog with metadata.</caption>
      <thead>
        <tr>
          <th scope="col">Model</th>
          <th scope="col">Tier</th>
          <th scope="col" title="Relative cost tier. Actual spend also scales with the reasoning effort used.">Cost</th>
          <th scope="col" title="Can the model natively accept images?">Native Vision</th>
          <th scope="col" title="What this harness and provider actually allow.">Available Here</th>
          <th scope="col">Effort Levels</th>
          <th scope="col">Context</th>
          <th scope="col">Released</th>
        </tr>
      </thead>
      <tbody>
        {spec.models.map((m) => {
          const isDefault = m.id === spec.default_model;
          return (
            <tr key={m.id} className={isDefault ? "catalog-default" : undefined}>
              <th scope="row" className="catalog-model">
                <span className="cell-flex">
                  {isDefault && <Star size={12} className="star" aria-label="Pipeline default" />}
                  <span className="mono">{modelShort(m.id)}</span>
                  {m.notes && (
                    <span className="catalog-note" title={m.notes}>
                      ⓘ
                    </span>
                  )}
                </span>
              </th>
              <td>{m.tier ? titleWord(m.tier) : <UnknownChip small />}</td>
              <td>
                <CostMeter band={m.price_band} usd={m.price_usd_per_mtok} effort={isDefault ? spec.default_effort : null} />
              </td>
              <td>
                {m.native_vision === null ? (
                  <UnknownChip small />
                ) : m.native_vision ? (
                  <Check size={13} className="glyph-pass" aria-label="Yes" />
                ) : (
                  <span className="mono">—</span>
                )}
              </td>
              <td>
                <VisionChip enabled={effective(m)} note={spec.multimodal ? undefined : spec.vision_note} />
              </td>
              <td className="mono catalog-efforts">
                {m.effort_levels.length ? m.effort_levels.join(" · ") : <UnknownChip small />}
              </td>
              <td className="mono">{m.context_k ? `${m.context_k}k` : <UnknownChip small />}</td>
              <td className="mono">{m.release ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function titleWord(value: string): string {
  const s = value.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Catalogs() {
  const { registry } = useStore();
  const harnesses = registry?.harnesses ?? [];
  const [active, setActive] = useState<string>(harnesses[0]?.id ?? "");
  const spec = harnesses.find((h) => h.id === active) ?? harnesses[0] ?? null;
  if (!spec) return null;
  return (
    <div className="dash-card">
      <div className="section-title">
        Model Catalogs
        <span className="section-sub">
          {spec.catalog_source}. Cost tiers are per-token; realized spend scales with reasoning effort, which bills
          as output tokens.
        </span>
      </div>
      <div className="harness-switch" role="tablist" aria-label="Catalog harness">
        {harnesses.map((h) => (
          <button
            key={h.id}
            role="tab"
            aria-selected={h.id === spec.id}
            className={`harness-chip${h.id === spec.id ? " active" : ""}`}
            data-harness={h.id}
            onClick={() => setActive(h.id)}
          >
            {h.name}
            <span className="hc-count">{h.models.length}</span>
          </button>
        ))}
      </div>
      <CatalogTable spec={spec} />
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
   HARNESSES DASHBOARD — the harness as the unit of analysis: what each harness
   is, and how scorecard runs behave per harness over time.
   --------------------------------------------------------------------------- */
function HarnessesDashboard() {
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
    <>
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
          sub="Codex judges screenshots natively"
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
      <RunTrend />
    </>
  );
}

/* ---------------------------------------------------------------------------
   MODELS DASHBOARD — the model as the unit of analysis: what is available at
   what cost, and how each exercised model actually performed.
   --------------------------------------------------------------------------- */
function ModelsDashboard() {
  const { registry, insights } = useStore();
  const harnesses = registry?.harnesses ?? [];
  const combos = insights?.combos ?? [];

  const totalModels = harnesses.reduce((n, h) => n + h.models.length, 0);
  const exercised = combos.length;
  const iterations = combos.reduce((n, c) => n + c.iterations, 0);
  const best = combos
    .filter((c) => c.win_rate !== null && c.scored_iterations >= 2)
    .sort((a, b) => (b.win_rate as number) - (a.win_rate as number))[0];
  const defaultSpec = harnesses[0];

  return (
    <>
      <div className="kpi-row">
        <Kpi
          label="Models Available"
          value={String(totalModels)}
          sub={`Across ${pluralize(harnesses.length, "harness", "harnesses")}`}
          tone="brand"
        />
        <Kpi label="Models Exercised" value={String(exercised)} sub="With optimization evidence on disk" />
        <Kpi
          label="Pipeline Default"
          value={defaultSpec ? modelShort(defaultSpec.default_model) : "—"}
          sub={defaultSpec ? `@${defaultSpec.default_effort} effort, both harnesses` : undefined}
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
      <Catalogs />
    </>
  );
}

/* ---------------------------------------------------------------------------
   The workspace: one insights surface, two dashboards.
   --------------------------------------------------------------------------- */
export function CompareStation() {
  const [tab, setTab] = useState<"harnesses" | "models">("harnesses");
  return (
    <div className="overview compare-station">
      <div className="dash-head">
        <div>
          <div className="dash-title">Models &amp; Harnesses</div>
          <div className="dash-sub">
            Declared capability (registry) beside observed performance (artifacts), kept separate on purpose.
          </div>
        </div>
        <span className="spacer" />
        <div className="seg-control" role="tablist" aria-label="Insights dashboard">
          <button role="tab" aria-selected={tab === "harnesses"} className={tab === "harnesses" ? "active" : ""} onClick={() => setTab("harnesses")}>
            Harnesses
          </button>
          <button role="tab" aria-selected={tab === "models"} className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>
            Models
          </button>
        </div>
      </div>

      {tab === "harnesses" ? <HarnessesDashboard /> : <ModelsDashboard />}
    </div>
  );
}
