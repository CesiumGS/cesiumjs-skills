import { useEffect, useRef } from "react";
import type { Store } from "../store";
import type { Station } from "../types";

const STATION_BY_DIGIT: Record<string, Station> = {
  "0": "dashboard",
  "1": "evaluate",
  "2": "review",
  "3": "optimize",
  "4": "decide",
  "5": "promote",
  "6": "compare",
  "7": "live"
};

function isTyping(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  // SELECT included: arrow keys must change the select's value, not hijack
  // the hidden stream cursor; letter verbs must not mutate grades (WCAG 2.1.1).
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

/** The j/k spine: same keys, station-aware target (cases / skills / scenarios). */
function streamMove(s: Store, delta: number): void {
  if (s.station === "optimize") {
    const list = s.skills;
    if (list.length === 0) return;
    const idx = list.findIndex((x) => x.skill === s.selectedSkill);
    const next = list[Math.max(0, Math.min(list.length - 1, (idx < 0 ? 0 : idx) + delta))];
    if (next) s.selectSkill(next.skill);
    return;
  }
  if (s.station === "decide") {
    const len = s.iterationDetail?.scenarios.length ?? 0;
    if (len === 0) return;
    s.selectScenario(Math.max(0, Math.min(len - 1, s.selectedScenarioIndex + delta)));
    return;
  }
  s.moveSelection(delta);
}

/** One keyboard grammar across all stations (DESIGN-SPEC §5). */
export function useKeybindings(store: Store): void {
  const ref = useRef(store);
  ref.current = store;
  const pending = useRef<string>("");

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const s = ref.current;
      const k = e.key;

      if (isTyping(e.target)) return;

      // ---- global ----
      if ((e.metaKey || e.ctrlKey) && (k === "k" || k === "K")) {
        e.preventDefault();
        s.openOverlay("palette");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (k === "Escape") {
        if (s.overlay) s.closeOverlay();
        else if (s.detailsOpen) s.toggleDetails();
        return;
      }
      // the lightbox stays open while j/k change cases, but z (or Escape) dismisses it
      if (s.overlay === "lightbox") {
        if (k === "z") return s.closeOverlay();
      }
      // other overlays own their own keys; only Escape bubbles
      if (s.overlay && s.overlay !== "lightbox") return;

      // gg / G
      if (k === "g") {
        if (pending.current === "g") {
          pending.current = "";
          s.jumpToTop();
        } else {
          pending.current = "g";
          window.setTimeout(() => (pending.current = ""), 600);
        }
        return;
      }
      if (k === "G") {
        s.jumpToEnd();
        return;
      }
      pending.current = "";

      if (STATION_BY_DIGIT[k]) return s.setStation(STATION_BY_DIGIT[k]);

      // overlays
      if (k === "m") return s.openOverlay("matrix");
      if (k === "t") return s.openOverlay("trends");
      if (k === "h") return s.openOverlay("harness");
      if (k === "?") return s.openOverlay("help");
      if (k === "/") {
        e.preventDefault();
        return s.openOverlay("palette");
      }
      if (k === "T") return s.toggleTheme();

      // stream spine — same keys, station-aware target (cases / skills / scenarios)
      if (k === "j" || k === "ArrowDown") {
        e.preventDefault();
        return streamMove(s, 1);
      }
      if (k === "k" || k === "ArrowUp") {
        e.preventDefault();
        return streamMove(s, -1);
      }

      // ---- station verbs ----
      // Grades mutate only in Review: Evaluate is a read surface, and a
      // summary-screen keystroke must never silently edit a hidden case.
      if (s.station === "review") {
        if (k === "a" && s.selectedView) return s.setDecision(s.selectedView.key, "accept");
        if (k === "f" && s.selectedView) return s.setDecision(s.selectedView.key, "flag");
        if (k === "d" && s.selectedView) return s.setDecision(s.selectedView.key, "defer");
        if (k === "e" || k === "Enter") return s.confirmAndAdvance();
        if (k === "u") return s.undo();
        if (k === "n") return s.nextFlag();
      }
      if (s.station === "review" || s.station === "evaluate") {
        if (k === " ") {
          e.preventDefault();
          return s.toggleDetails();
        }
        if (k === "z" && s.selectedView?.screenshots.length) return s.openOverlay("lightbox");
        if (k === "[") return s.setShotIndex((n) => Math.max(0, n - 1));
        if (k === "]") return s.setShotIndex((n) => n + 1);
      }

      if (s.station === "optimize") {
        if (k === "Enter") return s.setStation("decide"); // carry the selection into Decide
      }

      if (s.station === "optimize" || s.station === "decide") {
        if (k === "[") return s.selectScenario(Math.max(0, s.selectedScenarioIndex - 1));
        if (k === "]") return s.selectScenario(s.selectedScenarioIndex + 1);
        if (k === "x") return s.setDiffMode("swipe");
        if (k === "X") return s.setDiffMode("blink");
        if (k === "l") return s.openOverlay("journal");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
