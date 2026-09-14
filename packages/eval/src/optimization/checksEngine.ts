/**
 * Deterministic check engine for CesiumJS skill evaluations (public eval lane).
 * Port of optimization/framework/checks/engine.py — byte-identical results on
 * the same evidence bundle.
 */

export interface EngineCheck {
  check_id: string;
  type: string;
  result: "pass" | "fail";
  detail: string;
  description: string;
  [key: string]: unknown;
}

export interface EngineResult {
  scenario_id: string;
  checks: EngineCheck[];
  [key: string]: unknown;
}

type CheckOutcome = ["pass" | "fail", string];

function checkCodeRuns(errors: unknown[]): CheckOutcome {
  if (errors.length === 0) return ["pass", "Code completed without captured errors"];
  return ["fail", `Runtime errors captured: ${errors.length} error(s)`];
}

function checkNoConsoleErrors(errors: unknown[]): CheckOutcome {
  if (errors.length === 0) return ["pass", "No console or page errors captured"];
  return ["fail", `Console/page errors found: ${errors.length} error(s)`];
}

function checkPatternPresent(code: string, pattern: string): CheckOutcome {
  if (!pattern) return ["fail", "No pattern specified"];
  try {
    const match = new RegExp(pattern, "mi").exec(code);
    if (match) return ["pass", `Pattern matched: '${match[0].slice(0, 50)}'`];
    return ["fail", `Pattern not found: '${pattern}'`];
  } catch (exc: any) {
    return ["fail", `Invalid regex pattern: ${exc.message}`];
  }
}

function checkPatternAbsent(code: string, pattern: string): CheckOutcome {
  if (!pattern) return ["fail", "No pattern specified"];
  try {
    const match = new RegExp(pattern, "mi").exec(code);
    if (match) return ["fail", `Unexpected pattern found: '${match[0].slice(0, 50)}'`];
    return ["pass", "Pattern not found (as expected)"];
  } catch (exc: any) {
    return ["fail", `Invalid regex pattern: ${exc.message}`];
  }
}

function validateType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return false;
  }
}

function checkSchemaMatch(sceneState: Record<string, any> | null, schema: Record<string, any>): CheckOutcome {
  if (!schema || !Object.keys(schema).length) return ["fail", "No schema specified"];
  if (sceneState === null || !sceneState.available) return ["fail", "Scene state not available"];

  for (const prop of schema.required ?? []) {
    if (!(prop in sceneState)) return ["fail", `Required property missing: '${prop}'`];
  }

  for (const [prop, propSchemaRaw] of Object.entries(schema.properties ?? {})) {
    if (!(prop in sceneState)) continue;
    const propSchema = propSchemaRaw as Record<string, any>;
    const value = sceneState[prop];
    const expectedType = propSchema.type;

    if (expectedType && !validateType(value, expectedType)) {
      return ["fail", `Property '${prop}' has wrong type (expected ${expectedType})`];
    }
    if (expectedType === "number" || expectedType === "integer") {
      const minimum = propSchema.minimum;
      const maximum = propSchema.maximum;
      if (minimum !== undefined && minimum !== null && value < minimum) {
        return ["fail", `Property '${prop}' below minimum: ${value} < ${minimum}`];
      }
      if (maximum !== undefined && maximum !== null && value > maximum) {
        return ["fail", `Property '${prop}' above maximum: ${value} > ${maximum}`];
      }
    }
    if (expectedType === "array") {
      const minItems = propSchema.minItems;
      const maxItems = propSchema.maxItems;
      if (minItems !== undefined && minItems !== null && value.length < minItems) {
        return ["fail", `Array '${prop}' has too few items: ${value.length} < ${minItems}`];
      }
      if (maxItems !== undefined && maxItems !== null && value.length > maxItems) {
        return ["fail", `Array '${prop}' has too many items: ${value.length} > ${maxItems}`];
      }
    }
  }
  return ["pass", "Scene state matches schema"];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkApiPresent(code: string, api: string): CheckOutcome {
  if (!api) return ["fail", "No API specified"];
  const apiName = api.split(".").pop() ?? api;
  const pattern = new RegExp(`\\b${escapeRegExp(apiName)}\\b`);
  if (pattern.test(code)) return ["pass", `API present: '${apiName}'`];
  return ["fail", `API not found: '${apiName}'`];
}

/** Run all programmatic checks for a scenario. */
export function runChecks(
  scenario: Record<string, any>,
  generatedCode: string,
  consoleData: Record<string, any>,
  sceneState: Record<string, any> | null = null,
): EngineResult {
  const scenarioId = scenario.id ?? "unknown";
  const checksResults: EngineCheck[] = [];
  const errors = consoleData.errors ?? [];

  (scenario.programmatic_checks ?? []).forEach((check: Record<string, any>, idx: number) => {
    const checkType = check.type;
    const description = check.description ?? "";
    const checkId = `${checkType}_${idx}`;

    let result: "pass" | "fail" = "fail";
    let detail = "";
    try {
      let outcome: CheckOutcome;
      switch (checkType) {
        case "code_runs":
          outcome = checkCodeRuns(errors);
          break;
        case "no_console_errors":
          outcome = checkNoConsoleErrors(errors);
          break;
        case "pattern_present":
          outcome = checkPatternPresent(generatedCode, check.pattern ?? "");
          break;
        case "pattern_absent":
          outcome = checkPatternAbsent(generatedCode, check.pattern ?? "");
          break;
        case "schema_match":
          outcome = checkSchemaMatch(sceneState, check.schema ?? {});
          break;
        case "api_present":
          outcome = checkApiPresent(generatedCode, check.api ?? "");
          break;
        default:
          outcome = ["fail", `Unsupported check type: ${checkType}`];
      }
      [result, detail] = outcome;
    } catch (exc: any) {
      result = "fail";
      detail = `Check execution error: ${exc.message}`;
    }

    checksResults.push({ check_id: checkId, type: checkType, result, detail, description });
  });

  return { scenario_id: scenarioId, checks: checksResults };
}
