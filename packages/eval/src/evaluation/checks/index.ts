/**
 * Built-in deterministic matchers. Importing this module registers every
 * matcher; `runDeterministicChecks` is the public entry point.
 */
import { register, dispatch } from "../registry.js";
import { CheckResult, CheckTypeError, makeCheckResult } from "../types.js";
import { entityForSnapshot, missingSnapshots, snapshotNames } from "../evidence.js";
import { angleDegrees, cartographicLonLat, dot, enuBasis, norm, normalize, vector3, Vec3 } from "../geometry.js";

/** Compact human-readable number for check detail strings. */
function num(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

const quote = (text: unknown): string => `'${String(text)}'`;

// --------------------------------------------------------------------------
// entity_exists
// --------------------------------------------------------------------------
register("entity_exists", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "?";
  const entityId = spec.entity_id;
  if (typeof entityId !== "string" || !entityId) {
    throw new CheckTypeError("entity_exists: missing 'entity_id'");
  }
  let snapshots: string[];
  try {
    snapshots = snapshotNames(spec);
  } catch (exc: any) {
    throw new CheckTypeError(`entity_exists: ${exc.message}`);
  }
  const missing = missingSnapshots(evidence, entityId, snapshots);
  const passed = missing.length === 0;
  return makeCheckResult({
    check_id: cid,
    type: "entity_exists",
    result: passed ? "pass" : "fail",
    actual: {
      entity_id: entityId,
      present_snapshots: snapshots.filter((snapshot) => !missing.includes(snapshot)),
      missing_snapshots: missing,
    },
    expected: { entity_id: entityId, snapshots },
    detail: passed
      ? `entity '${entityId}' exists in ${snapshots.join(", ")}`
      : `entity '${entityId}' missing from ${missing.join(", ")}`,
  });
});

// --------------------------------------------------------------------------
// entity_translation_delta
// --------------------------------------------------------------------------
const VALID_ENU_AXES = new Set(["east", "north", "up"]);
const VALID_ECEF_AXES: Record<string, number> = { x: 0, y: 1, z: 2 };
const VALID_FRAMES = new Set(["enu", "ecef"]);
const VALID_OPS = ["==", "!=", "<", "<=", ">", ">="] as const;
const DEFAULT_TOLERANCE_METERS = 0.01;

function applyOp(actual: number, op: string, expected: number, tol: number): boolean {
  switch (op) {
    case "==":
      return Math.abs(actual - expected) <= tol;
    case "!=":
      return Math.abs(actual - expected) > tol;
    case "<":
      return actual < expected - tol;
    case "<=":
      return actual <= expected + tol;
    case ">":
      return actual > expected + tol;
    case ">=":
      return actual >= expected - tol;
    default:
      throw new CheckTypeError(`unsupported operator: ${op}`);
  }
}

