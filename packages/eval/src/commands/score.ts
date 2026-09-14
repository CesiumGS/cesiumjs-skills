/**
 * `cesium-eval score` — run the deterministic evaluation scorecard over
 * tracked fixtures or captured evidence bundles.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, stableStringify } from "../lib/json.js";
import { fromRepoRoot, globAcrossDirs, repoRelative } from "../lib/paths.js";
import { gitCommit } from "../lib/proc.js";
import { nowIsoSeconds, pct } from "../lib/format.js";
import { runCase } from "../evaluation/runner.js";
import { ScorecardInput, buildScorecard, writeScorecard } from "../evaluation/scorecard.js";
import { loadScorecardValidator, loadVisualReviewValidator } from "../evaluation/schema.js";
import type { EvalContext } from "../config/types.js";

export type CaseIndex = Map<string, { path: string; data: Record<string, any> }>;

export const caseKey = (skill: string, caseId: string): string => `${skill}/${caseId}`;

export function loadCases(casesRoot: string): CaseIndex {
  const cases: CaseIndex = new Map();
  for (const casePath of globAcrossDirs(casesRoot, "eval-", ".json")) {
    const data = readJson(casePath);
    const key = caseKey(data.skill, data.id);
    if (cases.has(key)) throw new Error(`duplicate case id: ${key}`);
    cases.set(key, { path: casePath, data });
  }
  if (!cases.size) throw new Error(`no cases found under ${casesRoot}`);
  return cases;
}

function discoverFixtureEvidence(fixturesRoot: string, expectation: string): string[] {
  const paths = globAcrossDirs(fixturesRoot, "", ".evidence.json");
  if (expectation === "all") return paths;
  return paths.filter((p) => (readJson(p).expected_result ?? "pass") === expectation);
}

export function evidenceSummaryFor(evidence: Record<string, any>, evidencePath: string): Record<string, any> {
  const afterValues = (evidence.after ?? {}).values ?? {};
  return {
    expected_result: evidence.expected_result ?? null,
    evidence_source: evidence.source ?? null,
    actual_source_path: evidence.source_path ?? null,
    run_artifact_path: evidence.run_artifact_path ?? null,
    source_scenario_id: afterValues.source_scenario_id ?? null,
    observed_from: (evidence.execution ?? {}).observed_from ?? null,
    evidence_path: repoRelative(evidencePath),
    has_generated_code: typeof evidence.generated_code === "string" && Boolean(evidence.generated_code),
  };
}

export function validateVisualReview(visualReview: Record<string, any>, cases: CaseIndex): string[] {
  const errors = loadVisualReviewValidator()
    .errors(visualReview)
    .map((error) => `schema error at ${error.location}: ${error.message}`);
  const seen = new Set<string>();
  for (const item of visualReview.items ?? []) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const key = caseKey(String(item.skill ?? ""), String(item.case_id ?? ""));
    if (seen.has(key)) errors.push(`duplicate visual review item: ${key}`);
    seen.add(key);
    if (!cases.has(key)) errors.push(`visual review references unknown case: ${key}`);
  }
  return errors;
}

function runInputs(cases: CaseIndex, evidencePaths: string[]): ScorecardInput[] {
  const inputs = evidencePaths.map((evidencePath) => {
    const evidence = readJson(evidencePath);
    const key = caseKey(evidence.skill, evidence.case_id);
    const entry = cases.get(key);
    if (!entry) throw new Error(`${evidencePath}: evidence references unknown case ${key}`);
    return {
      caseDoc: entry.data,
      result: runCase(entry.data, evidence),
      evidencePath: repoRelative(evidencePath),
      screenshots: [...(evidence.screenshots ?? [])].map(String),
      evidenceSummary: evidenceSummaryFor(evidence, evidencePath),
    };
  });
  if (!inputs.length) throw new Error("no evidence selected for scorecard run");
  return inputs;
}

export interface ScoreOptions {
  casesRoot?: string;
  fixturesRoot?: string;
  fixtureExpectation?: "pass" | "fail" | "all";
  evidence?: string[];
  visualReview?: string;
  requireVisualReview?: boolean;
  harness?: string;
  model?: string;
  modelVariant?: string;
  threshold?: number;
  outputDir?: string;
}

export async function scoreCommand(ctx: EvalContext, options: ScoreOptions): Promise<number> {
  const cases = loadCases(options.casesRoot ?? fromRepoRoot("evaluation", "cases"));

  let evidencePaths = (options.evidence ?? []).map((p) => path.resolve(p));
  if (!evidencePaths.length) {
    evidencePaths = discoverFixtureEvidence(
      options.fixturesRoot ?? fromRepoRoot("evaluation", "fixtures"),
      options.fixtureExpectation ?? "pass",
    );
  }

  const visualReview = options.visualReview ? readJson(options.visualReview) : null;
  if (visualReview !== null) {
    const visualErrors = validateVisualReview(visualReview, cases);
    if (visualErrors.length) {
      for (const error of visualErrors) console.error(`[score] visual-review ${error}`);
      return 2;
    }
  }

  const scorecard = buildScorecard(runInputs(cases, evidencePaths), {
    threshold: options.threshold ?? ctx.config.threshold,
    repoRoot: ctx.repoRoot,
    timestampUtc: nowIsoSeconds(),
    commit: gitCommit(ctx.repoRoot),
    visualReview,
    requireVisualReview: options.requireVisualReview ?? false,
    harness: options.harness ?? null,
    model: options.model ?? null,
    modelVariant: options.modelVariant ?? null,
  });

  if (!options.harness && scorecard.artifacts.evidence_source !== "fixtures") {
    console.error(
      "[score] warning: agent-produced evidence scored without --harness; " +
        "this run will group under 'unknown' in the console. Pass --harness <id> to stamp it.",
    );
  }

  const outputDir = options.outputDir
    ? fromRepoRoot(options.outputDir)
    : fromRepoRoot("evaluation", "artifacts", "scorecards", scorecard.run_id);
  const { jsonPath, mdPath } = writeScorecard(scorecard, outputDir);

  const errors = loadScorecardValidator().errors(scorecard);
  if (errors.length) {
    for (const error of errors) console.error(`[score] schema error at ${error.location}: ${error.message}`);
    return 2;
  }

  console.log(`[score] wrote ${repoRelative(jsonPath)}`);
  console.log(`[score] wrote ${repoRelative(mdPath)}`);
  console.log(`[score] result=${scorecard.overall_result} score=${pct(scorecard.overall_score)}`);
  return scorecard.overall_result === "pass" ? 0 : 1;
}

/** `cesium-eval case` — run one case against one evidence bundle. */
export async function caseCommand(casePath: string, evidencePath: string, output?: string): Promise<number> {
  for (const [label, target] of [
    ["Case", casePath],
    ["Evidence", evidencePath],
  ] as const) {
    if (!fs.existsSync(target)) {
      console.error(`${label} not found: ${target}`);
      return 1;
    }
  }
  const result = runCase(readJson(casePath), readJson(evidencePath));
  const payload = stableStringify(result);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, payload + "\n");
  } else {
    console.log(payload);
  }
  return result.result === "pass" ? 0 : 1;
}
