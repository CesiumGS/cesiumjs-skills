import type {
  AdapterStatusDTO,
  BaselineCoverageDTO,
  ConfigDTO,
  FocusPreview,
  HarnessHealthDTO,
  InsightsDTO,
  IterationDetail,
  LiveStatusDTO,
  ProbeResultDTO,
  RawScorecard,
  RegistryDTO,
  ReviewDecisionDoc,
  RunCasesDTO,
  RunSummary,
  SelectionMode,
  SkillOverview
} from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

/** Map a repo-relative artifact path to the server's artifact route. */
export function artifactUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(path)) return path;
  return `/api/artifact?path=${encodeURIComponent(path)}`;
}

// ---- evaluate / review ----
export const loadConfig = () => req<ConfigDTO>("/api/config");
export const loadScorecard = () => req<RawScorecard | null>("/api/scorecard");
export const loadReviewDecisions = () => req<ReviewDecisionDoc | null>("/api/review-decisions");
export const loadRuns = () => req<RunSummary[]>("/api/runs");
export const loadRunCases = (runId: string) =>
  req<RunCasesDTO>(`/api/run-cases?run_id=${encodeURIComponent(runId)}`);
export const loadRegistry = () => req<RegistryDTO>("/api/registry");
export const loadHarnessHealth = () => req<HarnessHealthDTO>("/api/harnesses");

/** Run one binding probe (capability + observed attribution). Synchronous:
 * the response IS the result (2-40s depending on the harness; probes are
 * serialized server-side — a concurrent request 409s). Pass adapterTarget to
 * route through the protocol adapter (verification shifts to the model id). */
export const probeHarness = (harness: string, model?: string, variant?: string, adapterTarget?: string) =>
  req<ProbeResultDTO>("/api/probe", {
    method: "POST",
    body: JSON.stringify({
      harness,
      model: model || undefined,
      variant: variant || undefined,
      adapter_target: adapterTarget || undefined
    })
  });

// ---- baseline screenshots (visual-study prerequisite) ----
export const loadBaselineCoverage = (skills: string[]) =>
  req<BaselineCoverageDTO>(`/api/baselines?skills=${encodeURIComponent(skills.join(","))}`);
/** Render missing baseline screenshots for these skills. Synchronous: the
 * response carries the fresh coverage (seconds for a couple skills). */
export const renderBaselines = (skills: string[]) =>
  req<BaselineCoverageDTO>("/api/baselines/render", { method: "POST", body: JSON.stringify({ skills }) });

// ---- protocol adapter (LiteLLM) ----
export const loadAdapter = () => req<AdapterStatusDTO>("/api/adapter");
export const adapterAction = (action: "start" | "stop") =>
  req<AdapterStatusDTO>("/api/adapter", { method: "POST", body: JSON.stringify({ action }) });
export const loadInsights = () => req<InsightsDTO>("/api/insights");
export const loadLive = () => req<LiveStatusDTO>("/api/live");
export const loadLaunchSkills = () => req<{ skills: string[] }>("/api/live/skills");

// ---- launching runs ----
export interface LaunchRequest {
  kind: "audit";
  skills?: string[]; // omitted or empty = all skills
  judge: boolean;
  /** Judge harness (audit --judge-harness): any registry harness id, or "fake" for CI-style smoke runs. */
  judge_harness: string;
  n_judges: number;
  /** Cases judged in parallel (audit --concurrency), 1-8. Omitted = sequential. */
  concurrency?: number | null;
  judge_model?: string | null;
  /** Judge reasoning effort (audit --judge-variant): "low" | "medium" | "high" | "xhigh" | "max" | … */
  judge_variant?: string | null;
  /** Codegen provenance stamp (audit --codegen-harness): the harness that produced the audited baselines. */
  codegen_harness?: string | null;
  /** Codegen model provenance stamp (audit --codegen-model). */
  codegen_model?: string | null;
  /** Codegen reasoning-effort provenance stamp (audit --codegen-variant). */
  codegen_variant?: string | null;
  threshold?: number | null;
  bundle_root?: string | null;
}

export interface LaunchRecord {
  launch_id: string;
  kind: string;
  pid: number;
  skills: string[];
  judge: boolean;
  judge_harness: string;
  n_judges: number;
  concurrency?: number | null;
  judge_model?: string | null;
  judge_variant?: string | null;
  codegen_harness?: string | null;
  codegen_model?: string | null;
  codegen_variant?: string | null;
  journal: string;
  log: string;
  output_dir: string;
  started_utc: string;
}

export const launchRun = (payload: LaunchRequest) =>
  req<LaunchRecord>("/api/live/launch", { method: "POST", body: JSON.stringify(payload) });

export const cancelRun = (launchId: string) =>
  req<{ launch_id: string; killed: boolean }>("/api/live/cancel", {
    method: "POST",
    body: JSON.stringify({ launch_id: launchId })
  });

/** The human promotion gate: apply a staged KEEP candidate to skills/<skill>/SKILL.md. */
export const promoteCandidate = (skill: string, iteration: string) =>
  req<{ ok: boolean; skill: string; iteration: string }>("/api/optimization/promote", {
    method: "POST",
    body: JSON.stringify({ skill, iteration })
  });

export const saveReviewDecisions = (doc: ReviewDecisionDoc) =>
  req<ReviewDecisionDoc>("/api/review-decisions", { method: "PUT", body: JSON.stringify(doc) });

export const previewFocus = (confirmedCaseKeys: string[], selectionMode: SelectionMode) =>
  req<FocusPreview>("/api/focus-preview", {
    method: "POST",
    body: JSON.stringify({ confirmed_case_keys: confirmedCaseKeys, selection_mode: selectionMode })
  });

export interface HandoffResult {
  handoff_path: string;
  focus_path: string;
  command: string;
  focus_preview: FocusPreview;
}

export const exportHandoff = (confirmedCaseKeys: string[], skills: string[], selectionMode: SelectionMode) =>
  req<HandoffResult>("/api/optimization-handoff", {
    method: "PUT",
    body: JSON.stringify({ selection_mode: selectionMode, confirmed_case_keys: confirmedCaseKeys, skills })
  });

export const selectRun = (runId: string) =>
  req<ConfigDTO>("/api/select-run", { method: "POST", body: JSON.stringify({ run_id: runId }) });

// ---- optimize / decide ----
export const loadSkills = () => req<SkillOverview[]>("/api/optimization/skills");
export const loadSkill = (skill: string) =>
  req<SkillOverview>(`/api/optimization/skill?skill=${encodeURIComponent(skill)}`);
export const loadIteration = (skill: string, iteration: string) =>
  req<IterationDetail>(
    `/api/optimization/iteration?skill=${encodeURIComponent(skill)}&iteration=${encodeURIComponent(iteration)}`
  );
