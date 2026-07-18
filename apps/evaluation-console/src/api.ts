import type {
  ConfigDTO,
  FocusPreview,
  InsightsDTO,
  IterationDetail,
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
