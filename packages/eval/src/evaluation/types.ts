/** Result types shared across the evaluation framework (pure data, no I/O). */

export interface CheckResult {
  check_id: string;
  type: string;
  result: "pass" | "fail";
  category: string;
  critical: boolean;
  weight: number;
  tolerance: unknown;
  actual: unknown;
  expected: unknown;
  detail: string;
  metadata: Record<string, unknown>;
}

export function makeCheckResult(partial: Partial<CheckResult> & Pick<CheckResult, "check_id" | "type" | "result">): CheckResult {
  return {
    category: "uncategorized",
    critical: false,
    weight: 1.0,
    tolerance: null,
    actual: null,
    expected: null,
    detail: "",
    metadata: {},
    ...partial,
  };
}

export function checkPassed(check: CheckResult): boolean {
  return check.result === "pass";
}

export interface CaseResult {
  case_id: string;
  case_name: string;
  skill: string;
  result: "pass" | "fail";
  duration_ms: number;
  error: string | null;
  checks: CheckResult[];
}

/** Raised when a check JSON is malformed for its declared type. */
export class CheckTypeError extends Error {}
