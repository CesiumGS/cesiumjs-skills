import type {
  ConfigDTO,
  FocusPreview,
  InsightsDTO,
  IterationDetail,
  LiveStatusDTO,
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
export const loadScorecard = () => req<RawScorecard>("/api/scorecard");
export const loadReviewDecisions = () => req<ReviewDecisionDoc | null>("/api/review-decisions");
export const loadRuns = () => req<RunSummary[]>("/api/runs");
export const loadRunCases = (runId: string) =>
  req<RunCasesDTO>(`/api/run-cases?run_id=${encodeURIComponent(runId)}`);
export const loadRegistry = () => req<RegistryDTO>("/api/registry");
export const loadInsights = () => req<InsightsDTO>("/api/insights");
export const loadLive = () => req<LiveStatusDTO>("/api/live");
export const loadLaunchSkills = () => req<{ skills: string[] }>("/api/live/skills");

// ---- launching runs ----
export interface LaunchRequest {
  kind: "audit";
  skills?: string[]; // omitted or empty = all skills
  judge: boolean;
  /** Judge adapter (audit --adapter): any registry harness id, or "fake" for CI-style smoke runs. */
  adapter: string;
  n_judges: number;
  judge_model?: string | null;
  /** Codegen provenance stamp (audit --harness): the harness that produced the audited baselines. */
  harness?: string | null;
  threshold?: number | null;
  bundle_root?: string | null;
}

export interface LaunchRecord {
  launch_id: string;
  kind: string;
  pid: number;
  skills: string[];
  judge: boolean;
  adapter: string;
  n_judges: number;
  judge_model?: string | null;
  harness?: string | null;
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
