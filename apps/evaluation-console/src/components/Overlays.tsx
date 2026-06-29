import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { useStore } from "../store";
import { artifactUrl } from "../api";
import type { CaseView, IterationSummary, RunSummary, SkillOverview, Station } from "../types";
import { LoopBadge, Pct } from "./primitives";
import { useFocusTrap } from "../hooks/useFocusTrap";

/* ============================================================================
   OVERLAYS — Altitude 2 (DESIGN-SPEC §4e Matrix, §4f Trends, §5 Help, palette).
   Summoned by one key, dismissed with Esc (handled globally by closeOverlay).
   Every score here obeys P3: the Matrix and Trends carry the steel 0-1 / %
   world ONLY — the 0-10 eye world never co-plots. Unknown is dashed, not zero.
   ============================================================================ */

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? "info"}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Shared shell — one head + close button, mirroring the placeholder idiom.
   --------------------------------------------------------------------------- */
function OverlayShell({
  title,
  sub,
  onClose,
  children
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div
        ref={trapRef}
        tabIndex={-1}
        className="overlay-card overlay-center"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="overlay-head">
          <h2>{title}</h2>
          {sub && <span className="section-sub">{sub}</span>}
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="close (esc)">
            <X size={16} />
          </button>
        </div>
        <div className="overlay-body">{children}</div>
      </div>
    </>
  );
}

/* ===========================================================================
   (e) MATRIX — skills × categories, honest 0-1 deterministic fill (P3/P4).
   =========================================================================== */
const SKILL_ORDER = [
  "cesiumjs-3d-tiles",
  "cesiumjs-camera",
  "cesiumjs-core-utilities",
  "cesiumjs-custom-shader",
  "cesiumjs-entities",
  "cesiumjs-imagery",
  "cesiumjs-interaction",
  "cesiumjs-materials-shaders",
  "cesiumjs-models-particles",
  "cesiumjs-primitives",
  "cesiumjs-spatial-math",
  "cesiumjs-terrain-environment",
  "cesiumjs-time-properties",
  "cesiumjs-viewer-setup"
];

interface Cell {
  passed: number;
  total: number;
  crit: boolean;
  cases: number;
}

