import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  exportHandoff,
  loadConfig,
  loadIteration,
  loadReviewDecisions,
  loadRuns,
  loadScorecard,
  loadSkills,
  saveReviewDecisions,
  selectRun
} from "./api";
import { adaptScorecard } from "./lib/adapt";
import { autoGrade, matchesFilter, worstFirstSort } from "./lib/grade";
import type {
  AdaptedCase,
  AdaptedScorecard,
  CaseView,
  ConfigDTO,
  Decision,
  DecisionRecord,
  FilterKind,
  Harness,
  IterationDetail,
  ConsoleOverlay,
  RunSummary,
  ReviewDecisionDoc,
  SkillOverview,
  Source,
  Station
} from "./types";

export type Theme = "dark" | "light";
export type DiffMode = "swipe" | "blink";

interface Toast {
  id: number;
  message: string;
  tone?: "info" | "good" | "bad";
}

interface Counts {
  accept: number;
  flag: number;
  defer: number;
  neutral: number;
  total: number;
  overridden: number;
}

export interface Store {
  loading: boolean;
  error: string | null;
  config: ConfigDTO | null;
  scorecard: AdaptedScorecard | null;
  runs: RunSummary[];
  // harness lens (persistent across stations): the harness of the loaded run,
  // the distinct harnesses across all runs, and the run list scoped to the lens.
  activeHarness: Harness | null;
  harnesses: Harness[];
  visibleRuns: RunSummary[];
  saveStatus: "idle" | "saving" | "saved" | "error";

  // review (derived)
  caseViews: CaseView[];
  orderedCases: CaseView[];
  selectedView: CaseView | null;
  counts: Counts;
  needsYouCount: number;
  confirmedFlagKeys: string[];
  confirmedFlagSkills: string[];

  // optimize / decide
  skills: SkillOverview[];
  selectedSkill: string | null;
  selectedSkillData: SkillOverview | null;
  selectedIterationId: string | null;
  iterationDetail: IterationDetail | null;
  iterationLoading: boolean;
  selectedScenarioIndex: number;

  // ui
  station: Station;
  filter: FilterKind;
  facetSkill: string | null;
  detailsOpen: boolean;
  overlay: ConsoleOverlay;
  lightboxIndex: number;
  shotIndex: number;
  diffMode: DiffMode;
  swipePos: number; // 0..100
  theme: Theme;
  toasts: Toast[];
  liveMessage: string;

  // actions — navigation
  setStation: (s: Station) => void;
  selectKey: (key: string) => void;
  moveSelection: (delta: number) => void;
  jumpToTop: () => void;
  jumpToEnd: () => void;
  nextFlag: () => void;
  // actions — review
  setDecision: (key: string, decision: Decision) => void;
  confirmAndAdvance: () => void;
  undo: () => void;
  setFilter: (f: FilterKind) => void;
  setFacetSkill: (s: string | null) => void;
  toggleDetails: () => void;
  // actions — optimize / decide
  selectSkill: (skill: string) => void;
  selectIteration: (iteration: string) => void;
  selectScenario: (index: number) => void;
  setDiffMode: (m: DiffMode) => void;
  setSwipePos: (n: number) => void;
  // actions — overlays / misc
  openOverlay: (o: Exclude<ConsoleOverlay, null>) => void;
  closeOverlay: () => void;
  setLightboxIndex: (n: number) => void;
  setShotIndex: (updater: (n: number) => number) => void;
  toggleTheme: () => void;
  pushToast: (message: string, tone?: Toast["tone"]) => void;
  doExport: () => Promise<void>;
  switchRun: (runId: string) => Promise<void>;
  setActiveHarness: (h: Harness | null) => void;
  reload: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

const nowIso = () => new Date().toISOString();
const THEME_KEY = "ec-theme";

function toView(c: AdaptedCase, rec: DecisionRecord | undefined): CaseView {
  return {
    ...c,
    decision: rec?.decision ?? autoGrade(c),
    source: rec?.source ?? "auto",
    note: rec?.note ?? ""
  };
}

/** "Needs You": deterministic fail, or visual fail/needs_review. */
function needsYou(v: CaseView): boolean {
  return v.result === "fail" || v.visualStatus === "fail" || v.visualStatus === "needs_review";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigDTO | null>(null);
  const [scorecard, setScorecard] = useState<AdaptedScorecard | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeHarness, setActiveHarness] = useState<Harness | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DecisionRecord>>({});
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<Store["saveStatus"]>("idle");

