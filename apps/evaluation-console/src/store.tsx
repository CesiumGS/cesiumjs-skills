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
  cancelRun,
  exportHandoff,
  launchOptimization as launchOptimizationRequest,
  launchRun,
  loadConfig,
  loadInsights,
  loadIteration,
  loadLive,
  loadOptimizationHandoff,
  loadRegistry,
  loadReviewDecisions,
  loadRunCases,
  loadRuns,
  loadScorecard,
  loadSkills,
  promoteCandidate,
  reviewCandidate,
  saveReviewDecisions,
  selectRun
} from "./api";
import type { HandoffResult, LaunchRecord, LaunchRequest } from "./api";
import { adaptScorecard } from "./lib/adapt";
import { autoGrade, isSyntheticRun, matchesFilter, worstFirstSort } from "./lib/grade";
import {
  buildOptimizationQueue,
  type OptimizationQueueSkill,
} from "./lib/optimizationQueue";
import type {
  AdaptedCase,
  AdaptedScorecard,
  BaselineDiff,
  CaseScope,
  CaseView,
  ConfigDTO,
  Decision,
  DecisionRecord,
  FilterKind,
  Harness,
  InsightsDTO,
  IterationDetail,
  ConsoleOverlay,
  LiveRun,
  LiveStatusDTO,
  OptimizationLaunchRecord,
  RegistryDTO,
  RunCaseLite,
  RunSummary,
  ReviewDecisionDoc,
  SkillOverview,
  SelectionMode,
  Source,
  Station
} from "./types";

export type Theme = "dark" | "light";
export type DiffMode = "swipe" | "blink";

interface Toast {
  id: number;
  message: string;
  tone?: "info" | "good" | "bad";
  /** Sticky toasts (errors) persist until explicitly dismissed. */
  sticky?: boolean;
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
  /** Runs backed by real agent evidence: pure fixtures (synthetic evaluator
   *  self-tests) are excluded. Dashboard headline surfaces read this; the Run
   *  Browser and Harnesses station keep reading the full `runs`. */
  evalRuns: RunSummary[];
  // harness lens (persistent across stations): the harness of the loaded run,
  // the distinct harnesses across all runs, and the run list scoped to the lens.
  activeHarness: Harness | null;
  harnesses: Harness[];
  visibleRuns: RunSummary[];
  saveStatus: "idle" | "saving" | "saved" | "error";

  // declared capability (registry) + observed model×harness performance (insights)
  registry: RegistryDTO | null;
  insights: InsightsDTO | null;

  // Journal-derived live progress, separated by the workflow that owns it.
  live: LiveStatusDTO | null;
  studyRuns: LiveRun[];
  optimizationRuns: LiveRun[];
  studyRunning: boolean;
  optimizationRunning: boolean;
  /** Accepted Optimize launch waiting for its first on-disk journal event. */
  optimizationLaunch: OptimizationLaunchRecord | null;

  // comparison baseline: another run the loaded run is diffed against
  baselineRunId: string | null;
  baselineRun: RunSummary | null;
  baselineLoading: boolean;
  diff: BaselineDiff | null;

  // drill-down scope: aggregate signal -> exact cases (chip shown in the stream)
  caseScope: CaseScope | null;

  // review (derived)
  caseViews: CaseView[];
  orderedCases: CaseView[];
  selectedView: CaseView | null;
  counts: Counts;
  needsYouCount: number;
  /** Human-confirmed flags only (decision === "flag" && source === "human"). */
  confirmedFlagKeys: string[];
  /** Last successful persisted handoff to the optimizer (command, paths, and exact queue). */
  lastHandoff:
    | (HandoffResult & { at: string; count: number; caseKeys: string[]; selectionMode: SelectionMode })
    | null;
  handoffPanelVisible: boolean;
  dismissHandoff: () => void;
  showHandoff: () => void;