register("entity_translation_delta", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "?";
  const entityId = spec.entity_id;
  const axis = spec.axis;
  const frame = spec.frame ?? "enu";
  const op = spec.operator;
  const expectedRaw = spec.value_meters;
  const tol = Number(spec.tolerance_meters ?? DEFAULT_TOLERANCE_METERS);

  if (entityId === undefined || entityId === null) {
    throw new CheckTypeError("entity_translation_delta: missing 'entity_id'");
  }
  if (!VALID_FRAMES.has(frame)) {
    throw new CheckTypeError(
      `entity_translation_delta: 'frame' must be one of ${JSON.stringify([...VALID_FRAMES].sort())}; got ${quote(frame)}`,
    );
  }
  if (frame === "enu" && !VALID_ENU_AXES.has(axis)) {
    throw new CheckTypeError(
      `entity_translation_delta: 'axis' must be one of ${JSON.stringify([...VALID_ENU_AXES].sort())}; got ${quote(axis)}`,
    );
  }
  if (frame === "ecef" && !(axis in VALID_ECEF_AXES)) {
    throw new CheckTypeError(
      `entity_translation_delta: 'axis' must be one of ${JSON.stringify(Object.keys(VALID_ECEF_AXES).sort())}; got ${quote(axis)}`,
    );
  }
  if (!VALID_OPS.includes(op)) {
    throw new CheckTypeError(`entity_translation_delta: 'operator' must be one of ${JSON.stringify(VALID_OPS)}; got ${quote(op)}`);
  }
  if (expectedRaw === undefined || expectedRaw === null) {
    throw new CheckTypeError("entity_translation_delta: missing 'value_meters'");
  }
  const expected = Number(expectedRaw);

  const beforeEntities = (evidence?.before ?? {}).entities ?? {};
  const afterEntities = (evidence?.after ?? {}).entities ?? {};
  const beforeRecord = beforeEntities[entityId];
  const afterRecord = afterEntities[entityId];
  if (beforeRecord === undefined || afterRecord === undefined) {
    const missing = beforeRecord === undefined ? "before" : "after";
    return makeCheckResult({
      check_id: cid,
      type: "entity_translation_delta",
      result: "fail",
      actual: null,
      expected,
      detail: `entity '${entityId}' not found in ${missing} evidence`,
    });
  }

  let before: Vec3;
  let after: Vec3;
  let lonLat: [number, number] | null = null;
  try {
    before = vector3(beforeRecord.position_ecef, "before.position_ecef");
    after = vector3(afterRecord.position_ecef, "after.position_ecef");
    lonLat = frame === "enu" ? cartographicLonLat(beforeRecord) : null;
  } catch (exc: any) {
    return makeCheckResult({
      check_id: cid,
      type: "entity_translation_delta",
      result: "fail",
      detail: `malformed evidence for entity '${entityId}': ${exc.message}`,
    });
  }

  const delta: Vec3 = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  let actual: number;
  if (frame === "enu") {
    const [lon, lat] = lonLat!;
    actual = dot(delta, enuBasis(lon, lat)[axis as "east" | "north" | "up"]);
  } else {
    actual = delta[VALID_ECEF_AXES[axis]];
  }
  const ok = applyOp(actual, op, expected, tol);
  let detail = `entity '${entityId}' frame=${frame} axis=${axis} delta=${num(actual)} m ${op} expected ${num(expected)}`;
  if (tol) detail += ` (tolerance +/-${num(tol)} m)`;
  return makeCheckResult({
    check_id: cid,
    type: "entity_translation_delta",
    result: ok ? "pass" : "fail",
    actual,
    expected,
    detail,
    metadata: { axis, frame, tolerance_meters: tol },
  });
});

// --------------------------------------------------------------------------
// camera_target_view
// --------------------------------------------------------------------------
register("camera_target_view", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "camera_target_view";
  const targetEntityId = spec.target_entity_id;
  if (typeof targetEntityId !== "string" || !targetEntityId) {
    throw new CheckTypeError("camera_target_view: missing 'target_entity_id'");
  }
  const snapshot = spec.snapshot ?? "after";
  const maxViewAngle = Number(spec.max_view_angle_degrees ?? 10.0);
  const minDistance = Number(spec.min_distance_meters ?? 0.0);
  const maxDistance = Number(spec.max_distance_meters ?? 1.0e15);
  const maxUpAlignment = Number(spec.max_up_alignment ?? 0.85);

  const section = (evidence ?? {})[snapshot] ?? {};
  const camera = section.camera;
  const target = entityForSnapshot(evidence, snapshot, targetEntityId);
  if (camera === null || typeof camera !== "object" || Array.isArray(camera)) {
    return makeCheckResult({
      check_id: cid,
      type: "camera_target_view",
      result: "fail",
      detail: `missing ${snapshot}.camera evidence`,
    });
  }
  if (target === null) {
    return makeCheckResult({
      check_id: cid,
      type: "camera_target_view",
      result: "fail",
      detail: `target entity '${targetEntityId}' missing from ${snapshot} evidence`,
    });
  }

  let cameraPosition: Vec3;
  let cameraDirection: Vec3;
  let targetPosition: Vec3;
  let lon: number;
  let lat: number;
  try {
    cameraPosition = vector3(camera.position_ecef, "camera.position_ecef");
    cameraDirection = normalize(vector3(camera.direction_ecef, "camera.direction_ecef"), "camera.direction_ecef");
    targetPosition = vector3(target.position_ecef, "target.position_ecef");
    [lon, lat] = cartographicLonLat(target);
  } catch (exc: any) {
    return makeCheckResult({
      check_id: cid,
      type: "camera_target_view",
      result: "fail",
      detail: `malformed camera target evidence: ${exc.message}`,
    });
  }

  const toTarget: Vec3 = [
    targetPosition[0] - cameraPosition[0],
    targetPosition[1] - cameraPosition[1],
    targetPosition[2] - cameraPosition[2],
  ];
  const distance = norm(toTarget);
  const viewAngle = angleDegrees(cameraDirection, toTarget);
  const up = enuBasis(lon, lat).up;
  const targetToCamera: Vec3 = [
    cameraPosition[0] - targetPosition[0],
    cameraPosition[1] - targetPosition[1],
    cameraPosition[2] - targetPosition[2],
  ];
  const upAlignment = dot(normalize(targetToCamera, "target_to_camera"), up);

  const passed =
    minDistance <= distance && distance <= maxDistance && viewAngle <= maxViewAngle && upAlignment <= maxUpAlignment;
  return makeCheckResult({
    check_id: cid,
    type: "camera_target_view",
    result: passed ? "pass" : "fail",
    actual: {
      distance_meters: distance,
      view_angle_degrees: viewAngle,
      up_alignment: upAlignment,
    },
    expected: {
      min_distance_meters: minDistance,
      max_distance_meters: maxDistance,
      max_view_angle_degrees: maxViewAngle,
      max_up_alignment: maxUpAlignment,
    },
    detail: `distance=${num(distance)}m view_angle=${num(viewAngle)}deg up_alignment=${num(upAlignment)}`,
    metadata: { target_entity_id: targetEntityId, snapshot },
  });
});

