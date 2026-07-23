/** Matcher registry: a matcher is a pure `(spec, evidence) -> CheckResult`. */
import { CheckResult, CheckTypeError, makeCheckResult } from "./types.js";

export type Matcher = (spec: Record<string, any>, evidence: Record<string, any>) => CheckResult;

const REGISTRY = new Map<string, Matcher>();

export function register(typeName: string, fn: Matcher): void {
  if (REGISTRY.has(typeName)) {
    throw new Error(`duplicate matcher registration: ${typeName}`);
  }
  REGISTRY.set(typeName, fn);
}

export function dispatch(spec: Record<string, any>, evidence: Record<string, any>): CheckResult {
  const type = spec?.type;
  if (!type) throw new CheckTypeError("check is missing 'type'");
  const fn = REGISTRY.get(type);
  if (!fn) {
    return makeCheckResult({
      check_id: spec.id ?? "?",
      type,
      result: "fail",
      detail: `no matcher registered for type '${type}'`,
    });
  }
  return fn(spec, evidence);
}

export function registeredTypes(): string[] {
  return [...REGISTRY.keys()].sort();
}
