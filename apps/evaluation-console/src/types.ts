// ---- Raw scorecard shapes (as produced by the eval harness; two modes, see DESIGN-SPEC §0) ----
export type GateResult = "pass" | "fail";

// The codegen harness a run was produced with (the "tested with" id). Mirrors the
// shared harness registry, plus the first-class "unknown" bucket for legacy
// fieldless runs. Widened so a new harness name still types.
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
  schemaVersion: string;
  visualReviewSupplied: boolean; // false => Mode B
  harness: Harness; // backfilled from ConfigDTO.harness in the store when raw omits it
  // Codegen model provenance from artifacts.model / artifacts.model_variant.
  // null = the run did not record it ("unrecorded"), never a guessed value.
  model: string | null;
  modelVariant: string | null;
  harnessJudge: string | null;
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
  source?: "agent" | "fixtures" | "mixed"; // evidence source of the loaded run
}

export interface RunSummary {
  run_id: string;
  scorecard_path: string;
  timestamp_utc: string;
  overall_result: GateResult | string;
  git_commit: string;
  harness?: string;
  // Which artifact produced this row: a canonical eval scorecard or an audit
  // pipeline's copy. Audit copies of an eval run are de-duplicated server-side.
  kind?: "eval" | "audit";
  // Evidence source: agent = real harness/observed evidence; fixtures =
  // synthetic checker fixtures; mixed = a sweep containing both.
  source?: "agent" | "fixtures" | "mixed";
  // Provenance stamps (null = not recorded by that run).
  model?: string | null;
  model_variant?: string | null;
  harness_judge?: string | null;
  overall_score?: number | null;
  threshold?: number | null;
  det_pass_count?: number;
  det_fail_count?: number;
  visual_review_supplied: boolean;
  pass_count: number;
  fail_count: number;
  needs_review_count: number;
  not_reviewed_count: number;
  total_cases: number;
}

// ---- run diff (current run vs a chosen comparison baseline run) ----
export interface RunCaseLite {
  key: string;
  result: string;
  score: number | null;
  visual_status: string;
  visual_score: number | null;
}

export interface RunCasesDTO {
  run_id: string;
  cases: RunCaseLite[];
}

export type DiffBucket = "fixed" | "regressed" | "still_failing" | "added" | "removed";

export interface BaselineDiff {
  baselineRunId: string;
  fixed: string[];        // fail -> pass
  regressed: string[];    // pass -> fail
  stillFailing: string[]; // fail -> fail
  added: string[];        // case exists only in the current run
  removed: string[];      // case exists only in the baseline run
  scoreDelta: number | null; // overall_score(current) - overall_score(baseline)
}