// --------------------------------------------------------------------------
// no_runtime_errors / code_runs
// --------------------------------------------------------------------------
register("no_runtime_errors", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "no_runtime_errors";
  let errors = evidence.errors ?? [];
  if (!Array.isArray(errors)) errors = [errors];
  const passed = errors.length === 0;
  return makeCheckResult({
    check_id: cid,
    type: "no_runtime_errors",
    result: passed ? "pass" : "fail",
    actual: errors,
    expected: [],
    detail: passed ? "no runtime errors captured" : `${errors.length} runtime error(s) captured`,
  });
});

register("code_runs", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "code_runs";
  const execution = evidence.execution ?? {};
  const actual = Boolean(execution.success ?? false);
  return makeCheckResult({
    check_id: cid,
    type: "code_runs",
    result: actual ? "pass" : "fail",
    actual,
    expected: true,
    detail: actual
      ? "generated code completed successfully in the observed browser run"
      : "generated code did not complete successfully in the observed browser run",
    metadata: { observed_from: execution.observed_from ?? null },
  });
});

// --------------------------------------------------------------------------
// pattern_present / pattern_absent
// --------------------------------------------------------------------------
function sourceText(evidence: Record<string, any>): string {
  const source = evidence.generated_code ?? "";
  if (typeof source !== "string") {
    throw new CheckTypeError("pattern check: evidence.generated_code must be a string");
  }
  return source;
}

function patternOf(spec: Record<string, any>): string {
  const pattern = spec.pattern;
  if (typeof pattern !== "string" || !pattern) {
    throw new CheckTypeError("pattern check: missing non-empty 'pattern'");
  }
  return pattern;
}

function checkPattern(
  spec: Record<string, any>,
  evidence: Record<string, any>,
  shouldMatch: boolean,
  typeName: string,
): CheckResult {
  const cid = spec.id ?? typeName;
  const pattern = patternOf(spec);
  const source = sourceText(evidence);
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(pattern, "m").exec(source);
  } catch (exc: any) {
    return makeCheckResult({
      check_id: cid,
      type: typeName,
      result: "fail",
      actual: { regex_valid: false, matched: false },
      expected: { regex_valid: true, matched: shouldMatch, pattern },
      detail: `invalid regex pattern: ${exc.message}`,
    });
  }
  const matched = match !== null;
  const passed = matched === shouldMatch;
  return makeCheckResult({
    check_id: cid,
    type: typeName,
    result: passed ? "pass" : "fail",
    actual: { matched, match: match ? match[0] : null },
    expected: { matched: shouldMatch, pattern },
    detail: passed
      ? `pattern ${matched ? "matched" : "not found"}: ${quote(pattern)}`
      : `expected pattern ${shouldMatch ? "presence" : "absence"} but got ${matched ? "match" : "no match"}: ${quote(pattern)}`,
    metadata: { source_path: evidence.source_path ?? null },
  });
}

register("pattern_present", (spec, evidence) => checkPattern(spec, evidence, true, "pattern_present"));
register("pattern_absent", (spec, evidence) => checkPattern(spec, evidence, false, "pattern_absent"));