  // optimize / decide
  skills: SkillOverview[];
  /** Review handoff merged with history; includes skills before their first optimization artifact exists. */
  optimizationQueue: OptimizationQueueSkill[];
  selectedSkill: string | null;
  selectedOptimizationQueueSkill: OptimizationQueueSkill | null;
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
  dismissToast: (id: number) => void;
  retrySave: () => void;
  doExport: () => Promise<void>;
  startOptimization: (concurrency?: number) => Promise<boolean>;
  launchEvalRun: (payload: LaunchRequest) => Promise<LaunchRecord | null>;
  cancelLiveRun: (launchId: string) => Promise<void>;
  reviewSkillCandidate: (skill: string, iteration: string, decision: "approve" | "reject") => Promise<boolean>;
  promoteSkillCandidate: (skill: string, iteration: string) => Promise<boolean>;
  switchRun: (runId: string) => Promise<void>;
  setActiveHarness: (h: Harness | null) => void;
  setBaselineRun: (runId: string | null) => void;
  setCaseScope: (scope: CaseScope | null) => void;
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
const isStudyRun = (run: LiveRun) => run.kind === "audit";
const isOptimizationRun = (run: LiveRun) => run.kind === "iteration" || run.kind === "baseline";

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
  const [registry, setRegistry] = useState<RegistryDTO | null>(null);
  const [insights, setInsights] = useState<InsightsDTO | null>(null);
  const [live, setLive] = useState<LiveStatusDTO | null>(null);
  const [optimizationLaunch, setOptimizationLaunch] = useState<OptimizationLaunchRecord | null>(null);
  const [lastHandoff, setLastHandoff] = useState<Store["lastHandoff"]>(null);
  const [handoffPanelVisible, setHandoffPanelVisible] = useState(false);
  const [baselineRunId, setBaselineRunId] = useState<string | null>(null);
  const [baselineCases, setBaselineCases] = useState<RunCaseLite[] | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [caseScope, setCaseScopeState] = useState<CaseScope | null>(null);

  const [skills, setSkills] = useState<SkillOverview[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [iterationDetail, setIterationDetail] = useState<IterationDetail | null>(null);
  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null);
  const [iterationLoading, setIterationLoading] = useState(false);
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState(0);

