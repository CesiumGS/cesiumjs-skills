import { Command, HelpCircle, Moon, Sun, Grid3x3, TrendingUp, Send, Layers } from "lucide-react";
import { useStore } from "../store";
import type { Station } from "../types";
import { ProvGlyph } from "./primitives";

const STATIONS: Array<{ id: Station; num: string; name: string }> = [
  { id: "evaluate", num: "1", name: "Evaluate" },
  { id: "review", num: "2", name: "Review" },
  { id: "optimize", num: "3", name: "Optimize" },
  { id: "decide", num: "4", name: "Decide" },
  { id: "promote", num: "5", name: "Promote" }
];

export function TopStrip() {
  const { scorecard, config, skills, theme, toggleTheme, openOverlay, counts, setStation, activeHarness } =
    useStore();
  const running = skills.find((s) => s.running);
  const modeB = scorecard && !scorecard.visualReviewSupplied;
  // The badge labels what the LOADED cases were tested with (the loaded run's harness),
  // not the transient run-list lens — switching the lens alone must not relabel the data.
  const harness = scorecard?.harness ?? activeHarness ?? config?.harness ?? "—";
  return (
    <header className="topstrip" role="banner">
      <div className="brand">
        <span className="beam" aria-hidden />
        Skill Evaluation Console
      </div>
      <div className="run-meta">
        <span>run</span>
        <span className="mono">{scorecard?.runId?.slice(0, 28) ?? config?.run_id ?? "—"}</span>
        {scorecard?.gitCommit && <span className="mono">· {scorecard.gitCommit.slice(0, 7)}</span>}
        <span className={`mode-badge${modeB ? " b" : ""}`}>{modeB ? "Mode B · det-only" : "reviewed"}</span>
        <button
          className="harness-badge"
          data-harness={harness}
          onClick={() => openOverlay("harness")}
          title="Harness tested · label, switch, compare (h)"
        >
          <Layers size={11} aria-hidden /> {harness}
        </button>
        <span>
          · <span className="mono">{counts.total}</span> cases
        </span>
        {typeof scorecard?.overallScore === "number" && (
          <span>
            · overall <span className="mono">{scorecard.overallScore.toFixed(2).replace(/^0/, "")}</span>
          </span>
        )}
      </div>
      <span className="spacer" />
      {running && (
        <button className="live-pill" onClick={() => setStation("optimize")} title="optimization loop in progress">
          <span className="dot" aria-hidden />
          <ProvGlyph kind="live" /> optimizing {running.skill.replace("cesiumjs-", "")}
        </button>
      )}
      <button className="icon-btn" title="Command palette (⌘K)" onClick={() => openOverlay("palette")}>
        <Command size={16} />
      </button>
      <button className="icon-btn" title="Toggle theme (T)" onClick={toggleTheme}>
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="icon-btn" title="Keyboard help (?)" onClick={() => openOverlay("help")}>
        <HelpCircle size={16} />
      </button>
    </header>
  );
}

export function Rail() {
  const {
    station,
    setStation,
    needsYouCount,
    confirmedFlagKeys,
    skills,
    openOverlay,
    doExport
  } = useStore();
  const running = skills.some((s) => s.running);
  const promotable = skills.filter((s) => s.latest?.decision === "KEEP").length;

  const badge = (id: Station) => {
    if (id === "review") return needsYouCount ? <span className="st-badge hot">{needsYouCount}</span> : null;
    if (id === "optimize")
      return running ? (
        <span className="st-badge live">●</span>
      ) : (
        <span className="st-badge">{skills.length}</span>
      );
    if (id === "decide") return promotable ? <span className="st-badge">{promotable}</span> : null;
    if (id === "promote") return promotable ? <span className="st-badge">{promotable}</span> : null;
    return null;
  };

  return (
    <nav className="rail col" role="navigation" aria-label="Lifecycle">
      <div className="rail-section">Lifecycle</div>
      {STATIONS.map((st) => (
        <div key={st.id}>
          <button
            className={`station${station === st.id ? " active" : ""}`}
            onClick={() => setStation(st.id)}
            aria-current={station === st.id}
          >
            <span className="st-num">{st.num}</span>
            <span className="st-name">{st.name}</span>
            {badge(st.id)}
          </button>
          {st.id === "review" && (
            <button className="rail-sub" onClick={doExport} title="Hand the confirmed flags to the optimizer">
              <Send size={12} /> Focus
              <span className="st-badge hot" style={{ marginLeft: "auto" }}>
                {confirmedFlagKeys.length}
              </span>
            </button>
          )}
        </div>
      ))}

      <div className="rail-overlays">
        <div className="rail-section" style={{ paddingTop: 0 }}>
          Lenses
        </div>
        <button className="rail-sub" onClick={() => openOverlay("matrix")}>
          <Grid3x3 size={13} /> Skill × category matrix <span className="kbd" style={{ marginLeft: "auto" }}>m</span>
        </button>
        <button className="rail-sub" onClick={() => openOverlay("trends")}>
          <TrendingUp size={13} /> Trends over iterations <span className="kbd" style={{ marginLeft: "auto" }}>t</span>
        </button>
        <button className="rail-sub" onClick={() => openOverlay("harness")}>
          <Layers size={13} /> Harness label · switch · compare <span className="kbd" style={{ marginLeft: "auto" }}>h</span>
        </button>
      </div>
    </nav>
  );
}

export function ActionBar() {
  const { station, selectedView, iterationDetail } = useStore();

  let machineSays = "";
  if ((station === "review" || station === "evaluate") && selectedView) {
    const det = selectedView.result;
    const vis = selectedView.visualStatus;
    const verdict =
      det === "fail" || vis === "fail" ? "FAIL" : vis === "needs_review" || vis === "not_reviewed" ? "NEEDS REVIEW" : "PASS";
    machineSays = `machine says ${verdict}`;
  } else if ((station === "decide" || station === "optimize") && iterationDetail) {
    machineSays = iterationDetail.decision ? `machine decided ${iterationDetail.decision}` : "iteration not yet decided";
  }

  return (
    <footer className="actionbar" role="contentinfo">
      <span className="machine-says">{machineSays}</span>
      <div className="verbs">
        {(station === "review" || station === "evaluate") && (
          <>
            <span className="verb">
              <span className="kbd">a</span> accept
            </span>
            <span className="verb">
              <span className="kbd">f</span> flag → focus
            </span>
            <span className="verb">
              <span className="kbd">d</span> defer
            </span>
            <span className="verb">
              <span className="kbd">space</span> details
            </span>
            <span className="verb">
              <span className="kbd">j</span>/<span className="kbd">k</span> next
            </span>
          </>
        )}
        {station === "optimize" && (
          <>
            <span className="verb">
              <span className="kbd">j</span>/<span className="kbd">k</span> skill
            </span>
            <span className="verb">
              <span className="kbd">[</span>/<span className="kbd">]</span> scenario
            </span>
            <span className="verb">
              <span className="kbd">enter</span> → decide
            </span>
          </>
        )}
        {station === "decide" && (
          <>
            <span className="verb">
              <span className="kbd">x</span> swipe
            </span>
            <span className="verb">
              <span className="kbd">X</span> blink
            </span>
            <span className="verb">
              <span className="kbd">[</span>/<span className="kbd">]</span> scenario
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
