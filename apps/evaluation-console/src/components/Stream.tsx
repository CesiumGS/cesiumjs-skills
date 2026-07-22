import { useEffect, useRef, type KeyboardEvent } from "react";
import { useStore } from "../store";
import type { CaseView, FilterKind, ScenarioDetail, SkillOverview } from "../types";
import { Score01, Score10, ScenarioChip, UnknownChip } from "./primitives";

/** Keep the keyboard-selected row in view as j/k/gg/G move the cursor. */
function useFollowSelection(selected: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return ref;
}

/** Stable DOM id for an option (aria-activedescendant target). */
function optionId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * ARIA listbox keyboard contract (WCAG 4.1.2): the container is the focus
 * target; arrows/Home/End move the active option locally. stopPropagation
 * keeps the global j/k handler from double-moving the cursor.
 */
function listboxKeys(move: (delta: number) => void, jump: (edge: "start" | "end") => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      jump("start");
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      jump("end");
    }
  };
}

const FILTERS: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "flag", label: "Flagged" },
  { id: "defer", label: "Deferred" },
  { id: "accept", label: "Accepted" },
  { id: "not_reviewed", label: "Unreviewed" }
];

function FacetBar() {
  const { filter, setFilter, facetSkill, setFacetSkill, scorecard, caseViews, caseScope, setCaseScope } =
    useStore();
  const skills = scorecard ? [...new Set(scorecard.cases.map((c) => c.skill))].sort() : [];
  const countFor = (f: FilterKind) =>
    f === "all" ? caseViews.length : caseViews.filter((v) => matches(v, f)).length;
  return (
    <div className="facetbar">
      {caseScope && (
        <button
          className="facet scope-chip active"
          onClick={() => setCaseScope(null)}
          title="Drill-down scope from the overview. Click to clear."
        >
          ◎ {caseScope.label} <span className="count">{caseScope.keys.length}</span>
          <span aria-hidden> ×</span>
        </button>
      )}
      {FILTERS.map((f) => (
        <button
          key={f.id}
          className={`facet${filter === f.id ? " active" : ""}`}
          onClick={() => setFilter(f.id)}
        >
          {f.label} <span className="count">{countFor(f.id)}</span>
        </button>
      ))}
      <span className="spacer" />
      <select
        className="facet"
        value={facetSkill ?? ""}
        onChange={(e) => setFacetSkill(e.target.value || null)}
        title="Filter by skill"
      >
        <option value="">All skills</option>
        {skills.map((s) => (
          <option key={s} value={s}>
            {s.replace("cesiumjs-", "")}
          </option>
        ))}
      </select>
    </div>
  );
}

function matches(v: CaseView, f: FilterKind): boolean {
  switch (f) {
    case "all":
      return true;
    case "flag":
      return v.decision === "flag";
    case "defer":
      return v.decision === "defer";
    case "accept":
      return v.decision === "accept";
    case "not_reviewed":
      return v.visualStatus === "not_reviewed" || v.visualStatus === "not_applicable";
    default:
      return true;
  }
}

function CaseRow({ v, selected, onClick }: { v: CaseView; selected: boolean; onClick: () => void }) {
  const ref = useFollowSelection(selected);
  return (
    <div
      ref={ref}
      id={optionId("case", v.key)}
      className={`row${selected ? " sel cursor-cur" : ""}`}
      onClick={onClick}
      role="option"
      aria-selected={selected}
    >
      <span className={`spine d-${v.decision}`} />
      {v.source === "human" && <span className="override-dot" aria-hidden />}
      <div className="row-main">
        <div className="row-l1">
          <span className="name">{v.case_name || v.case_id}</span>
        </div>
        <div className="row-l2">
          <span>{v.skill.replace("cesiumjs-", "")}</span>
          <span>·</span>
          <span>{v.case_id}</span>
          {v.criticalFailedChecks.length > 0 && <span style={{ color: "var(--crit)" }}>✗crit</span>}
        </div>
      </div>
      <div className="row-right">
        <Score01 value={v.score} />
        {v.visualScore !== null ? <Score10 value={v.visualScore} /> : <UnknownChip small />}
      </div>
    </div>
  );
}

