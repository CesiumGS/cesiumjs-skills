/**
 * Typed boundaries for the optimization lane. Scenario JSON is parsed and
 * shape-checked at load time (`loadScenario`) instead of flowing through the
 * codegen -> render -> judge -> decide pipeline as untyped `any`.
 *
 * Full structural validation (every field, regex patterns, filename rules)
 * lives in `cesium-eval validate`; this boundary check catches malformed or
 * mis-pathed scenario data before it can influence a promotion decision.
 */
import { readJson } from "../lib/json.js";

export interface ScenarioCheck {
  type: string;
  description?: string;
  pattern?: string;
  [key: string]: unknown;
}

export interface ScenarioScreenshot {
  timing?: string;
  description?: string;
  delay_ms?: number;
  [key: string]: unknown;
}

export interface Scenario {
  id: string;
  name: string;
  difficulty?: string;
  description?: string;
  prompt: string;
  expected_behaviors?: string[];
  visual_expectations?: string;
  programmatic_checks?: ScenarioCheck[];
  screenshots?: ScenarioScreenshot[];
  regression_critical?: boolean;
  runner_mode?: string;
  cardinal_panorama?: boolean;
  [key: string]: unknown;
}

/** One aggregated deterministic-check row fed to the decision engine. */
export interface CheckResultEntry {
  scenario_id: string;
  checks: Array<Record<string, unknown>>;
  all_passed?: boolean;
}

/** One aggregated judge-verdict row fed to the decision engine. */
export interface JudgeResultEntry {
  scenario_id: string;
  verdict: string | null;
  majority_count?: number;
  judge_unavailable?: boolean;
  error?: string;
}

/** Per-scenario metadata (hash + criticality) fed to the decision engine. */
export interface ScenarioMetaEntry {
  scenario_id: string;
  skill: string;
  current_hash: string;
  regression_critical: boolean;
}

/** Load a scenario JSON and reject malformed shapes at the boundary. */
export function loadScenario(filePath: string): Scenario {
  const data = readJson(filePath);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${filePath}: scenario must be a JSON object`);
  }
  if (typeof data.id !== "string" || !/^eval-\d{3}$/.test(data.id)) {
    throw new Error(`${filePath}: scenario id must match eval-NNN, got ${JSON.stringify(data.id)}`);
  }
  if (typeof data.prompt !== "string" || !data.prompt.trim()) {
    throw new Error(`${filePath}: scenario prompt must be a non-empty string`);
  }
  if (data.name !== undefined && typeof data.name !== "string") {
    throw new Error(`${filePath}: scenario name must be a string when present`);
  }
  return data as Scenario;
}