function Matrix() {
  const { caseViews, setFacetSkill, setStation, closeOverlay } = useStore();

  const { skills, categories, grid } = useMemo(() => {
    // Honest categorical encoding: bucket each deterministic CHECK by its OWN
    // category (execution / public_reproducibility / ...). The per-case category
    // is often a coarse tag ("archive"); the real category lives on each check.
    const catSet = new Set<string>();

    const present = new Set(caseViews.map((v) => v.skill));
    const skills = [...SKILL_ORDER.filter((s) => present.has(s)), ...[...present].filter((s) => !SKILL_ORDER.includes(s)).sort()];

    const grid = new Map<string, Cell>();
    const cellKey = (s: string, c: string) => `${s}::${c}`;
    for (const v of caseViews) {
      for (const chk of v.checks) {
        const cat = chk.category || "uncategorized";
        catSet.add(cat);
        const key = cellKey(v.skill, cat);
        const cell = grid.get(key) ?? { passed: 0, total: 0, crit: false, cases: 0 };
        cell.cases += 1;
        cell.total += 1;
        if (chk.result === "pass") cell.passed += 1;
        if (chk.result === "fail" && chk.critical) cell.crit = true;
        grid.set(key, cell);
      }
    }
    const categories = [...catSet].sort();
    return { skills, categories, grid };
  }, [caseViews]);

  if (caseViews.length === 0) {
    return <div className="empty-note">No scorecard loaded — nothing to map.</div>;
  }

  const onCell = (skill: string) => {
    setFacetSkill(skill);
    setStation("review");
    closeOverlay();
  };

  return (
    <>
      <div className="matrix-legend">
        <span><span className="lg-swatch" /> steel = checks passed / total</span>
        <span><span className="lg-swatch empty" /> no checks run</span>
        <span style={{ color: "var(--crit)" }}>! critical failure</span>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>0–1 deterministic · click a row → Review</span>
      </div>
      <table className="matrix">
        <caption className="sr-only">Skills by check category: deterministic checks passed over total.</caption>
        <thead>
          <tr>
            <th />
            {categories.map((c) => (
              <th key={c} scope="col" title={c}>
                {c.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
      <tbody>
        {skills.map((skill) => (
          <tr key={skill}>
            <th scope="row" className="skill-name">{skill.replace("cesiumjs-", "")}</th>
            {categories.map((cat) => {
              const cell = grid.get(`${skill}::${cat}`);
              if (!cell || cell.total === 0) {
                return <td key={cat} className="cell empty" title={`${skill} · ${cat} · no checks`} />;
              }
              const ratio = cell.passed / cell.total;
              return (
                <td
                  key={cat}
                  className={`cell${cell.crit ? " crit" : ""}`}
                  title={`${skill} · ${cat} · ${cell.passed}/${cell.total} checks${cell.crit ? " · critical ✗" : ""}`}
                  onClick={() => onCell(skill)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCell(skill);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${skill.replace("cesiumjs-", "")} ${cat.replace(/_/g, " ")}: ${cell.passed} of ${cell.total} checks pass`}
                >
                  <span
                    className="cell-fill"
                    style={{ width: `${Math.round(ratio * 100)}%`, opacity: 0.16 + ratio * ratio * 0.84 }}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

/* ===========================================================================
   (f) TRENDS — visual win-rate across iterations + decision history (P3/P4).
   =========================================================================== */
function winRate(it: IterationSummary): number | null {
  const { wins, losses } = it.counts;
  const denom = wins + losses;
  if (denom === 0) return null; // gap, NOT a zero dip (P4)
  return (wins / denom) * 100;
}

function Trends() {
  const { selectedSkillData, skills } = useStore();
  const skill: SkillOverview | null =
    selectedSkillData ?? skills.find((s) => s.history.some((h) => !h.is_baseline)) ?? skills[0] ?? null;

  if (!skill) {
    return <div className="empty-note">No optimized skill yet — run the loop to grow a trend.</div>;
  }

  const iters = skill.history.filter((h) => !h.is_baseline);
  if (iters.length === 0) {
    return <div className="empty-note">{skill.skill.replace("cesiumjs-", "")} has no completed iterations yet.</div>;
  }

  // Geometry — a steel polyline over the win-rate %, gaps where judges didn't score.
  const W = 640;
  const H = 134;
  const padX = 28;
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
    <>
      <div style={{ fontSize: "var(--fs-50)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-machine)", marginBottom: "var(--sp-2)" }}>
        ▣ visual win-rate · steel % · W/(W+L) per iteration
      </div>
      <div className="trend-chart">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label="win-rate trend">
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

      <div style={{ position: "relative", height: 16, marginTop: "var(--sp-2)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
        {points.map((p) => (
          <span
            key={p.i}
            style={{
              position: "absolute",
              left: `${(x(p.i) / W) * 100}%`,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap"
            }}
          >
            {p.it.iteration}{" "}
            {p.rate === null ? <span style={{ color: "var(--unknown)" }} title="not scored">◌</span> : <Pct value={p.rate} />}
          </span>
        ))}
      </div>

      <div style={{ fontSize: "var(--fs-50)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)", margin: "var(--sp-4) 0 var(--sp-2)" }}>
        decision history
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "center" }}>
        {iters.map((it) => (
          <span key={it.iteration} style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-50)", color: "var(--text-3)" }}>
            <span style={{ color: "var(--text-2)" }}>{it.iteration}</span>
            {it.decision ? (
              <LoopBadge decision={it.decision} rule={it.rule_fired} />
            ) : (
              <span style={{ color: "var(--unknown)" }}>{it.status === "running" ? "● running" : "—"}</span>
            )}
            {it.rule_fired && <span>{it.rule_fired}</span>}
          </span>
        ))}
      </div>
    </>
  );
}

/* ===========================================================================
   (h) HARNESS — label · switch · compare. The active harness is the persistent
   lens; switching it scopes the run list ONLY (Enter loads a run via switchRun).
   The compare scoreboard aggregates RUN-LEVEL signals per harness (the only
   cross-harness data the client holds); deterministic 0-1 stays steel, the
   signed Δ rides a SEPARATE diverging channel, and unknown is dashed (P3/P4).
   =========================================================================== */
interface HarnessAgg {
  harness: string;
  runCount: number;
  passRuns: number;
  passRate: number | null; // runs whose overall_result === pass, 0-1
  visPass: number;
  visNeeds: number;
  visFail: number;
  latest: RunSummary | null;
}

function HarnessOverlay() {
  const { runs, harnesses, activeHarness, setActiveHarness, visibleRuns, switchRun, scorecard, config } =
    useStore();
  const [cur, setCur] = useState(0);

  const aggs = useMemo<HarnessAgg[]>(() => {
    const by = new Map<string, RunSummary[]>();
    for (const r of runs) {
      const h = r.harness ?? "unknown";
      (by.get(h) ?? by.set(h, []).get(h)!).push(r);
    }
    return [...by.entries()]
      .map(([harness, list]) => {
        const passRuns = list.filter((r) => r.overall_result === "pass").length;
        const latest = list.reduce<RunSummary | null>(
          (best, r) => (!best || r.timestamp_utc > best.timestamp_utc ? r : best),
          null
        );
        return {
          harness,
          runCount: list.length,
          passRuns,
          passRate: list.length ? passRuns / list.length : null,
          visPass: list.reduce((n, r) => n + (r.pass_count || 0), 0),
          visNeeds: list.reduce((n, r) => n + (r.needs_review_count || 0), 0),
          visFail: list.reduce((n, r) => n + (r.fail_count || 0), 0),
          latest
        };
      })
      .sort((a, b) => a.harness.localeCompare(b.harness));
  }, [runs]);

  // Δ baseline: the active harness (else the highest-volume harness).
  const baseHarness = activeHarness ?? aggs.reduce<HarnessAgg | null>((b, a) => (!b || a.runCount > b.runCount ? a : b), null)?.harness ?? null;
  const baseRate = aggs.find((a) => a.harness === baseHarness)?.passRate ?? null;

  // keep the run cursor inside the scoped list
  useEffect(() => setCur(0), [activeHarness]);
  const list = visibleRuns;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCur((c) => Math.min(list.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = list[cur];
      if (r) void switchRun(r.run_id);
    }
  };

  const chips = ["all", ...harnesses];
  const activeKey = activeHarness ?? "all";
  const judge = config?.harness_judge;

  return (
    <div onKeyDown={onKey} tabIndex={-1}>
      {/* SWITCH — pick the lens; selecting re-scopes the run list only. */}
      <div className="harness-switch" role="tablist" aria-label="harness lens">
        {chips.map((h) => (
          <button
            key={h}
            role="tab"
            aria-selected={h === activeKey}
            className={`harness-chip${h === activeKey ? " active" : ""}`}
            data-harness={h === "all" ? undefined : h}
            onClick={() => setActiveHarness(h === "all" ? null : h)}
          >
            {h}
            {h !== "all" && (
              <span className="hc-count">{aggs.find((a) => a.harness === h)?.runCount ?? 0}</span>
            )}
          </button>
        ))}
        {judge && (
          <span className="harness-judge-note" title="qualitative judge harness (separate from the tested codegen harness)">
            judge: <span className="mono">{judge}</span>
          </span>
        )}
      </div>

      {/* COMPARE — run-level performance per harness (steel pass-rate + signed Δ). */}
      <div className="matrix-legend" style={{ marginTop: "var(--sp-3)" }}>
        <span><span className="lg-swatch" /> steel = runs passed / runs</span>
        <span>Δ = pass-rate vs <span className="mono">{baseHarness ?? "—"}</span></span>
        <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>run-level · click a row → scope the list</span>
      </div>
      <table className="matrix harness-compare">
        <caption className="sr-only">Per-harness run-level performance.</caption>
        <thead>
          <tr>
            <th scope="col">harness</th>
            <th scope="col">runs</th>
            <th scope="col">pass-rate</th>
            <th scope="col">Δ</th>
            <th scope="col" title="visual pass / needs-review / fail across runs">vis P / ? / F</th>
            <th scope="col">latest run</th>
          </tr>
        </thead>
        <tbody>
          {aggs.map((a) => {
            const unknown = a.harness === "unknown";
            const delta =
              baseRate !== null && a.passRate !== null && a.harness !== baseHarness ? a.passRate - baseRate : null;
            return (
              <tr
                key={a.harness}
                className={`hc-row${a.harness === activeKey ? " active" : ""}`}
                onClick={() => setActiveHarness(unknown ? "unknown" : a.harness)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveHarness(a.harness);
                  }
                }}
              >
                <th scope="row" className="hc-name">
                  <span className={`harness-dot${unknown ? " unknown" : ""}`} data-harness={unknown ? undefined : a.harness} aria-hidden />
                  {a.harness}
                </th>
                <td className="mono hc-num">{a.runCount}</td>
                <td className="hc-rate">
                  {a.passRate === null ? (
                    <span className="unknown-dash" title="no runs">◌</span>
                  ) : (
                    <>
                      <span className="hc-bar" style={{ width: `${Math.round(a.passRate * 100)}%`, opacity: 0.16 + a.passRate * a.passRate * 0.84 }} />
                      <span className="mono hc-rate-num">{Math.round(a.passRate * 100)}%</span>
                    </>
                  )}
                </td>
                <td className="mono hc-delta">
                  {delta === null ? (
                    <span style={{ color: "var(--text-3)" }}>—</span>
                  ) : (
                    <span className={`delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
                      {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {Math.abs(Math.round(delta * 100))}%
                    </span>
                  )}
                </td>
                <td className="mono hc-vis">
                  <span style={{ color: "var(--pass)" }}>{a.visPass}</span> /{" "}
                  <span style={{ color: "var(--unknown)" }}>{a.visNeeds}</span> /{" "}
                  <span style={{ color: "var(--crit)" }}>{a.visFail}</span>
                </td>
                <td className="mono hc-latest" title={a.latest?.run_id ?? ""}>
                  {a.latest ? (
                    <>
                      {a.latest.run_id.slice(0, 16)}
                      {a.latest.git_commit && <span style={{ color: "var(--text-3)" }}> · {a.latest.git_commit.slice(0, 7)}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {aggs.length < 2 && (
        <div className="empty-note" style={{ marginTop: "var(--sp-2)" }}>
          Only one harness discovered{activeHarness ? ` (${activeHarness})` : ""} — run another harness to compare.
        </div>
      )}

      {/* SWITCH target — the scoped run list; Enter (or click) loads a run. */}
      <div style={{ fontSize: "var(--fs-50)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)", margin: "var(--sp-4) 0 var(--sp-2)" }}>
        runs{activeHarness ? ` · ${activeHarness}` : " · all harnesses"} <span className="kbd">↑</span><span className="kbd">↓</span> <span className="kbd">↵</span> load
      </div>
      <div className="harness-runlist">
        {list.length === 0 ? (
          <div className="empty-note">no runs for this harness</div>
        ) : (
          list.map((r, i) => {
            const loaded = scorecard?.runId === r.run_id;
            return (
              <div
                key={r.run_id}
                className={`harness-run${i === cur ? " cur" : ""}${loaded ? " loaded" : ""}`}
                onMouseEnter={() => setCur(i)}
                onClick={() => void switchRun(r.run_id)}
              >
                <span className="harness-dot" data-harness={(r.harness ?? "unknown") === "unknown" ? undefined : r.harness} aria-hidden />
                <span className="mono hr-id">{r.run_id.slice(0, 28)}</span>
                <span className="mono" style={{ color: "var(--text-3)" }}>{r.git_commit.slice(0, 7)}</span>
                <span className={`hr-result ${r.overall_result === "pass" ? "ok" : "bad"}`}>{r.overall_result || "—"}</span>
                <span className="mono" style={{ color: "var(--text-3)", marginLeft: "auto" }}>{r.timestamp_utc.slice(0, 16).replace("T", " ")}</span>
                {loaded && <span className="hr-loaded">loaded</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ===========================================================================
   COMMAND PALETTE — fuzzy over cases, skills, stations (⌘K).
   =========================================================================== */
interface PaletteItem {
  kind: "case" | "skill" | "station";
  label: string;
  hint?: string;
  run: () => void;
}

const STATIONS: { id: Station; label: string }[] = [
  { id: "evaluate", label: "Evaluate" },
  { id: "review", label: "Review" },
  { id: "optimize", label: "Optimize" },
  { id: "decide", label: "Decide" },
  { id: "promote", label: "Promote" }
];

function fuzzy(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

function Palette() {
  const { caseViews, skills, selectKey, selectSkill, setStation, closeOverlay } = useStore();
  const trapRef = useFocusTrap<HTMLDivElement>();
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    const caseItems: PaletteItem[] = caseViews.map((v: CaseView) => ({
      kind: "case",
      label: v.case_name || v.case_id,
      hint: `${v.skill.replace("cesiumjs-", "")}/${v.case_id}`,
      run: () => {
        selectKey(v.key);
        setStation("review");
      }
    }));
    const skillItems: PaletteItem[] = skills.map((s) => ({
      kind: "skill",
      label: s.skill.replace("cesiumjs-", ""),
      hint: `${s.iteration_count} iter · ${s.kept}K/${s.rejected}R`,
      run: () => {
        selectSkill(s.skill);
        setStation("optimize");
      }
    }));
    const stationItems: PaletteItem[] = STATIONS.map((st) => ({
      kind: "station",
      label: st.label,
      hint: "station",
      run: () => setStation(st.id)
    }));
    return [...caseItems, ...skillItems, ...stationItems];
  }, [caseViews, skills, selectKey, selectSkill, setStation]);

  const filtered = useMemo(
    () => items.filter((it) => fuzzy(q, `${it.label} ${it.hint ?? ""}`)).slice(0, 12),
    [items, q]
  );

  useEffect(() => setCur(0), [q]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCur((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCur((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[cur];
      if (item) {
        item.run();
        closeOverlay();
      }
    } else if (e.key === "Escape") {
      closeOverlay();
    }
  };

  return (
    <>
      <div className="scrim" onClick={closeOverlay} aria-hidden />
      <div ref={trapRef} className="overlay-card palette" role="dialog" aria-modal="true" aria-label="command palette">
        <input
          autoFocus
          value={q}
          placeholder="jump to a case, skill, or station…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-label="command palette filter"
        />
        <div style={{ borderTop: "1px solid var(--hairline)", paddingBottom: "var(--sp-2)" }}>
          {filtered.length === 0 ? (
            <div className="empty-note">no matches</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={`${it.kind}-${it.label}-${i}`}
                className={`palette-item${i === cur ? " cur" : ""}`}
                onMouseEnter={() => setCur(i)}
                onClick={() => {
                  it.run();
                  closeOverlay();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="mono" style={{ fontSize: "var(--fs-50)", color: "var(--text-3)" }}>{it.hint}</span>}
                <span className="pi-kind">{it.kind}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/* ===========================================================================
   HELP — the keyboard grammar (DESIGN-SPEC §5).
   =========================================================================== */
const HELP_ROWS: { keys: string[]; desc: string }[] = [
  { keys: ["j", "k"], desc: "next / prev in stream (worst-first)" },
  { keys: ["↓", "↑"], desc: "next / prev (same as j/k)" },
  { keys: ["gg", "G"], desc: "jump to top (worst) / bottom" },
  { keys: ["Enter"], desc: "commit cursor → stage / trust" },
  { keys: ["Esc"], desc: "up one altitude / close overlay" },
  { keys: ["1", "·", "5"], desc: "jump station: eval / review / opt / decide / promote" },
  { keys: ["a"], desc: "accept (review)" },
  { keys: ["f"], desc: "flag → focus.json (the only loop seed)" },
  { keys: ["d"], desc: "defer (review)" },
  { keys: ["e"], desc: "confirm decision → advance (review)" },
  { keys: ["u"], desc: "undo last decision (toast)" },
  { keys: ["n"], desc: "next flag / deferral below" },
  { keys: ["space"], desc: "expand details (review)" },
  { keys: ["z"], desc: "zoom render (lightbox); z again closes" },
  { keys: ["x"], desc: "swipe-diff (decide)" },
  { keys: ["X"], desc: "blink-compare (decide)" },
  { keys: ["[", "]"], desc: "prev / next shot · scenario" },
  { keys: ["m"], desc: "matrix overlay" },
  { keys: ["t"], desc: "trends overlay" },
  { keys: ["h"], desc: "harness label / switch / compare" },
  { keys: ["?"], desc: "this help" },
  { keys: ["⌘", "K"], desc: "command palette" },
  { keys: ["T"], desc: "toggle theme" }
];

function Help() {
  return (
    <div className="help-grid">
      {HELP_ROWS.map((r, i) => (
        <div key={i} className="help-row">
          <span className="keys">
            {r.keys.map((k, j) =>
              k === "·" ? (
                <span key={j} style={{ color: "var(--text-3)" }}>
                  ·
                </span>
              ) : (
                <span key={j} className="kbd">
                  {k}
                </span>
              )
            )}
          </span>
          <span>{r.desc}</span>
        </div>
      ))}
    </div>
  );
}

/* ===========================================================================
   JOURNAL — a flat listing of the loaded iteration's journal events.
   =========================================================================== */
function Journal() {
  const { iterationDetail, iterationLoading } = useStore();
  if (iterationLoading) return <div className="empty-note">loading journal…</div>;
  if (!iterationDetail || iterationDetail.journal.length === 0) {
    return <div className="empty-note">No journal events for this iteration.</div>;
  }
  return (
    <div>
      {iterationDetail.journal.map((ev, i) => {
        const failed = typeof ev.event === "string" && ev.event.includes("fail");
        const ts = ev.timestamp_utc ? String(ev.timestamp_utc).slice(11, 19) : "";
        return (
          <div key={i} className={`journal-line${failed ? " fail" : ""}`}>
            <span>{ts}</span>
            <span className="jl-ev">{ev.event}</span>
            {ev.step && <span>{ev.step}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ===========================================================================
   LIGHTBOX — fullscreen render on a near-black scrim (z / click closes).
   =========================================================================== */
function Lightbox() {
  const { selectedView, shotIndex, closeOverlay } = useStore();
  const shots = selectedView?.screenshots ?? [];
  const src = shots.length ? artifactUrl(shots[Math.min(shotIndex, shots.length - 1)]) : "";
  return (
    <div
      className="scrim"
      onClick={closeOverlay}
      style={{
        background: "color-mix(in srgb, #000 92%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "zoom-out"
      }}
    >
      {src ? (
        <img
          src={src}
          alt={selectedView?.case_name ?? "render"}
          style={{ maxWidth: "94vw", maxHeight: "94vh", objectFit: "contain" }}
        />
      ) : (
        <div className="empty-note">No render captured for this case.</div>
      )}
    </div>
  );
}

/* ===========================================================================
   DISPATCH
   =========================================================================== */
export function Overlays() {
  const { overlay, closeOverlay, selectedSkillData } = useStore();
  if (!overlay) return null;

  if (overlay === "palette") return <Palette />;
  if (overlay === "lightbox") return <Lightbox />;

  if (overlay === "matrix") {
    return (
      <OverlayShell title="Matrix" sub="skills × categories · deterministic 0-1 only" onClose={closeOverlay}>
        <Matrix />
      </OverlayShell>
    );
  }
  if (overlay === "trends" || overlay === "dimensionMatrix") {
    return (
      <OverlayShell
        title="Trends"
        sub={selectedSkillData ? selectedSkillData.skill.replace("cesiumjs-", "") : "win-rate over iterations"}
        onClose={closeOverlay}
      >
        <Trends />
      </OverlayShell>
    );
  }
  if (overlay === "journal") {
    return (
      <OverlayShell title="Journal" sub="iteration events" onClose={closeOverlay}>
        <Journal />
      </OverlayShell>
    );
  }
  if (overlay === "harness") {
    return (
      <OverlayShell title="Harness" sub="label · switch · compare · the tested codegen harness" onClose={closeOverlay}>
        <HarnessOverlay />
      </OverlayShell>
    );
  }
  // help (and any future fallthrough)
  return (
    <OverlayShell title="Keyboard" sub="one grammar, both lifecycles" onClose={closeOverlay}>
      <Help />
    </OverlayShell>
  );
}