  const [station, setStationState] = useState<Station>("dashboard");
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
  const optimizationLaunchTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (optimizationLaunchTimer.current) window.clearTimeout(optimizationLaunchTimer.current);
    },
    []
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // ---------- comparison baseline ----------
  const baselineReq = useRef(0);
  const fetchBaseline = useCallback((runId: string) => {
    const reqId = ++baselineReq.current;
    setBaselineLoading(true);
    loadRunCases(runId)
      .then((dto) => {
        if (baselineReq.current === reqId) setBaselineCases(dto.cases);
      })
      .catch(() => {
        if (baselineReq.current === reqId) setBaselineCases(null);
      })
      .finally(() => {
        if (baselineReq.current === reqId) setBaselineLoading(false);
      });
  }, []);

  const setBaselineRun = useCallback(
    (runId: string | null) => {
      setBaselineRunId(runId);
      setBaselineCases(null);
      if (runId) fetchBaseline(runId);
    },
    [fetchBaseline]
  );

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
      const cfg = await loadConfig();
      const expectedRoot = __EXPECTED_REPO_ROOT__.replace(/\/+$/, "");
      const actualRoot = cfg.repo_root.replace(/\/+$/, "");
      if (expectedRoot && actualRoot !== expectedRoot) {
        throw new Error(
          `API checkout mismatch: this console belongs to ${expectedRoot}, but the backend serves ${actualRoot}.`,
        );
      }
      const [raw, decDoc, persistedHandoff, runList, skillList, reg, ins] = await Promise.all([
        loadScorecard(),
        loadReviewDecisions().catch(() => null),
        loadOptimizationHandoff().catch(() => null),
        loadRuns().catch(() => [] as RunSummary[]),
        loadSkills().catch(() => [] as SkillOverview[]),
        loadRegistry().catch(() => null),
        loadInsights().catch(() => null)
      ]);
      const adapted = raw ? adaptScorecard(raw) : null;
      // The scorecard carries no path, so a legacy fieldless run adapts to "unknown".
      // The server is the sole inference site — backfill its resolved value here so the
      // label/lens reflect the real harness before the scorecard is committed to state.
      if (adapted?.harness === "unknown" && typeof cfg.harness === "string" && cfg.harness.trim()) {
        adapted.harness = cfg.harness.trim();
      }
      setConfig(cfg);
      setScorecard(adapted);
      setActiveHarness(adapted?.harness ?? null);
      setRuns(runList);
      setSkills(skillList);
      setRegistry(reg);
      setInsights(ins);
      if (persistedHandoff) {
        const { selection_mode, created_at, case_keys, ...handoff } = persistedHandoff;
        setLastHandoff({
          ...handoff,
          at: created_at || nowIso(),
          count: case_keys.length,
          caseKeys: case_keys,
          selectionMode: selection_mode
        });
        setHandoffPanelVisible(true);
      } else {
        setLastHandoff(null);
        setHandoffPanelVisible(false);
      }
      setCaseScopeState(null);
      // Default comparison baseline: the most recent run strictly older than the
      // loaded run — same harness when one exists, else any harness. The user can
      // repoint it from the run list ("b"). No older run => honest "no baseline".
      const loadedTs = adapted?.timestampUtc ?? "";
      const older = runList
        .filter((r) => adapted && r.run_id !== adapted.runId && r.timestamp_utc && r.timestamp_utc < loadedTs)
        .sort((a, b) => b.timestamp_utc.localeCompare(a.timestamp_utc));
      const sameHarness = older.filter((r) => (r.harness ?? "unknown") === adapted?.harness);
      const defaultBaseline = (sameHarness[0] ?? older[0])?.run_id ?? null;
      setBaselineRunId(defaultBaseline);
      setBaselineCases(null);
      if (defaultBaseline) fetchBaseline(defaultBaseline);
      const seeded = decDoc?.decisions ?? {};
      decisionsRef.current = seeded;
      setDecisions(seeded);
      const views = (adapted?.cases ?? []).map((c) => toView(c, seeded[c.key]));
      const ordered = worstFirstSort(views);
      setSelectedKey(ordered[0]?.key ?? "");
      const persistedQueue = buildOptimizationQueue(skillList, persistedHandoff?.case_keys ?? []);
      const firstSkill =
        persistedQueue[0]?.skill ??
        skillList.find((s) => s.iteration_count > 0)?.skill ??
        skillList[0]?.skill ??
        null;
      setSelectedSkill(firstSkill);
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
  }, [fetchBaseline]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // ---------- derived: baseline diff ----------
  const baselineRun = useMemo(
    () => runs.find((r) => r.run_id === baselineRunId) ?? null,
    [runs, baselineRunId]
  );

  const diff = useMemo<BaselineDiff | null>(() => {
    if (!scorecard || !baselineRunId || !baselineCases) return null;
    const base = new Map(baselineCases.map((c) => [c.key, c]));
    const fixed: string[] = [];
    const regressed: string[] = [];
    const stillFailing: string[] = [];
    const added: string[] = [];
    const seen = new Set<string>();
    for (const c of scorecard.cases) {
      const b = base.get(c.key);
      if (!b) {
        added.push(c.key);
        continue;
      }
      seen.add(c.key);
      const curFail = c.result === "fail";
      const baseFail = b.result === "fail";
      if (curFail && !baseFail) regressed.push(c.key);
      else if (!curFail && baseFail) fixed.push(c.key);
      else if (curFail && baseFail) stillFailing.push(c.key);
    }
    const removed = baselineCases.filter((c) => !seen.has(c.key)).map((c) => c.key);
    const baseScore = baselineRun?.overall_score;
    return {
      baselineRunId,
      fixed,
      regressed,
      stillFailing,
      added,
      removed,
      scoreDelta: typeof baseScore === "number" ? scorecard.overallScore - baseScore : null
    };
  }, [scorecard, baselineRunId, baselineCases, baselineRun]);

  const setCaseScope = useCallback((scope: CaseScope | null) => {
    setCaseScopeState(scope && scope.keys.length === 0 ? null : scope);
  }, []);

  // ---------- derived: harness lens ----------
  const evalRuns = useMemo<RunSummary[]>(() => runs.filter((r) => !isSyntheticRun(r)), [runs]);
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
    const scopeKeys = caseScope ? new Set(caseScope.keys) : null;
    const filtered = caseViews.filter(
      (v) =>
        matchesFilter(v, filter) &&
        (!facetSkill || v.skill === facetSkill) &&
        (!scopeKeys || scopeKeys.has(v.key))
    );
    return worstFirstSort(filtered);
  }, [caseViews, filter, facetSkill, caseScope]);

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
  // "Confirmed" means a human said so. Review exposes that distinction while
  // the explicit bulk handoff transfers every item currently marked Flagged.
  const confirmedFlagKeys = useMemo(
    () => caseViews.filter((v) => v.decision === "flag" && v.source === "human").map((v) => v.key),
    [caseViews]
  );
  const selectedView = selectedKey ? viewByKey.get(selectedKey) ?? null : null;
  const optimizationQueue = useMemo(
    () => buildOptimizationQueue(skills, lastHandoff?.caseKeys ?? []),
    [skills, lastHandoff],
  );
  const selectedOptimizationQueueSkill = useMemo(
    () => optimizationQueue.find((item) => item.skill === selectedSkill) ?? null,
    [optimizationQueue, selectedSkill],
  );
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
        scorecard_path: cfg.scorecard_path ?? undefined,
        updated_at: nowIso(),
        decisions: next
      };
      saveReviewDecisions(doc)
        .then(() => setSaveStatus("saved"))
        .catch(() => {
          setSaveStatus("error");
          pushToastRef.current?.("Saving review decisions failed. Your grades are not persisted; retry from the action bar.", "bad");
        });
    }, 400);
  }, []);

  // Toast from inside scheduleSave without a circular dependency.
  const pushToastRef = useRef<Store["pushToast"] | null>(null);

  /** Re-attempt persisting the current decisions after a failed save. */
  const retrySave = useCallback(() => {
    scheduleSave(decisionsRef.current);
  }, [scheduleSave]);

  // Warn before leaving while decisions are unsaved or failed to save (N9).
  const saveStatusRef = useRef<Store["saveStatus"]>("idle");
  saveStatusRef.current = saveStatus;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatusRef.current === "saving" || saveStatusRef.current === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ---------- toasts ----------
  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    const sticky = tone === "bad"; // errors persist until dismissed (N9)
    setToasts((cur) => [...cur, { id, message, tone, sticky }]);
    if (!sticky) window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);
  pushToastRef.current = pushToast;

  // ---------- live workflow progress ----------
  const studyRuns = useMemo(() => (live?.active ?? []).filter(isStudyRun), [live]);
  const optimizationRuns = useMemo(() => (live?.active ?? []).filter(isOptimizationRun), [live]);
  const studyRunning = studyRuns.some((run) => run.status === "running");
  const optimizationRunning =
    optimizationLaunch !== null ||
    Boolean(live?.optimization_launch) ||
    optimizationRuns.some((run) => run.status === "running");

  // Poll /api/live while the tab is visible: fast while either lane is active,
  // slow while idle. Evaluation and optimization transitions are handled
  // independently so one lane can never light, finish, or refresh the other.
  const liveRef = useRef<LiveStatusDTO | null>(null);
  liveRef.current = live;
  const selectedSkillLiveRef = useRef<string | null>(null);
  selectedSkillLiveRef.current = selectedSkill;
  const selectedIterationLiveRef = useRef<string | null>(null);
  selectedIterationLiveRef.current = selectedIterationId;
  useEffect(() => {
    let timer: number | null = null;
    let disposed = false;

    const schedule = (ms: number) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (disposed) return;
      if (document.hidden) return; // resumed by visibilitychange
      try {
        const next = await loadLive();
        if (disposed) return;
        const prev = liveRef.current;
        setLive(next);
        const prevStudyRunning = (prev?.active ?? []).some((run) => isStudyRun(run) && run.status === "running");
        const nextStudyRunning = next.active.some((run) => isStudyRun(run) && run.status === "running");
        const prevOptimizationRunning =
          Boolean(prev?.optimization_launch) ||
          (prev?.active ?? []).some((run) => isOptimizationRun(run) && run.status === "running");
        const nextOptimizationRunning =
          Boolean(next.optimization_launch) ||
          next.active.some((run) => isOptimizationRun(run) && run.status === "running");
        const nextOptimizationJournal = next.active.some(
          (run) => isOptimizationRun(run) && run.status === "running"
        );

        if (nextOptimizationJournal) {
          setOptimizationLaunch(null);
          if (optimizationLaunchTimer.current) {
            window.clearTimeout(optimizationLaunchTimer.current);
            optimizationLaunchTimer.current = null;
          }
        } else if (next.optimization_launch) {
          // Rehydrate a dispatcher accepted in a previous tab/session and keep
          // the starting animation alive between sequential skill journals.
          setOptimizationLaunch(next.optimization_launch);
        } else if (!nextOptimizationRunning) {
          setOptimizationLaunch(null);
        }

        if (prevStudyRunning && !nextStudyRunning) {
          const finished = prev!.active.find((run) => isStudyRun(run) && run.status === "running");
          pushToast(
            finished ? `Evaluation study finished: ${finished.label ?? finished.iteration}. Refreshing runs.` : "Evaluation study finished. Refreshing runs.",
            "good"
          );
        }
        if (prevOptimizationRunning && !nextOptimizationRunning) {
          const finished = prev!.active.find(
            (run) => isOptimizationRun(run) && run.status === "running"
          );
          const failures = next.active.filter(
            (run) => isOptimizationRun(run) && run.status === "failed"
          );
          if (failures.length) {
            pushToast(
              `Optimization stopped with ${failures.length} failed ${failures.length === 1 ? "skill" : "skills"}. Open Optimize for the recorded error and journal.`,
              "bad"
            );
          } else {
            pushToast(
              finished
                ? `Optimization round finished: ${finished.skill} ${finished.iteration}. Refreshing candidates.`
                : "Optimization workflow finished. Refreshing candidates.",
              "good"
            );
          }
        }

        const refreshSkills = nextOptimizationRunning || (prevOptimizationRunning && !nextOptimizationRunning);
        const refreshRuns = prevStudyRunning && !nextStudyRunning;
        const refreshInsights = refreshSkills || refreshRuns;
        if (refreshSkills || refreshRuns) {
          const [skillList, runList, ins] = await Promise.all([
            refreshSkills ? loadSkills().catch(() => null) : Promise.resolve(null),
            refreshRuns ? loadRuns().catch(() => null) : Promise.resolve(null),
            refreshInsights ? loadInsights().catch(() => null) : Promise.resolve(null)
          ]);
          if (disposed) return;
          if (skillList) setSkills(skillList);
          if (runList) setRuns(runList);
          if (ins) setInsights(ins);

          // Keep the selected baseline/round inspectable while its journal and
          // artifacts are still growing. This refresh deliberately preserves
          // the user's selected scenario rather than replaying fetchIteration's
          // initial-selection behavior on every poll.
          const selected = selectedSkillLiveRef.current;
          if (refreshSkills && selected && skillList) {
            const overview = skillList.find((item) => item.skill === selected);
            const liveIteration = next.active.find(
              (run) => isOptimizationRun(run) && run.skill === selected
            )?.iteration;
            const targetIteration =
              selectedIterationLiveRef.current ??
              liveIteration ??
              overview?.latest?.iteration ??
              overview?.history.find((item) => item.is_baseline)?.iteration ??
              null;
            if (targetIteration) {
              if (selectedIterationLiveRef.current === null) {
                selectedIterationLiveRef.current = targetIteration;
                setSelectedIterationId(targetIteration);
              }
              const detail = await loadIteration(selected, targetIteration).catch(() => null);
              if (
                !disposed &&
                detail &&
                selectedSkillLiveRef.current === selected &&
                selectedIterationLiveRef.current === targetIteration
              ) {
                setIterationDetail(detail);
              }
            }
          }
        }
        schedule(next.running || next.optimization_launch ? (next.poll_ms || 2500) : 8000);
      } catch {
        if (!disposed) schedule(8000); // server briefly away; keep last snapshot
      }
    };

    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pushToast]);

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
      const latest =
        ov?.latest ??
        ov?.history.filter((h) => !h.is_baseline).slice(-1)[0] ??
        ov?.history.find((h) => h.is_baseline) ??
        null;
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
        const latest = ov?.latest ?? ov?.history.find((item) => item.is_baseline) ?? null;
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
  const dismissHandoff = useCallback(() => setHandoffPanelVisible(false), []);
  const showHandoff = useCallback(() => setHandoffPanelVisible(true), []);

  const doExport = useCallback(async () => {
    // Machine suggestions remain triage hints. Only cases explicitly confirmed
    // by a human may cross the Review -> Optimize boundary.
    const confirmedFlags = caseViews.filter((v) => v.decision === "flag" && v.source === "human");
    const flags = confirmedFlags;
    const selectionMode: SelectionMode = "confirmed_flags";
    if (!flags.length) {
      pushToast("Confirm at least one suggested flag in Review before handoff.", "bad");
      return;
    }
    try {
      const cfg = configRef.current;
      const sc = scorecardRef.current;
      if (!cfg || !sc) throw new Error("no focused scorecard is loaded");
      const reviewDoc: ReviewDecisionDoc = {
        schema_version: "1.0",
        run_id: sc.runId,
        scorecard_path: cfg.scorecard_path ?? undefined,
        updated_at: nowIso(),
        decisions: decisionsRef.current,
      };
      // Persist immediately so the backend can independently verify that every
      // selected key is a human-authored flag from this run.
      await saveReviewDecisions(reviewDoc);
      setSaveStatus("saved");
      const keys = flags.map((v) => v.key);
      const sk = [...new Set(flags.map((v) => v.skill))].sort();
      const res = await exportHandoff(keys, selectionMode);
      if (res.case_keys.length !== keys.length) {
        const missing = keys.filter((key) => !res.case_keys.includes(key));
        throw new Error(
          `${missing.length} flagged ${missing.length === 1 ? "case was" : "cases were"} not accepted: ${missing.join(", ")}`,
        );
      }
      const sourceLabel = `${confirmedFlags.length} confirmed`;
      setLastHandoff({
        ...res,
        at: res.created_at || nowIso(),
        count: res.case_keys.length,
        caseKeys: res.case_keys,
        selectionMode: res.selection_mode,
      });
      setHandoffPanelVisible(true);
      const queued = buildOptimizationQueue(skillsRef.current, res.case_keys);
      setSelectedSkill(queued[0]?.skill ?? null);
      pushToast(
        `Handed off ${res.case_keys.length} flagged cases (${sourceLabel}) → ${res.focus_path.split("/").slice(-2).join("/")}.`,
        "good"
      );
      setLiveMessage(`${res.case_keys.length} flagged cases handed off to the optimizer across ${sk.length} skills.`);
      setStation("optimize");
    } catch (err) {
      pushToast(`Hand-off failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
    }
  }, [caseViews, pushToast, setStation]);

  const startOptimization = useCallback(async (concurrency = 1): Promise<boolean> => {
    if (!lastHandoff) {
      pushToast("Send flagged Review cases to Optimize before starting a round.", "bad");
      return false;
    }
    try {
      const rec = await launchOptimizationRequest(concurrency);
      setOptimizationLaunch(rec);
      pushToast(
        `Optimization started for ${rec.skills.length} ${rec.skills.length === 1 ? "skill" : "skills"} with ${rec.concurrency} parallel ${rec.concurrency === 1 ? "worker" : "workers"}. KEEP candidates will stop at Promote.`,
        "good"
      );
      setLiveMessage(`Optimization workflow ${rec.launch_id} started.`);
      setStation("optimize");
      if (optimizationLaunchTimer.current) window.clearTimeout(optimizationLaunchTimer.current);
      optimizationLaunchTimer.current = window.setTimeout(() => {
        setOptimizationLaunch((current) => {
          if (current?.launch_id !== rec.launch_id) return current;
          pushToastRef.current?.(
            `Optimization was accepted but no journal appeared. Inspect ${rec.log}.`,
            "bad"
          );
          return null;
        });
        optimizationLaunchTimer.current = null;
      }, 30_000);
      window.setTimeout(() => {
        void loadLive().then(setLive).catch(() => undefined);
      }, 800);
      return true;
    } catch (err) {
      pushToast(`Optimization launch failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
      return false;
    }
  }, [lastHandoff, pushToast, setStation]);

  // ---------- launching runs ----------
  // POST the validated request; the server spawns the detached audit process
  // and progress flows back through the journal the /api/live poll reads.
  const launchEvalRun = useCallback(
    async (payload: LaunchRequest): Promise<LaunchRecord | null> => {
      try {
        const rec = await launchRun(payload);
        pushToast(
          `Run launched: ${rec.skills.length} ${rec.skills.length === 1 ? "skill" : "skills"}, ${
            rec.judge ? `Visual Tests on (${rec.n_judges} AI reviewers)` : "Code Tests only"
          }`,
          "good"
        );
        setLiveMessage(`Eval run ${rec.launch_id} launched.`);
        try {
          setLive(await loadLive()); // Show the starting row immediately.
        } catch {
          /* the regular poll catches up */
        }
        return rec;
      } catch (err) {
        pushToast(`Launch failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
        return null;
      }
    },
    [pushToast]
  );

  const cancelLiveRun = useCallback(
    async (launchId: string) => {
      try {
        await cancelRun(launchId);
        pushToast(`Cancellation signalled for ${launchId}`, "good");
        try {
          setLive(await loadLive());
        } catch {
          /* the regular poll catches up */
        }
      } catch (err) {
        pushToast(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
      }
    },
    [pushToast]
  );

  // The human promotion gate: apply a staged KEEP candidate, then refresh the
  // skills tree so "staged" flips to "promoted" from disk truth, not optimism.
  const promoteSkillCandidate = useCallback(
    async (skill: string, iteration: string): Promise<boolean> => {
      try {
        await promoteCandidate(skill, iteration);
        pushToast(`Promoted ${skill} ${iteration} → skills/${skill}/SKILL.md (previous version archived)`, "good");
        setLiveMessage(`Candidate ${iteration} promoted to the live ${skill} skill.`);
        try {
          setSkills(await loadSkills());
        } catch {
          /* next boot refresh catches up */
        }
        return true;
      } catch (err) {
        pushToast(`Promotion failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
        return false;
      }
    },
    [pushToast]
  );

  // Decide records human authority separately from Promote's live-file write.
  const reviewSkillCandidate = useCallback(
    async (skill: string, iteration: string, decision: "approve" | "reject"): Promise<boolean> => {
      try {
        await reviewCandidate(skill, iteration, decision);
        const [skillList, detail] = await Promise.all([loadSkills(), loadIteration(skill, iteration)]);
        setSkills(skillList);
        if (selectedSkillLiveRef.current === skill && selectedIterationLiveRef.current === iteration) {
          setIterationDetail(detail);
        }
        const verb = decision === "approve" ? "approved for Promote" : "rejected";
        pushToast(`Candidate ${skill} ${iteration} ${verb}.`, decision === "approve" ? "good" : "info");
        setLiveMessage(`Human review ${decision} recorded for ${skill} ${iteration}.`);
        return true;
      } catch (err) {
        pushToast(`Candidate review failed: ${err instanceof Error ? err.message : String(err)}`, "bad");
        return false;
      }
    },
    [pushToast]
  );

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
    evalRuns,
    activeHarness,
    harnesses,
    visibleRuns,
    saveStatus,
    registry,
    insights,
    live,
    studyRuns,
    optimizationRuns,
    studyRunning,
    optimizationRunning,
    optimizationLaunch,
    baselineRunId,
    baselineRun,
    baselineLoading,
    diff,
    caseScope,
    caseViews,
    orderedCases,
    selectedView,
    counts,
    needsYouCount,
    confirmedFlagKeys,
    lastHandoff,
    handoffPanelVisible,
    dismissHandoff,
    showHandoff,
    skills,
    optimizationQueue,
    selectedSkill,
    selectedOptimizationQueueSkill,
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
    dismissToast,
    retrySave,
    doExport,
    startOptimization,
    switchRun,
    setActiveHarness,
    setBaselineRun,
    setCaseScope,
    launchEvalRun,
    cancelLiveRun,
    reviewSkillCandidate,
    promoteSkillCandidate,
    reload: boot
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