function SkillRow({ s, selected, onClick }: { s: SkillOverview; selected: boolean; onClick: () => void }) {
  const ref = useFollowSelection(selected);
  const d = s.latest?.decision;
  const spine = s.running ? "d-tie" : d === "KEEP" ? "d-keep" : d === "REJECT" ? "d-reject" : "d-neutral";
  return (
    <div
      ref={ref}
      id={optionId("skill", s.skill)}
      className={`row${selected ? " sel cursor-cur" : ""}`}
      onClick={onClick}
      role="option"
      aria-selected={selected}
    >
      <span className={`spine ${spine}`} />
      <div className="row-main">
        <div className="row-l1">
          <span className="name mono">{s.skill.replace("cesiumjs-", "")}</span>
          {s.running && <span className="pill pill-live">● running</span>}
        </div>
        <div className="row-l2">
          <span>{s.iteration_count} iter</span>
          <span>·</span>
          <span style={{ color: "var(--keep)" }}>{s.kept} kept</span>
          <span style={{ color: "var(--reject)" }}>{s.rejected} rej</span>
        </div>
      </div>
      <div className="row-right">
        <span className="st-hist" style={{ marginTop: 0 }}>
          {s.history.slice(-6).map((h) => (
            <span
              key={h.iteration}
              className={`hist-tick ${h.is_baseline ? "baseline" : h.status === "failed" ? "failed" : h.decision === "KEEP" ? "keep" : h.decision === "REJECT" ? "reject" : "baseline"}`}
              style={{ width: 8, height: 14 }}
              title={`${h.iteration} ${h.decision ?? h.status}`}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function ScenarioRow({
  s,
  selected,
  onClick
}: {
  s: ScenarioDetail;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useFollowSelection(selected);
  const spine = s.verdict === "CANDIDATE" ? "d-keep" : s.verdict === "BASELINE" ? "d-reject" : "d-tie";
  return (
    <div
      ref={ref}
      id={optionId("scn", s.dir)}
      className={`row${selected ? " sel cursor-cur" : ""}`}
      onClick={onClick}
      role="option"
      aria-selected={selected}
    >
      <span className={`spine ${spine}`} />
      <div className="row-main">
        <div className="row-l1">
          <span className="name">{s.label}</span>
        </div>
        <div className="row-l2">
          <span>{s.scenario_id}</span>
          <span>·</span>
          <span>
            {s.checks.passed}/{s.checks.total} checks
          </span>
          {s.checks.critical_failed > 0 && <span style={{ color: "var(--crit)" }}>✗crit</span>}
        </div>
      </div>
      <div className="row-right">
        <ScenarioChip verdict={s.verdict} count={s.majority_count} />
      </div>
    </div>
  );
}

export function Stream() {
  const store = useStore();
  const { station } = store;

  if (station === "review" || station === "evaluate") {
    return (
      <section className="stream col" aria-label="Cases">
        <FacetBar />
        <div className="stream-head">
          <span>worst-first · {store.orderedCases.length} cases</span>
          <span>det ▣ · eye ◈</span>
        </div>
        <div
          className="col-scroll"
          role="listbox"
          aria-label="Cases, worst first"
          tabIndex={0}
          aria-activedescendant={store.selectedView ? optionId("case", store.selectedView.key) : undefined}
          onKeyDown={listboxKeys(
            (d) => store.moveSelection(d),
            (edge) => (edge === "start" ? store.jumpToTop() : store.jumpToEnd())
          )}
        >
          {store.orderedCases.map((v) => (
            <CaseRow key={v.key} v={v} selected={v.key === store.selectedView?.key} onClick={() => store.selectKey(v.key)} />
          ))}
          {store.orderedCases.length === 0 && <div className="empty-note">No cases match this filter.</div>}
        </div>
      </section>
    );
  }

  if (station === "optimize") {
    const skillIdx = store.skills.findIndex((s) => s.skill === store.selectedSkill);
    const moveSkill = (delta: number) => {
      const next = store.skills[Math.max(0, Math.min(store.skills.length - 1, (skillIdx < 0 ? 0 : skillIdx) + delta))];
      if (next) store.selectSkill(next.skill);
    };
    return (
      <section className="stream col" aria-label="Skills">
        <div className="stream-head">
          <span>
            {store.skills.length} skill{store.skills.length === 1 ? "" : "s"} · iteration history
          </span>
          <span>keep · reject</span>
        </div>
        <div
          className="col-scroll"
          role="listbox"
          aria-label="Skills"
          tabIndex={0}
          aria-activedescendant={store.selectedSkill ? optionId("skill", store.selectedSkill) : undefined}
          onKeyDown={listboxKeys(moveSkill, (edge) => moveSkill(edge === "start" ? -store.skills.length : store.skills.length))}
        >
          {store.skills.map((s) => (
            <SkillRow
              key={s.skill}
              s={s}
              selected={s.skill === store.selectedSkill}
              onClick={() => store.selectSkill(s.skill)}
            />
          ))}
        </div>
      </section>
    );
  }

  // decide: scenarios of the selected iteration
  const scenarios = store.iterationDetail?.scenarios ?? [];
  const selectedScn = scenarios[store.selectedScenarioIndex];
  return (
    <section className="stream col" aria-label="Scenarios">
      <div className="stream-head">
        <span>
          {store.selectedSkill?.replace("cesiumjs-", "")} · iter {store.selectedIterationId ?? "—"}
        </span>
        <span>win · loss · tie</span>
      </div>
      <div
        className="col-scroll"
        role="listbox"
        aria-label="Scenarios"
        tabIndex={0}
        aria-activedescendant={selectedScn ? optionId("scn", selectedScn.dir) : undefined}
        onKeyDown={listboxKeys(
          (d) => store.selectScenario(Math.max(0, Math.min(scenarios.length - 1, store.selectedScenarioIndex + d))),
          (edge) => store.selectScenario(edge === "start" ? 0 : Math.max(0, scenarios.length - 1))
        )}
      >
        {scenarios.map((s, i) => (
          <ScenarioRow
            key={s.dir}
            s={s}
            selected={i === store.selectedScenarioIndex}
            onClick={() => store.selectScenario(i)}
          />
        ))}
        {scenarios.length === 0 && <div className="empty-note">Select a skill in Optimize to load its iteration.</div>}
      </div>
    </section>
  );
}