// --------------------------------------------------------------------------
// json_value_equals / json_value_compare / collection_count
// --------------------------------------------------------------------------
function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) {
    throw new CheckTypeError("json_value_equals: 'path' must be a JSON Pointer");
  }
  let current: any = document;
  for (const rawPart of pointer.split("/").slice(1)) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current !== null && typeof current === "object" && !Array.isArray(current)) {
      if (!(part in current)) throw new Error(quote(part));
      current = current[part];
    } else if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) throw new Error(`invalid list index ${quote(part)}`);
      if (index < 0 || index >= current.length) throw new Error("list index out of range");
      current = current[index];
    } else {
      throw new Error(quote(part));
    }
  }
  return current;
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEquals(item, b[index]));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => key in (b as object) && deepEquals((a as any)[key], (b as any)[key]));
  }
  return false;
}

register("json_value_equals", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "json_value_equals";
  const path = spec.path;
  if (typeof path !== "string") throw new CheckTypeError("json_value_equals: missing 'path'");
  if (!("expected" in spec)) throw new CheckTypeError("json_value_equals: missing 'expected'");
  const expected = spec.expected;
  let actual: unknown;
  try {
    actual = resolveJsonPointer(evidence, path);
  } catch (exc: any) {
    if (exc instanceof CheckTypeError) throw exc;
    return makeCheckResult({
      check_id: cid,
      type: "json_value_equals",
      result: "fail",
      actual: null,
      expected,
      detail: `path ${quote(path)} not found: ${exc.message}`,
    });
  }
  const passed = deepEquals(actual, expected);
  return makeCheckResult({
    check_id: cid,
    type: "json_value_equals",
    result: passed ? "pass" : "fail",
    actual,
    expected,
    detail: passed ? `value at ${path} equals expected` : `value at ${path} differs`,
  });
});

function compareValues(actual: unknown, operator: string, expected: unknown, tolerance: number | null = null): boolean {
  if (operator === "==") {
    if (tolerance !== null && typeof actual === "number" && typeof expected === "number") {
      return Math.abs(actual - expected) <= tolerance;
    }
    return deepEquals(actual, expected);
  }
  if (operator === "!=") {
    if (tolerance !== null && typeof actual === "number" && typeof expected === "number") {
      return Math.abs(actual - expected) > tolerance;
    }
    return !deepEquals(actual, expected);
  }
  if (typeof actual !== "number" || typeof expected !== "number") {
    throw new CheckTypeError(`json_value_compare: operator ${quote(operator)} requires numeric values`);
  }
  switch (operator) {
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    default:
      throw new CheckTypeError(`json_value_compare: unsupported operator ${quote(operator)}`);
  }
}

register("json_value_compare", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "json_value_compare";
  const path = spec.path;
  if (typeof path !== "string") throw new CheckTypeError("json_value_compare: missing 'path'");
  const operator = spec.operator ?? "==";
  if (!["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
    throw new CheckTypeError("json_value_compare: invalid 'operator'");
  }
  if (!("expected" in spec)) throw new CheckTypeError("json_value_compare: missing 'expected'");
  const expected = spec.expected;
  const tolerance = spec.tolerance ?? null;
  const toleranceValue = tolerance !== null ? Number(tolerance) : null;
  let actual: unknown = null;
  let passed: boolean;
  try {
    actual = resolveJsonPointer(evidence, path);
    passed = compareValues(actual, operator, expected, toleranceValue);
  } catch (exc: any) {
    if (exc instanceof CheckTypeError && !exc.message.startsWith("json_value_compare: operator")) throw exc;
    return makeCheckResult({
      check_id: cid,
      type: "json_value_compare",
      result: "fail",
      actual: null,
      expected: { operator, value: expected },
      tolerance: toleranceValue,
      detail: `path ${quote(path)} not found or not comparable: ${exc.message}`,
    });
  }
  return makeCheckResult({
    check_id: cid,
    type: "json_value_compare",
    result: passed ? "pass" : "fail",
    actual,
    expected: { operator, value: expected },
    tolerance: toleranceValue,
    detail: passed
      ? `value at ${path} satisfies ${operator} ${JSON.stringify(expected)}`
      : `value at ${path} does not satisfy ${operator} ${JSON.stringify(expected)}`,
  });
});