/** A drill-down scope: aggregate signal -> the exact cases explaining it. */
export interface CaseScope {
  label: string;
  keys: string[];
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
// Skill Evaluation Console — optimization-lifecycle shapes (mirror packages/eval/src/console/optimizationData.ts)
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

/** Recorded codegen provenance for one optimization iteration (from the
 *  generated *.meta.json sidecars). null harness/model = the run predates
 *  provenance stamping — rendered as "unrecorded", never guessed. */
export interface IterationProvenance {
  harness: string | null;
  model_id: string | null;
  model_variant: string | null;
  temperature: number | null;
  mixed: boolean;
}

export interface IterationSummary {
  iteration: string;
  is_baseline: boolean;
  status: IterationStatus;
  failed_step: string | null;
  decision: LoopDecision;
  rule_fired: string | null;
  rationale: string | null;
  /** Post-promotion-gate state of a KEEP: staged (awaits human), promoted, or unknown. */
  promotion?: "promoted" | "staged" | "unknown" | null;
  counts: IterationCounts;
  scores: IterationScores;
  started_utc: string | null;
  finished_utc: string | null;
  has_runs: boolean;
  provenance?: IterationProvenance | null;
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
  /** Proposer seed provenance: explicit = seeded by a handed-in decision record. */
  proposer_seed?: { explicit: boolean | null; decision_path: string | null } | null;
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
// Live eval-run progress (mirrors packages/eval/src/console/liveData.ts, served
// by /api/live and polled by the store while the console is visible)
// ============================================================================
export type LivePhaseState = "pending" | "active" | "done" | "failed";
export type LiveRunStatus = "running" | "stalled";

export interface LivePhase {
  id: string;
  label: string;
  weight: number;
  state: LivePhaseState;
  started_utc: string | null;
  trials_done: number | null;  // null = this phase has no countable trial artifacts
  trials_total: number | null;
}

export interface LiveTrial {
  scenario_id: string;
  label: string;
  runnable: boolean;
  codegen_done: boolean;
  render_done: boolean;
  judged: boolean;
}

export interface LiveRun {
  skill: string;
  // Display label override (audits span skills; the loop rows derive from skill).
  label?: string | null;
  iteration: string;
  kind: "iteration" | "baseline" | "audit";
  /** Console-launched audits carry their launch id (enables cancellation). */
  launch_id?: string | null;
  // Audit runs: whether the visual-judge lane is part of this run.
  judge?: boolean;
  status: LiveRunStatus;
  started_utc: string | null;
  last_activity_utc: string | null;
  elapsed_s: number | null;
  current_phase: string | null;
  current_phase_label: string | null;
  phase_index: number;
  phase_total: number;
  phases: LivePhase[];
  trials: LiveTrial[];
  trials_total: number;
  progress: number; // 0..1, weighted phases + real trial counts, never guessed
  last_event: { event: string; step?: string | null; timestamp_utc?: string | null };
  journal_tail: JournalEvent[];
}

export interface LiveStatusDTO {
  generated_at: string;
  running: boolean;
  poll_ms: number;
  max_age_s: number;
  active: LiveRun[];
}

// ============================================================================
// Harness / model registry (mirrors config/harness-registry.json,
// served by /api/registry with live pipeline defaults overlaid)
// ============================================================================
export type PriceBand = "very-low" | "low" | "medium" | "high" | "very-high";

export interface ModelSpec {
  id: string;
  family: string;
  /** Model creator (OpenAI, Anthropic, Google, Microsoft…) — the catalog groups by this. */
  vendor: string | null;
  name: string;
  tier: string | null;
  price_band: PriceBand | null;
  price_usd_per_mtok: { input: number; output: number } | null;
  native_vision: boolean | null;
  effort_levels: string[];
  context_k: number | null;
  release: string | null;
  notes: string | null;
}

export interface HarnessSpec {
  id: string;
  name: string;
  binary: string;
  provider: string;
  provider_label: string;
  auth: string;
  multimodal: boolean;
  vision_note: string;
  vision_fallback_to?: string;
  vision_fallback_for?: string[];
  roles: string[];
  default_model: string;
  default_effort: string;
  effort_mechanism: string;
  catalog_source: string;
  catalog_as_of: string;
  defaults_source?: string;
  models: ModelSpec[];
}

export interface RegistryDTO {
  schema_version: string;
  harnesses: HarnessSpec[];
}

// ---- observed model×harness insights (from /api/insights) ----
export interface ComboMember {
  skill: string;
  iteration: string;
  decision: LoopDecision;
  status: string;
  win_rate: number | null;
  started_utc: string | null;
}

export interface ComboInsight {
  harness: string; // "unrecorded" for legacy metas without a harness stamp
  model_id: string;
  model_variant: string | null;
  iterations: number;
  keeps: number;
  rejects: number;
  undecided: number;
  wins: number;
  losses: number;
  ties: number;
  skills: string[];
  keep_rate: number | null;
  win_rate: number | null;
  win_rate_stddev: number | null; // null = fewer than 2 scored iterations
  scored_iterations: number;
  mean_duration_s: number | null;
  first_used: string | null;
  last_used: string | null; // codegen recency: when this combo last generated code
  last_evaluated: string | null; // when a run last evaluated code from this combo
  last_active: string | null; // newer of generation or evaluation — the honest "recency"
  members: ComboMember[];
}

export interface InsightsDTO {
  combos: ComboInsight[];
}

// ============================================================================
// Skill Evaluation Console — UI state
// ============================================================================
export type Station = "dashboard" | "live" | "evaluate" | "review" | "optimize" | "decide" | "promote" | "models" | "harnesses";

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
