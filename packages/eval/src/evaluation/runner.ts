/**
 * Pure deterministic evaluation runner: loads a case + captured evidence,
 * dispatches every check through the registry, returns pass/fail.
 */
import "./checks/index.js"; // side-effect: registers built-in matchers
import { dispatch } from "./registry.js";
import { CaseResult, CheckResult } from "./types.js";

export const DEFAULT_CHECK_CATEGORIES: Record<string, string> = {
  entity_exists: "entity_state",
  entity_translation_delta: "semantic_scene_state",
  no_runtime_errors: "execution_health",
  camera_target_view: "camera_framing",
  json_value_equals: "semantic_scene_state",
  json_value_compare: "semantic_scene_state",
  collection_count: "semantic_scene_state",
  pattern_present: "source_contract",
  pattern_absent: "source_contract",
  code_runs: "execution_health",
  artifact_text_absent: "artifact_hygiene",
};

export const DEFAULT_CRITICAL_CATEGORIES = new Set([
  "execution_health",
  "entity_state",
  "semantic_scene_state",
  "camera_framing",
  "asset_and_provider_safety",
  "artifact_hygiene",
  "public_reproducibility",
]);

const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  camera_behavior: "camera_framing",
  generated_output_semantics: "semantic_scene_state",
};

export function normalizeCategory(category: string, checkType: string): string {
  if (category === "generated_output_semantics" && (checkType === "pattern_present" || checkType === "pattern_absent")) {
    return "source_contract";
  }
  return LEGACY_CATEGORY_ALIASES[category] ?? category;
}

function checkTolerance(spec: Record<string, any>): unknown {
  for (const key of ["tolerance", "tolerance_meters", "tolerance_degrees"]) {
    if (key in spec) return spec[key];
  }
  return null;
}

export function enrichCheckResult(
  result: CheckResult,
  spec: Record<string, any>,
  caseDoc: Record<string, any>,
): CheckResult {
  const rawCategory = String(
    spec.category ?? DEFAULT_CHECK_CATEGORIES[result.type] ?? caseDoc.category ?? "uncategorized",
  );
  const category = normalizeCategory(rawCategory, result.type);
  const critical = Boolean(spec.critical ?? caseDoc.critical ?? DEFAULT_CRITICAL_CATEGORIES.has(category));
  return {
    ...result,
    category,
    critical,
    weight: Number(spec.weight ?? result.weight),
    tolerance: checkTolerance(spec),
  };
}

export function runCase(caseDoc: Record<string, any>, evidence: Record<string, any>): CaseResult {
  const started = process.hrtime.bigint();
  const results: CheckResult[] = [];
  let error: string | null = null;

  try {
    for (const spec of caseDoc.checks ?? []) {
      results.push(enrichCheckResult(dispatch(spec, evidence), spec, caseDoc));
    }
  } catch (exc: any) {
    // Keep runner output structured even on malformed cases.
    error = `${exc?.constructor?.name ?? "Error"}: ${exc?.message ?? exc}`;
  }

  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const passed = results.length > 0 && results.every((result) => result.result === "pass") && error === null;
  return {
    case_id: String(caseDoc.id ?? ""),
    case_name: String(caseDoc.name ?? ""),
    skill: String(caseDoc.skill ?? ""),
    result: passed ? "pass" : "fail",
    duration_ms: durationMs,
    error,
    checks: results,
  };
}