register("collection_count", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "collection_count";
  const path = spec.path;
  if (typeof path !== "string") throw new CheckTypeError("collection_count: missing 'path'");
  const operator = spec.operator ?? "==";
  if (!["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
    throw new CheckTypeError("collection_count: invalid 'operator'");
  }
  if (!("count" in spec)) throw new CheckTypeError("collection_count: missing 'count'");
  const expected = Math.trunc(Number(spec.count));
  let actual: number;
  let passed: boolean;
  try {
    const value = resolveJsonPointer(evidence, path);
    if (typeof value === "string" || Array.isArray(value)) {
      actual = value.length;
    } else if (value !== null && typeof value === "object") {
      actual = Object.keys(value).length;
    } else {
      throw new Error(`value at ${quote(path)} has no count`);
    }
    passed = compareValues(actual, operator, expected);
  } catch (exc: any) {
    if (exc instanceof CheckTypeError) throw exc;
    return makeCheckResult({
      check_id: cid,
      type: "collection_count",
      result: "fail",
      actual: null,
      expected: { operator, count: expected },
      detail: `path ${quote(path)} not found or not countable: ${exc.message}`,
    });
  }
  return makeCheckResult({
    check_id: cid,
    type: "collection_count",
    result: passed ? "pass" : "fail",
    actual,
    expected: { operator, count: expected },
    detail: passed
      ? `count at ${path} satisfies ${operator} ${expected}`
      : `count at ${path} does not satisfy ${operator} ${expected}`,
  });
});

// --------------------------------------------------------------------------
// artifact_text_absent
// --------------------------------------------------------------------------
export const DEFAULT_PUBLIC_SAFETY_PATTERNS = [
  String.raw`/Users/[^\s'"<>]+`,
  "file://",
  String.raw`https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])`,
  String.raw`CESIUM_ION_TOKEN\s*=`,
  "eyJ[A-Za-z0-9_-]{20,}",
  "sk-[A-Za-z0-9_-]{20,}",
];

function walkStrings(value: unknown, prefix = ""): Array<[string, string]> {
  if (typeof value === "string") return [[prefix || "<root>", value]];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const out: Array<[string, string]> = [];
    for (const [key, item] of Object.entries(value)) {
      const childPrefix = prefix ? `${prefix}/${key}` : `/${key}`;
      out.push(...walkStrings(item, childPrefix));
    }
    return out;
  }
  if (Array.isArray(value)) {
    const out: Array<[string, string]> = [];
    value.forEach((item, index) => {
      const childPrefix = prefix ? `${prefix}/${index}` : `/${index}`;
      out.push(...walkStrings(item, childPrefix));
    });
    return out;
  }
  return [];
}

register("artifact_text_absent", (spec, evidence): CheckResult => {
  const cid = spec.id ?? "artifact_text_absent";
  let patterns = spec.patterns ?? DEFAULT_PUBLIC_SAFETY_PATTERNS;
  if (!Array.isArray(patterns) || !patterns.every((pattern: unknown) => typeof pattern === "string")) {
    throw new CheckTypeError("artifact_text_absent: 'patterns' must be a list of regex strings");
  }
  const extraPatterns = spec.extra_patterns ?? [];
  if (!Array.isArray(extraPatterns) || !extraPatterns.every((pattern: unknown) => typeof pattern === "string")) {
    throw new CheckTypeError("artifact_text_absent: 'extra_patterns' must be a list of regex strings");
  }
  patterns = [...patterns, ...extraPatterns];

  const fields = spec.fields;
  if (fields !== undefined && fields !== null && (!Array.isArray(fields) || !fields.every((field: unknown) => typeof field === "string"))) {
    throw new CheckTypeError("artifact_text_absent: 'fields' must be a list of top-level field names");
  }

  let haystacks: Array<[string, string]> = [];
  if (fields && fields.length) {
    for (const field of fields) {
      haystacks.push(...walkStrings((evidence ?? {})[field], `/${field}`));
    }
  } else {
    haystacks = walkStrings(evidence);
  }

  for (const pattern of patterns) {
    const compiled = new RegExp(pattern);
    for (const [pathLabel, text] of haystacks) {
      const match = compiled.exec(text);
      if (match) {
        return makeCheckResult({
          check_id: cid,
          type: "artifact_text_absent",
          result: "fail",
          actual: { path: pathLabel, pattern, match: match[0] },
          expected: { patterns_absent: patterns },
          detail: `disallowed text matched pattern ${quote(pattern)} at ${pathLabel}`,
        });
      }
    }
  }

  return makeCheckResult({
    check_id: cid,
    type: "artifact_text_absent",
    result: "pass",
    actual: { scanned_strings: haystacks.length },
    expected: { patterns_absent: patterns },
    detail: `no disallowed text found in ${haystacks.length} string fields`,
  });
});

/** Run every check declared by `case` against `evidence`, in declaration order. */
export function runDeterministicChecks(caseDoc: Record<string, any>, evidence: Record<string, any>): CheckResult[] {
  const out: CheckResult[] = [];
  for (const spec of caseDoc.checks ?? []) {
    out.push(dispatch(spec, evidence));
  }
  return out;
}
