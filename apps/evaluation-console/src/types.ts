// ---- Raw scorecard shapes (as produced by the eval harness; two modes, see DESIGN-SPEC §0) ----
export type GateResult = "pass" | "fail";

// The codegen harness a run was produced with (the "tested with" id). Mirrors
// optimization/framework/adapters/agent_cli.VALID_HARNESSES, plus the first-class
// "unknown" bucket for legacy fieldless runs. Widened so a new harness name still types.
export type Harness = "opencode" | "codex" | "claude-code" | "unknown" | (string & {});
export type VisualStatus = "pass" | "fail" | "needs_review" | "not_reviewed" | "not_applicable";

export interface RawCheck {
  check_id: string;
  type: string;
  result: GateResult;
  category: string;
  critical: boolean;
  weight?: number;
  tolerance?: unknown;
  actual?: unknown;
  expected?: unknown;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface RawDimension {
  status?: VisualStatus;
  score?: number | null; // 0-10 in Mode A; absent in Mode B
  note?: string;
}

export interface RawVisualReview {
  status?: VisualStatus;
  required?: boolean;
  blocking?: boolean;
  score?: number | null;
  overall_score?: number | null; // 0-10
  failure_flags?: string[];
  reviewer?: string;
  reviewed_at?: string | null;
  summary?: string;
  dimensions?: Record<string, RawDimension>;
  observations?: string[];
  risks?: string[];
  screenshots?: string[];
  artifact_path?: string;
}

export interface RawEvidenceSummary {
  expected_result?: string | null;
  evidence_source?: string | null;
  actual_source_path?: string | null;
  run_artifact_path?: string | null;
  source_scenario_id?: string | null;
  observed_from?: string | null;
  evidence_path?: string;
  has_generated_code?: boolean;
}

export interface RawSourceContext {
  source?: string;
  source_scenario_id?: string | null;
  source_name?: string | null;
  landmark?: string | null;
  perspective?: string | null;
  difficulty?: string | null;
  expected_behaviors?: string[];
  visual_expectations?: string;
  screenshot_mode?: string | null;
}

export interface RawCase {
  case_id: string;
  case_name: string;
  skill: string;
  task: string;
  category: string;
  result: GateResult;
  score: number; // 0-1
  duration_ms?: number;
  error?: string | null;
  evidence_path?: string;
  evidence_summary?: RawEvidenceSummary;
  screenshots?: string[];
  visual_review?: RawVisualReview;
  checks?: RawCheck[];
  source_context?: RawSourceContext;
}

export interface VisualSummary {
  result?: string;
  visual_review_supplied?: boolean;
  required_count?: number;
  reviewed_count?: number;
  total_cases?: number;
  pass_count?: number;
  fail_count?: number;
  needs_review_count?: number;
  not_reviewed_count?: number;
  not_applicable_count?: number;
  blocking_failures?: unknown[];
}

export interface RawScorecard {
  schema_version: string;
  harness?: string;
  run_id: string;
  timestamp_utc: string;
  git_commit: string;
  overall_result: GateResult;
  deterministic_result: GateResult;
  overall_score: number; // 0-1
  threshold: number;
  category_scores?: Record<string, { score: number }>;
  critical_failures?: unknown[];
  visual_summary?: VisualSummary;
  cases: RawCase[];
  artifacts?: Record<string, unknown>;
}

// ---- Normalized (adapted) shapes the UI consumes ----
export interface AdaptedDimension {
  key: string;       // raw key
  label: string;     // humanized display label
  status: VisualStatus;
  score: number | null; // 0-10, null in Mode B
  hasScore: boolean;
  note: string;
}

export interface AdaptedCase {
  key: string;        // "skill/case_id"
  case_id: string;
  case_name: string;
  skill: string;
  task: string;
  category: string;
  difficulty: string | null;
  landmark: string | null;
  perspective: string | null;
  expectedBehaviors: string[];
  visualExpectations: string;
  screenshotMode: string | null;
  result: GateResult;            // deterministic
  score: number;                 // 0-1
  visualStatus: VisualStatus;
  visualScore: number | null;    // 0-10
  visualSummary: string;
  dimensions: AdaptedDimension[];
  observations: string[];
  risks: string[];
  checks: RawCheck[];
  failedChecks: RawCheck[];
  criticalFailedChecks: RawCheck[];
  screenshots: string[];         // resolved candidate paths, ordered
  expectedVisualShots: number;
  observedVisualShots: number;
  evidence: RawEvidenceSummary;
  evidencePath: string;
}

export interface AdaptedScorecard {
  runId: string;
  gitCommit: string;
  timestampUtc: string;
  overallResult: GateResult;
  deterministicResult: GateResult;
  overallScore: number;
  threshold: number;
  visualReviewSupplied: boolean; // false => Mode B
  harness: Harness; // backfilled from ConfigDTO.harness in the store when raw omits it
  categoryScores: Record<string, number>;
  cases: AdaptedCase[];
}

// ---- Decisions / review ----
export type Decision = "accept" | "flag" | "defer";
export type Source = "auto" | "human";

export interface DecisionRecord {
  case_id: string;
  skill: string;
  decision: Decision;
  source: Source;
  note?: string;
  updated_at: string;
}

export interface ReviewDecisionDoc {
  schema_version: "1.0";
  run_id: string;
  scorecard_path?: string;
  reviewer?: string;
  updated_at: string;
  decisions: Record<string, DecisionRecord>;
}

// ---- Server DTOs ----
export interface ConfigDTO {
  repo_root: string;
  scorecard_path: string;
  review_decisions_path: string;
  optimization_handoff_path: string;
  focus_path: string;
  run_id: string;
  harness?: string;        // server-resolved codegen harness (sole inference site)
  harness_judge?: string;  // qualitative-judge harness, for provenance disclosure
}

export interface RunSummary {
  run_id: string;
  scorecard_path: string;
  timestamp_utc: string;
  overall_result: GateResult | string;
  git_commit: string;
  harness?: string;
  visual_review_supplied: boolean;
  pass_count: number;
  fail_count: number;
  needs_review_count: number;
  not_reviewed_count: number;
  total_cases: number;
}

export interface FocusPreview {
  focus: unknown;
  command: string;
  skills: string[];
  dropped?: string[];
  case_count: number;
  focus_path: string;
}

export type SelectionMode = "confirmed_flags" | "confirmed_and_suggested";

// ---- UI state ----
export type FilterKind = "all" | "flag" | "defer" | "overridden" | "accept" | "not_reviewed";
export type OverlayKind = null | "matrix" | "handoff" | "palette" | "lightbox" | "cheatsheet" | "runpicker";

export interface CaseView extends AdaptedCase {
  decision: Decision;
  source: Source;
  note: string;
}

// ============================================================================
// Skill Evaluation Console — optimization-lifecycle shapes (mirror apps/evaluation-console/optimization_data.py)
// ============================================================================
export type LoopDecision = "KEEP" | "REJECT" | null;
export type IterationStatus = "baseline" | "completed" | "failed" | "running" | "stalled" | "empty";
export type ScenarioVerdict = "CANDIDATE" | "BASELINE" | "TIE" | null; // WIN / LOSS / TIE

export interface IterationCounts {
  wins: number;
  losses: number;
  ties: number;
  critical_failures: number;
  check_failures: number;
}

export interface IterationScores {
  programmatic: number | null;
  api: number | null;
  visual_win_rate: number | null;
  coverage_delta: number | null;
}

export interface JournalEvent {
  event: string;
  step?: string;
  iteration?: string;
  skill?: string;
  decision?: string;
  timestamp_utc?: string;
  result?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface IterationSummary {
  iteration: string;
  is_baseline: boolean;
  status: IterationStatus;
  failed_step: string | null;
  decision: LoopDecision;
  rule_fired: string | null;
  rationale: string | null;
  counts: IterationCounts;
  scores: IterationScores;
  started_utc: string | null;
  finished_utc: string | null;
  has_runs: boolean;
}

export interface IndividualVerdict {
  seed: number | null;
  verdict: ScenarioVerdict;
  rationale: string | null;
  judge_index: number | null;
}

export interface ScenarioDetail {
  scenario_id: string;
  label: string;
  dir: string;
  verdict: ScenarioVerdict;
  majority_count: number | null;
  judge_unavailable: boolean;
  individual_verdicts: IndividualVerdict[];
  checks: { passed: number; total: number; critical_failed: number };
  console_errors: number;
  candidate_screenshots: string[];
  baseline_screenshots: string[];
}

export interface IterationDetail extends IterationSummary {
  scenarios: ScenarioDetail[];
  journal: JournalEvent[];
}

export interface SkillMdMeta {
  exists: boolean;
  bytes?: number;
  lines?: number;
}

export interface SkillOverview {
  skill: string;
  iteration_count: number;
  kept: number;
  rejected: number;
  latest: IterationSummary | null;
  running: boolean;
  history: IterationSummary[];
  skill_md: SkillMdMeta;
}

// ============================================================================
// Skill Evaluation Console — UI state
// ============================================================================
export type Station = "evaluate" | "review" | "optimize" | "decide" | "promote";

export type ConsoleOverlay =
  | null
  | "matrix"
  | "dimensionMatrix"
  | "trends"
  | "journal"
  | "palette"
  | "help"
  | "harness"
  | "lightbox";

export interface FocusEntry {
  key: string; // "skill/case_id"
  case_id: string;
  skill: string;
  case_name: string;
  provenance: "human_override" | "auto";
  added_at: string;
}