  const [skills, setSkills] = useState<SkillOverview[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [iterationDetail, setIterationDetail] = useState<IterationDetail | null>(null);
  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null);
  const [iterationLoading, setIterationLoading] = useState(false);
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState(0);

  const [station, setStationState] = useState<Station>("review");
  const [filter, setFilterState] = useState<FilterKind>("all");
  const [facetSkill, setFacetSkillState] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [overlay, setOverlay] = useState<ConsoleOverlay>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [shotIndex, setShotIndexState] = useState(0);
  const [diffMode, setDiffModeState] = useState<DiffMode>("swipe");
  const [swipePos, setSwipePosState] = useState(50);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [liveMessage, setLiveMessage] = useState("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return stored === "light" ? "light" : "dark";
  });

  const saveTimer = useRef<number | null>(null);
  const undoStack = useRef<Array<{ key: string; prev: DecisionRecord | undefined }>>([]);
  const toastId = useRef(0);
  const iterReq = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // ---------- load ----------
  const boot = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    undoStack.current = [];
    try {
      const [cfg, raw, decDoc, runList, skillList] = await Promise.all([
        loadConfig(),
        loadScorecard(),
        loadReviewDecisions().catch(() => null),
        loadRuns().catch(() => [] as RunSummary[]),
        loadSkills().catch(() => [] as SkillOverview[])
      ]);
      const adapted = adaptScorecard(raw);
      // The scorecard carries no path, so a legacy fieldless run adapts to "unknown".
      // The server is the sole inference site — backfill its resolved value here so the
      // label/lens reflect the real harness before the scorecard is committed to state.
      if (adapted.harness === "unknown" && typeof cfg.harness === "string" && cfg.harness.trim()) {
        adapted.harness = cfg.harness.trim();
      }
      setConfig(cfg);
      setScorecard(adapted);
      setActiveHarness(adapted.harness);
      setRuns(runList);
      setSkills(skillList);
      const seeded = decDoc?.decisions ?? {};
      decisionsRef.current = seeded;
      setDecisions(seeded);
      const views = adapted.cases.map((c) => toView(c, seeded[c.key]));
      const ordered = worstFirstSort(views);
      setSelectedKey(ordered[0]?.key ?? "");
      const firstSkill = skillList.find((s) => s.iteration_count > 0) ?? skillList[0] ?? null;
      setSelectedSkill(firstSkill?.skill ?? null);
      setFilterState("all");
      setFacetSkillState(null);
      setDetailsOpen(false);
      setOverlay(null);
      setSaveStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  // ---------- derived: harness lens ----------
  const harnesses = useMemo<Harness[]>(
    () => [...new Set(runs.map((r) => r.harness ?? "unknown"))].sort(),
    [runs]
  );
  const visibleRuns = useMemo<RunSummary[]>(
    () => (activeHarness ? runs.filter((r) => (r.harness ?? "unknown") === activeHarness) : runs),
    [runs, activeHarness]
  );

  // ---------- derived: review ----------
  const caseViews = useMemo<CaseView[]>(() => {
    if (!scorecard) return [];
    return scorecard.cases.map((c) => toView(c, decisions[c.key]));
  }, [scorecard, decisions]);

  const viewByKey = useMemo(() => {
    const m = new Map<string, CaseView>();
    for (const v of caseViews) m.set(v.key, v);
    return m;
  }, [caseViews]);

  const orderedCases = useMemo(() => {
    const filtered = caseViews.filter(
      (v) => matchesFilter(v, filter) && (!facetSkill || v.skill === facetSkill)
    );
    return worstFirstSort(filtered);
  }, [caseViews, filter, facetSkill]);

  const counts = useMemo<Counts>(() => {
    const c: Counts = { accept: 0, flag: 0, defer: 0, neutral: 0, total: caseViews.length, overridden: 0 };
    for (const v of caseViews) {
      c[v.decision] += 1;
      if (v.source === "human") c.overridden += 1;
      if (v.visualStatus === "not_reviewed" || v.visualStatus === "not_applicable") c.neutral += 1;
    }
    return c;
  }, [caseViews]);

  const needsYouCount = useMemo(() => caseViews.filter(needsYou).length, [caseViews]);
  const confirmedFlagKeys = useMemo(
    () => caseViews.filter((v) => v.decision === "flag").map((v) => v.key),
    [caseViews]
  );
  const confirmedFlagSkills = useMemo(
    () => [...new Set(caseViews.filter((v) => v.decision === "flag").map((v) => v.skill))].sort(),
    [caseViews]
  );

  const selectedView = selectedKey ? viewByKey.get(selectedKey) ?? null : null;
  const selectedSkillData = useMemo(
    () => skills.find((s) => s.skill === selectedSkill) ?? null,
    [skills, selectedSkill]
  );

  // refs to avoid stale closures in keyboard actions
  const orderedRef = useRef<CaseView[]>([]);
  orderedRef.current = orderedCases;
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;
  const configRef = useRef(config);
  configRef.current = config;
  const scorecardRef = useRef(scorecard);
  scorecardRef.current = scorecard;
  const viewByKeyRef = useRef(viewByKey);
  viewByKeyRef.current = viewByKey;

  // keep selection within the visible queue
  useEffect(() => {
    if (!scorecard || orderedCases.length === 0) return;
    if (!orderedCases.some((v) => v.key === selectedKeyRef.current)) {
      setSelectedKey(orderedCases[0].key);
    }
  }, [orderedCases, scorecard]);

  // ---------- persistence ----------
  const scheduleSave = useCallback((next: Record<string, DecisionRecord>) => {
    const cfg = configRef.current;
    const sc = scorecardRef.current;
    if (!cfg || !sc) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = window.setTimeout(() => {
      const doc: ReviewDecisionDoc = {
        schema_version: "1.0",
        run_id: sc.runId,
        scorecard_path: cfg.scorecard_path,
        updated_at: nowIso(),
        decisions: next
      };
      saveReviewDecisions(doc)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("error"));
    }, 400);
  }, []);

  // ---------- toasts ----------
  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((cur) => [...cur, { id, message, tone }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 4200);
  }, []);

  // ---------- review mutations ----------
  const applyDecision = useCallback(
    (key: string, decision: Decision, source: Source) => {
      const sc = scorecardRef.current;
      if (!sc) return;
      const adapted = sc.cases.find((c) => c.key === key);
      if (!adapted) return;
      const cur = decisionsRef.current;
      undoStack.current.push({ key, prev: cur[key] });
      if (undoStack.current.length > 50) undoStack.current.shift();
      const next: Record<string, DecisionRecord> = {
        ...cur,
        [key]: {
          case_id: adapted.case_id,
          skill: adapted.skill,
          decision,
          source,
          note: cur[key]?.note,
          updated_at: nowIso()
        }
      };
      decisionsRef.current = next;
      setDecisions(next);
      scheduleSave(next);
      const word = decision === "accept" ? "accepted" : decision === "flag" ? "flagged → focus" : "deferred";
      setLiveMessage(`${adapted.case_name} ${word}`);
    },
    [scheduleSave]
  );

  const setDecision = useCallback(
    (key: string, decision: Decision) => applyDecision(key, decision, "human"),
    [applyDecision]
  );

  const advance = useCallback(() => {
    const ordered = orderedRef.current;
    const idx = ordered.findIndex((v) => v.key === selectedKeyRef.current);
    const next = idx === -1 ? ordered[0] : ordered[Math.min(ordered.length - 1, idx + 1)];
    if (next) {
      setSelectedKey(next.key);
      setShotIndexState(0);
    }
  }, []);

  const confirmAndAdvance = useCallback(() => {
    const key = selectedKeyRef.current;
    const v = viewByKeyRef.current.get(key);
    if (v) applyDecision(key, v.decision, "human");
    advance();
  }, [applyDecision, advance]);

  const undo = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) {
      pushToast("Nothing to undo");
      return;
    }
    const next = { ...decisionsRef.current };
    if (last.prev) next[last.key] = last.prev;
    else delete next[last.key];
    decisionsRef.current = next;
    setDecisions(next);
    scheduleSave(next);
    if (scorecardRef.current?.cases.some((c) => c.key === last.key)) setSelectedKey(last.key);
    pushToast(`Reverted ${last.key}`);
  }, [pushToast, scheduleSave]);

  // ---------- navigation ----------
  const selectKey = useCallback((key: string) => {
    setSelectedKey(key);
    setShotIndexState(0);
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      const ordered = orderedRef.current;
      const idx = ordered.findIndex((v) => v.key === selectedKeyRef.current);
      const next =
        idx === -1
          ? ordered[0]
          : ordered[Math.max(0, Math.min(ordered.length - 1, idx + delta))];
      if (next) {
        setSelectedKey(next.key);
        setShotIndexState(0);
      }
    },
    []
  );

  const jumpToTop = useCallback(() => {
    const first = orderedRef.current[0];
    if (first) selectKey(first.key);
  }, [selectKey]);
  const jumpToEnd = useCallback(() => {
    const ordered = orderedRef.current;
    const last = ordered[ordered.length - 1];
    if (last) selectKey(last.key);
  }, [selectKey]);

  const nextFlag = useCallback(() => {
    const ordered = orderedRef.current;
    const idx = ordered.findIndex((v) => v.key === selectedKeyRef.current);
    for (let i = idx + 1; i < ordered.length; i++) {
      if (ordered[i].decision === "flag" || ordered[i].decision === "defer") {
        selectKey(ordered[i].key);
        return;
      }
    }
    pushToast("No more flags or deferrals below");
  }, [selectKey, pushToast]);

  // ---------- optimize / decide ----------
  const fetchIteration = useCallback((skill: string, iteration: string) => {
    const reqId = ++iterReq.current;
    setIterationLoading(true);
    setSelectedIterationId(iteration);
    setSelectedScenarioIndex(0);
    loadIteration(skill, iteration)
      .then((detail) => {
        if (iterReq.current === reqId) {
          setIterationDetail(detail);
          // default to the first LOSS (regression) scenario if any, else first
          const lossIdx = detail.scenarios.findIndex((s) => s.verdict === "BASELINE");
          setSelectedScenarioIndex(lossIdx >= 0 ? lossIdx : 0);
        }
      })
      .catch(() => {
        if (iterReq.current === reqId) setIterationDetail(null);
      })
      .finally(() => {
        if (iterReq.current === reqId) setIterationLoading(false);
      });
  }, []);

  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  const selectSkill = useCallback(
    (skill: string) => {
      setSelectedSkill(skill);
      const ov = skillsRef.current.find((s) => s.skill === skill);
      const latest = ov?.latest ?? ov?.history.filter((h) => !h.is_baseline).slice(-1)[0] ?? null;
      if (latest) fetchIteration(skill, latest.iteration);
      else {
        setIterationDetail(null);
        setSelectedIterationId(null);
      }
    },
    [fetchIteration]
  );

  const selectIteration = useCallback(
    (iteration: string) => {
      if (selectedSkill) fetchIteration(selectedSkill, iteration);
    },
    [selectedSkill, fetchIteration]
  );

  const selectScenario = useCallback((index: number) => {
    setSelectedScenarioIndex(index);
    setSwipePosState(50);
  }, []);

  // Lazily load the selected skill's latest iteration the first time Optimize/Decide is entered.
  const setStation = useCallback(
    (s: Station) => {
      setStationState(s);
      setOverlay(null);
      if ((s === "optimize" || s === "decide") && selectedSkill && !iterationDetail && !iterationLoading) {
        const ov = skillsRef.current.find((x) => x.skill === selectedSkill);
        const latest = ov?.latest ?? null;
        if (latest) fetchIteration(selectedSkill, latest.iteration);
      }
    },
    [selectedSkill, iterationDetail, iterationLoading, fetchIteration]
  );

  // ---------- ui misc ----------
  const setFilter = useCallback((f: FilterKind) => setFilterState(f), []);
  const setFacetSkill = useCallback((s: string | null) => setFacetSkillState(s), []);
  const toggleDetails = useCallback(() => setDetailsOpen((d) => !d), []);
  const openOverlay = useCallback((o: Exclude<ConsoleOverlay, null>) => {
    setOverlay(o);
    if (o === "lightbox") setLightboxIndex(0);
  }, []);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const setShotIndex = useCallback((updater: (n: number) => number) => setShotIndexState((n) => updater(n)), []);
  const setDiffMode = useCallback((m: DiffMode) => setDiffModeState(m), []);
  const setSwipePos = useCallback((n: number) => setSwipePosState(Math.max(0, Math.min(100, n))), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  // ---------- export / runs ----------
  const doExport = useCallback(async () => {
    const flags = caseViews.filter((v) => v.decision === "flag");
    if (!flags.length) {
      pushToast("No confirmed flags to hand off", "bad");
      return;
    }
    try {
      const keys = flags.map((v) => v.key);
      const sk = [...new Set(flags.map((v) => v.skill))].sort();
      const res = await exportHandoff(keys, sk, "confirmed_flags");
      pushToast(`Handed off ${keys.length} cases → ${res.focus_path.split("/").slice(-2).join("/")}`, "good");
      setLiveMessage(`${keys.length} confirmed flags handed off to the optimizer across ${sk.length} skills.`);
    } catch (err) {
      pushToast(`Hand-off failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
    }
  }, [caseViews, pushToast]);

  const switchRun = useCallback(
    async (runId: string) => {
      try {
        await selectRun(runId);
        setOverlay(null);
        await boot();
      } catch (err) {
        pushToast(`Could not switch run: ${err instanceof Error ? err.message : String(err)}`, "bad");
      }
    },
    [boot, pushToast]
  );

  const value: Store = {
    loading,
    error,
    config,
    scorecard,
    runs,
    activeHarness,
    harnesses,
    visibleRuns,
    saveStatus,
    caseViews,
    orderedCases,
    selectedView,
    counts,
    needsYouCount,
    confirmedFlagKeys,
    confirmedFlagSkills,
    skills,
    selectedSkill,
    selectedSkillData,
    selectedIterationId,
    iterationDetail,
    iterationLoading,
    selectedScenarioIndex,
    station,
    filter,
    facetSkill,
    detailsOpen,
    overlay,
    lightboxIndex,
    shotIndex,
    diffMode,
    swipePos,
    theme,
    toasts,
    liveMessage,
    setStation,
    selectKey,
    moveSelection,
    jumpToTop,
    jumpToEnd,
    nextFlag,
    setDecision,
    confirmAndAdvance,
    undo,
    setFilter,
    setFacetSkill,
    toggleDetails,
    selectSkill,
    selectIteration,
    selectScenario,
    setDiffMode,
    setSwipePos,
    openOverlay,
    closeOverlay,
    setLightboxIndex,
    setShotIndex,
    toggleTheme,
    pushToast,
    doExport,
    switchRun,
    setActiveHarness,
    reload: boot
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
