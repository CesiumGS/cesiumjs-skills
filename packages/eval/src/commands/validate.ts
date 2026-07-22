/**
 * `cesium-eval validate` — validate evaluation cases/fixtures (deterministic
 * lane) and optimization scenario manifests (public eval lane).
 * Port of validate-evaluation.py + validate-evals.py. The Python-AST import
 * boundary check is retired: the TS module graph enforces that boundary.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalStringify, readJson } from "../lib/json.js";
import { fromRepoRoot, globAcrossDirs, listDirs, repoRelative } from "../lib/paths.js";
import { sha256Text } from "../lib/proc.js";
import {
  SCHEMAS_ROOT,
  assertValidSchema,
  loadCaseValidator,
  loadCheckValidator,
  loadEvidenceValidator,
  loadScorecardValidator,
  loadVisualReviewValidator,
  SchemaValidator,
} from "../evaluation/schema.js";

class ValidationFailure extends Error {}

function fail(prefix: string, message: string): never {
  console.error(`[${prefix}] FAIL: ${message}`);
  throw new ValidationFailure(message);
}

// ---------------------------------------------------------------------------
// deterministic evaluation lane (validate-evaluation.py)
// ---------------------------------------------------------------------------
function captureCoversPointer(captures: Set<string>, pointer: string): boolean {
  if (pointer === "") return true;
  if (!pointer.startsWith("/")) return false;

  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (!parts.length) return true;

  if (["generated_code", "errors", "screenshots"].includes(parts[0])) return captures.has(parts[0]);
  if (parts[0] === "execution" && parts[1] === "success") return captures.has("execution.success");
  if (parts[0] === "before" || parts[0] === "after") {
    const snapshot = parts[0];
    const rest = parts.slice(1);
    if (!rest.length) return true;
    if (rest[0] === "values" && rest.length >= 2) return captures.has(`${snapshot}.values.${rest[1]}`);
    if (rest[0] === "camera" && rest.length >= 2) return captures.has(`camera.${rest[1]}`);
    if (rest[0] === "entities" && rest.length >= 3) return captures.has(`entities[${rest[1]}].${rest[2]}`);
    const collectionMap: Record<string, string> = {
      imagery_layers: "imagery_layers",
      primitives: "primitives",
      tilesets: "tilesets",
      data_sources: "data_sources",
    };
    if (rest[0] in collectionMap) {
      const collection = collectionMap[rest[0]];
      if (rest.length === 1) return [...captures].some((capture) => capture.startsWith(`${collection}[*].`));
      if (rest.length >= 3 && /^\d+$/.test(rest[1])) return captures.has(`${collection}[*].${rest[2]}`);
    }
    if (["clock", "globe", "scene", "terrain", "events"].includes(rest[0]) && rest.length >= 2) {
      return captures.has(`${rest[0]}.${rest[1]}`);
    }
  }
  return false;
}

function validateProbeContract(filePath: string, data: Record<string, any>): void {
  const captures = new Set<string>(((data.probe ?? {}).capture ?? []).map(String));
  const genericPathChecks = new Set(["json_value_equals", "json_value_compare", "collection_count"]);
  const missing: string[] = [];
  for (const check of data.checks ?? []) {
    if (!genericPathChecks.has(check.type)) continue;
    const pointer = check.path;
    if (typeof pointer !== "string" || captureCoversPointer(captures, pointer)) continue;
    missing.push(`${check.id ?? "<unknown>"} path '${pointer}'`);
  }
  if (missing.length) {
    fail(
      "validate-evaluation",
      `${filePath}: generic checks read evidence paths not declared in probe.capture:\n  ` + missing.join("\n  "),
    );
  }
}

function validateCase(
  filePath: string,
  caseValidator: SchemaValidator,
  checkValidator: SchemaValidator,
): [string, string] {
  const data = readJson(filePath);
  const errors = caseValidator.errors(data);
  if (errors.length) {
    fail(
      "validate-evaluation",
      `${filePath}: schema validation failed:\n  ` + errors.map((e) => `${e.location}: ${e.message}`).join("\n  "),
    );
  }
  data.checks.forEach((check: unknown, index: number) => {
    const checkErrors = checkValidator.errors(check);
    if (checkErrors.length) {
      fail(
        "validate-evaluation",
        `${filePath}: check schema validation failed:\n  ` +
          checkErrors.map((e) => `checks[${index}].${e.location}: ${e.message}`).join("\n  "),
      );
    }
  });

  const skill = data.skill;
  if (path.basename(path.dirname(filePath)) !== skill) {
    fail("validate-evaluation", `${filePath}: parent directory must match skill '${skill}'`);
  }
  if (!path.basename(filePath).startsWith(data.id + "-")) {
    fail("validate-evaluation", `${filePath}: filename must start with case id ${data.id}-`);
  }

  const checkIds: string[] = data.checks.map((check: any) => check.id);
  const duplicates = [...new Set(checkIds.filter((id) => checkIds.filter((other) => other === id).length > 1))].sort();
  if (duplicates.length) {
    fail("validate-evaluation", `${filePath}: duplicate check id(s): ${duplicates.join(", ")}`);
  }

  validateProbeContract(filePath, data);
  return [skill, data.id];
}

function validateFixture(
  filePath: string,
  evidenceValidator: SchemaValidator,
  knownCases: Set<string>,
): [string, string] {
  const data = readJson(filePath);
  const errors = evidenceValidator.errors(data);
  if (errors.length) {
    fail(
      "validate-evaluation",
      `${filePath}: evidence schema validation failed:\n  ` + errors.map((e) => `${e.location}: ${e.message}`).join("\n  "),
    );
  }
  const skill = data.skill;
  const caseId = data.case_id;
  if (path.basename(path.dirname(filePath)) !== skill) {
    fail("validate-evaluation", `${filePath}: parent directory must match skill '${skill}'`);
  }
  if (!knownCases.has(`${skill}\u0000${caseId}`)) {
    fail("validate-evaluation", `${filePath}: fixture references unknown case ${skill}/${caseId}`);
  }
  const name = path.basename(filePath);
  if (!name.startsWith(caseId + "-") || !name.endsWith(".evidence.json")) {
    fail("validate-evaluation", `${filePath}: fixture filename must be <eval-id>-<slug>.evidence.json`);
  }
  return [String(skill), String(caseId)];
}

export function validateEvaluationLane(): void {
  const casesRoot = fromRepoRoot("evaluation", "cases");
  const fixturesRoot = fromRepoRoot("evaluation", "fixtures");
  if (!fs.existsSync(casesRoot)) fail("validate-evaluation", `${casesRoot} does not exist`);

  const casePaths = globAcrossDirs(casesRoot, "eval-", ".json");
  if (!casePaths.length) fail("validate-evaluation", "no evaluation case manifests found");

  for (const name of [
    "case.schema.json",
    "check.schema.json",
    "evidence.schema.json",
    "result.schema.json",
    "scorecard.schema.json",
    "visual-review.schema.json",
  ]) {
    const schema = readJson(path.join(SCHEMAS_ROOT(), name));
    if (name === "case.schema.json") schema.properties.checks.items = { type: "object" };
    if (name === "scorecard.schema.json") {
      const resultSchema = readJson(path.join(SCHEMAS_ROOT(), "result.schema.json"));
      schema.definitions.case_result.properties.checks.items = resultSchema.definitions.check_result;
    }
    try {
      assertValidSchema(name, schema);
    } catch (exc: any) {
      fail("validate-evaluation", exc.message);
    }
  }
  // Compilation side effects double as validity checks for the two validators.
  loadScorecardValidator();
  loadVisualReviewValidator();

  const caseValidator = loadCaseValidator();
  const checkValidator = loadCheckValidator();
  const evidenceValidator = loadEvidenceValidator();

  const seen = new Set<string>();
  for (const casePath of casePaths) {
    const [skill, caseId] = validateCase(casePath, caseValidator, checkValidator);
    const key = `${skill}\u0000${caseId}`;
    if (seen.has(key)) fail("validate-evaluation", `${casePath}: duplicate case id ${caseId} for skill ${skill}`);
    seen.add(key);
  }

  const fixturePaths = globAcrossDirs(fixturesRoot, "", ".evidence.json");
  const fixtureSeen = new Set<string>();
  for (const fixturePath of fixturePaths) {
    const [skill, caseId] = validateFixture(fixturePath, evidenceValidator, seen);
    const key = `${skill}\u0000${caseId}\u0000${path.basename(fixturePath)}`;
    if (fixtureSeen.has(key)) fail("validate-evaluation", `${fixturePath}: duplicate fixture filename`);
    fixtureSeen.add(key);
  }

  const skills = new Set([...seen].map((key) => key.split("\u0000")[0]));
  console.log(
    `[validate-evaluation] OK: ${casePaths.length} cases, ${fixturePaths.length} fixtures across ${skills.size} skills`,
  );
}

// ---------------------------------------------------------------------------
// optimization scenario lane (validate-evals.py)
// ---------------------------------------------------------------------------
const ALLOWED_CHECK_TYPES = new Set(["no_console_errors", "code_runs", "pattern_present", "pattern_absent"]);
const REQUIRED_FIELDS = [
  "id",
  "name",
  "difficulty",
  "description",
  "prompt",
  "expected_behaviors",
  "visual_expectations",
  "programmatic_checks",
  "screenshots",
  "regression_critical",
];

function requireString(data: Record<string, any>, key: string, filePath: string): void {
  if (typeof data[key] !== "string" || !data[key].trim()) {
    fail("validate-evals", `${filePath}: ${key} must be a non-empty string`);
  }
}

function validateScenarioCheck(check: Record<string, any>, filePath: string, index: number): void {
  const checkType = check.type;
  if (!ALLOWED_CHECK_TYPES.has(checkType)) {
    fail("validate-evals", `${filePath}: programmatic_checks[${index}].type is unsupported: '${checkType}'`);
  }
  requireString(check, "description", filePath);
  if (checkType === "pattern_present" || checkType === "pattern_absent") {
    requireString(check, "pattern", filePath);
    try {
      new RegExp(check.pattern);
    } catch (exc: any) {
      fail("validate-evals", `${filePath}: programmatic_checks[${index}].pattern is invalid regex: ${exc.message}`);
    }
  }
}

export function computeScenarioHash(scenarioPath: string): string {
  const data = readJson(scenarioPath);
  return sha256Text(canonicalStringify(data));
}

function validateScenario(filePath: string): [string, string, string, string] {
  const data = readJson(filePath);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    fail("validate-evals", `${filePath}: top-level JSON value must be an object`);
  }
  const missing = REQUIRED_FIELDS.filter((field) => !(field in data)).sort();
  if (missing.length) fail("validate-evals", `${filePath}: missing required field(s): ${missing.join(", ")}`);

  for (const key of ["id", "name", "difficulty", "description", "prompt", "visual_expectations"]) {
    requireString(data, key, filePath);
  }
  if (!/^eval-[0-9]{3}$/.test(data.id)) fail("validate-evals", `${filePath}: id must match eval-NNN`);
  if (!path.basename(filePath).startsWith(data.id + "-")) {
    fail("validate-evals", `${filePath}: filename must start with scenario id ${data.id}-`);
  }
  if (!Array.isArray(data.expected_behaviors) || !data.expected_behaviors.length) {
    fail("validate-evals", `${filePath}: expected_behaviors must be a non-empty array`);
  }
  if (!data.expected_behaviors.every((item: unknown) => typeof item === "string" && item.trim())) {
    fail("validate-evals", `${filePath}: expected_behaviors entries must be non-empty strings`);
  }
  if (!Array.isArray(data.programmatic_checks) || !data.programmatic_checks.length) {
    fail("validate-evals", `${filePath}: programmatic_checks must be a non-empty array`);
  }
  data.programmatic_checks.forEach((check: unknown, index: number) => {
    if (check === null || typeof check !== "object" || Array.isArray(check)) {
      fail("validate-evals", `${filePath}: programmatic_checks[${index}] must be an object`);
    }
    validateScenarioCheck(check as Record<string, any>, filePath, index);
  });
  if (!Array.isArray(data.screenshots) || !data.screenshots.length) {
    fail("validate-evals", `${filePath}: screenshots must be a non-empty array`);
  }
  data.screenshots.forEach((screenshot: any, index: number) => {
    if (screenshot === null || typeof screenshot !== "object" || Array.isArray(screenshot)) {
      fail("validate-evals", `${filePath}: screenshots[${index}] must be an object`);
    }
    for (const key of ["timing", "description"]) requireString(screenshot, key, filePath);
    if (!Number.isInteger(screenshot.delay_ms) || screenshot.delay_ms < 0) {
      fail("validate-evals", `${filePath}: screenshots[${index}].delay_ms must be a non-negative integer`);
    }
  });
  if (typeof data.regression_critical !== "boolean") {
    fail("validate-evals", `${filePath}: regression_critical must be boolean`);
  }
  const runnerMode = data.runner_mode ?? "global-js";
  if (!["global-js", "review-only"].includes(runnerMode)) {
    fail("validate-evals", `${filePath}: runner_mode must be global-js or review-only`);
  }

  const contentHash = sha256Text(canonicalStringify(data));
  return [path.basename(path.dirname(filePath)), data.id, contentHash, runnerMode];
}

function validatePublicStatus(
  skillCounts: Record<string, number>,
  runnerModeCountsBySkill: Record<string, Record<string, number>>,
): void {
  const resultsPath = fromRepoRoot("optimization", "results", "public-status.json");
  const data = readJson(resultsPath);
  if (data.schema_version !== "1.0") fail("validate-evals", `${resultsPath}: schema_version must be 1.0`);
  if (data.summary_type !== "public-sanitized-eval-status") {
    fail("validate-evals", `${resultsPath}: summary_type must be public-sanitized-eval-status`);
  }
  const skills = data.skills;
  if (!Array.isArray(skills) || !skills.length) fail("validate-evals", `${resultsPath}: skills must be a non-empty array`);
  for (const entry of skills) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail("validate-evals", `${resultsPath}: each skills entry must be an object`);
    }
    const skill = entry.skill;
    if (!(skill in skillCounts)) fail("validate-evals", `${resultsPath}: unknown skill summary '${skill}'`);
    if (entry.scenario_count !== skillCounts[skill]) {
      fail(
        "validate-evals",
        `${resultsPath}: ${skill} scenario_count ${entry.scenario_count} does not match ${skillCounts[skill]}`,
      );
    }
    const runnerModeCounts = entry.runner_mode_counts;
    if (runnerModeCounts === null || typeof runnerModeCounts !== "object" || Array.isArray(runnerModeCounts)) {
      fail("validate-evals", `${resultsPath}: ${skill} runner_mode_counts must be an object`);
    }
    const total = Object.values(runnerModeCounts as Record<string, number>).reduce((sum: number, count) => sum + Number(count), 0);
    if (total !== skillCounts[skill]) {
      fail("validate-evals", `${resultsPath}: ${skill} runner_mode_counts do not sum to scenario_count`);
    }
    const unknownModes = Object.keys(runnerModeCounts).filter((mode) => !["global-js", "review-only"].includes(mode));
    if (unknownModes.length) {
      fail("validate-evals", `${resultsPath}: ${skill} has unknown runner mode(s): ${JSON.stringify(unknownModes.sort())}`);
    }
    const expectedModeCounts = runnerModeCountsBySkill[skill] ?? {};
    const normalize = (counts: Record<string, number>) =>
      JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([, count]) => count).sort()));
    if (normalize(runnerModeCounts as Record<string, number>) !== normalize(expectedModeCounts)) {
      fail(
        "validate-evals",
        `${resultsPath}: ${skill} runner_mode_counts ${JSON.stringify(runnerModeCounts)} does not match manifests ${JSON.stringify(expectedModeCounts)}`,
      );
    }
  }
}

function loadBaselineHashes(): Record<string, Record<string, string>> {
  const baselinesPath = fromRepoRoot("optimization", "results", "baselines.json");
  if (!fs.existsSync(baselinesPath)) return {};
  const data = readJson(baselinesPath);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
  return data.scenarios ?? {};
}

function validateBaselines(scenarioHashes: Record<string, Record<string, string>>): void {
  const baselines = loadBaselineHashes();
  const failures: string[] = [];

  for (const [skill, scenarios] of Object.entries(scenarioHashes)) {
    const baselineScenarios = baselines[skill] ?? {};
    for (const [scenarioId, currentHash] of Object.entries(scenarios)) {
      const baselineHash = baselineScenarios[scenarioId];
      if (baselineHash === undefined) failures.push(`${skill}/${scenarioId}: missing baseline hash`);
      else if (baselineHash !== currentHash) {
        failures.push(
          `${skill}/${scenarioId}: baseline hash is stale (${baselineHash.slice(0, 12)}... != ${currentHash.slice(0, 12)}...)`,
        );
      }
    }
  }
  for (const [skill, scenarios] of Object.entries(baselines)) {
    if (!(skill in scenarioHashes)) {
      failures.push(`${skill}: stale baseline skill with no scenarios`);
      continue;
    }
    for (const scenarioId of Object.keys(scenarios)) {
      if (!(scenarioId in scenarioHashes[skill])) {
        failures.push(`${skill}/${scenarioId}: stale baseline for missing scenario`);
      }
    }
  }
  if (failures.length) {
    fail(
      "validate-evals",
      "baseline hashes are out of date; run `cesium-eval optimize rebaseline` for changed scenarios:\n  " +
        failures.join("\n  "),
    );
  }
}

export function validateOptimizationLane(): void {
  const scenariosRoot = fromRepoRoot("optimization", "scenarios");
  if (!fs.existsSync(scenariosRoot)) fail("validate-evals", `${scenariosRoot} does not exist`);

  const seen = new Set<string>();
  const skillCounts: Record<string, number> = {};
  const runnerModeCountsBySkill: Record<string, Record<string, number>> = {};
  const scenarioHashes: Record<string, Record<string, string>> = {};
  const scenarioPaths = globAcrossDirs(scenariosRoot, "eval-", ".json");
  if (!scenarioPaths.length) fail("validate-evals", "no scenario manifests found");

  for (const scenarioPath of scenarioPaths) {
    const [skill, scenarioId, contentHash, runnerMode] = validateScenario(scenarioPath);
    const key = `${skill}\u0000${scenarioId}`;
    if (seen.has(key)) fail("validate-evals", `duplicate scenario id for ${skill}: ${scenarioId}`);
    seen.add(key);
    skillCounts[skill] = (skillCounts[skill] ?? 0) + 1;
    (runnerModeCountsBySkill[skill] ??= {})[runnerMode] = (runnerModeCountsBySkill[skill]?.[runnerMode] ?? 0) + 1;
    (scenarioHashes[skill] ??= {})[scenarioId] = contentHash;
  }

  validatePublicStatus(skillCounts, runnerModeCountsBySkill);
  validateBaselines(scenarioHashes);

  console.log(
    `[validate-evals] OK: ${scenarioPaths.length} scenarios across ${Object.keys(skillCounts).length} skills; ` +
      `baseline hashes match ${repoRelative(fromRepoRoot("optimization", "results", "baselines.json"))}`,
  );
}

export async function validateCommand(suite: string): Promise<number> {
  try {
    if (suite === "evaluation" || suite === "all") validateEvaluationLane();
    if (suite === "optimization" || suite === "all") validateOptimizationLane();
    return 0;
  } catch (exc) {
    if (exc instanceof ValidationFailure) return 1;
    throw exc;
  }
}
