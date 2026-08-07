/**
 * Decision engine for autonomous keep/reject/tie decisions over skill candidates.
 * Port of optimization/framework/decision/engine.py (five-rule cascade).
 */
import * as fs from "node:fs";
import { readJson } from "../lib/json.js";
import type { CheckResultEntry, JudgeResultEntry, ScenarioMetaEntry } from "./types.js";

export interface DecisionResult {
  /** KEEP means the candidate explicitly won and is eligible for staging.
   * TIE means retain the existing current best; the candidate must not stage. */
  decision: "KEEP" | "REJECT" | "TIE";
  rule_fired: string;
  counts: Record<string, number>;
  rationale: string;
  rebaseline_required: string[];
  /**
   * Environment deltas between the baseline and candidate evidence (browser,
   * GPU/WebGL renderer, codegen model, ...). Non-empty means observed
   * regressions may stem from causes outside the skill content's control.
   */
  environment_mismatch?: Record<string, { baseline: unknown; candidate: unknown }>;
}

/** Metadata keys that fingerprint the render/codegen environment. */
export const ENVIRONMENT_FINGERPRINT_KEYS = [
  "chromium_version",
  "playwright_version",
  "webgl_renderer",
  "model_id",
  "browser_viewport",
  "judge_protocol_version",
] as const;

/** Diff two evidence-bundle metadata records over the environment keys. */
export function environmentMismatch(
  baselineMeta: Record<string, any> | null,
  candidateMeta: Record<string, any> | null,
): Record<string, { baseline: unknown; candidate: unknown }> {
  const mismatch: Record<string, { baseline: unknown; candidate: unknown }> = {};
  if (!baselineMeta || !candidateMeta) return mismatch;
  for (const key of ENVIRONMENT_FINGERPRINT_KEYS) {
    const baseline = baselineMeta[key] ?? null;
    const candidate = candidateMeta[key] ?? null;
    if (JSON.stringify(baseline) !== JSON.stringify(candidate)) mismatch[key] = { baseline, candidate };
  }
  return mismatch;
}

export function loadBaselines(baselinesPath: string): Record<string, Record<string, string>> {
  if (!fs.existsSync(baselinesPath)) return {};
  const data = readJson(baselinesPath);
  return data.scenarios ?? {};
}

export function checkRebaselineRequired(
  scenarioId: string,
  skill: string,
  currentHash: string,
  baselines: Record<string, Record<string, string>>,
): boolean {
  if (!(skill in baselines)) return false;
  if (!(scenarioId in baselines[skill])) return false;
  return baselines[skill][scenarioId] !== currentHash;
}

/**
 * Five-rule cascade with rebaseline/environment-invalid exclusions:
 * 1) deterministic check failures -> REJECT, 2) critical judge losses ->
 * REJECT, 3) more wins -> KEEP, 4) more losses -> REJECT,
 * 5) tie -> TIE (retain current best).
 *
 * Check and judge results are joined by scenario_id; mismatched or duplicate
 * ids fail loudly rather than being silently misattributed or truncated.
 */
export function decide(
  checkResults: CheckResultEntry[],
  judgeResults: JudgeResultEntry[],
  scenarioMeta: ScenarioMetaEntry[],
  baselines: Record<string, Record<string, string>>,
): DecisionResult {
  const rebaselineRequired: string[] = [];
  const scenarioIndex = new Map<string, ScenarioMetaEntry>(scenarioMeta.map((s) => [s.scenario_id, s]));

  for (const [scenarioId, meta] of scenarioIndex) {
    const skill = meta.skill ?? "";
    const currentHash = meta.current_hash ?? "";
    if (checkRebaselineRequired(scenarioId, skill, currentHash, baselines)) {
      rebaselineRequired.push(scenarioId);
    }
  }

  // Join check and judge results by scenario_id — never by array position.
  const indexById = <T extends { scenario_id: string }>(rows: T[], label: string): Map<string, T> => {
    const byId = new Map<string, T>();
    for (const row of rows) {
      const scenarioId = row.scenario_id;
      if (typeof scenarioId !== "string" || !scenarioId) {
        throw new Error(`${label} entry is missing a scenario_id: ${JSON.stringify(row).slice(0, 200)}`);
      }
      if (byId.has(scenarioId)) throw new Error(`${label} contains duplicate scenario_id '${scenarioId}'`);
      byId.set(scenarioId, row);
    }
    return byId;
  };
  const judgeById = indexById(judgeResults, "judge results");
  const checkById = indexById(checkResults, "check results");
  const missingJudge = [...checkById.keys()].filter((id) => !judgeById.has(id));
  const missingCheck = [...judgeById.keys()].filter((id) => !checkById.has(id));
  if (missingJudge.length || missingCheck.length) {
    const parts: string[] = [];
    if (missingJudge.length) parts.push(`no judge verdict for: ${missingJudge.sort().join(", ")}`);
    if (missingCheck.length) parts.push(`no check results for: ${missingCheck.sort().join(", ")}`);
    throw new Error(`check/judge results are misaligned — ${parts.join("; ")}`);
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let criticalFailures = 0;
  let checkFailures = 0;

  for (const [scenarioId, checkResult] of checkById) {
    const judgeResult = judgeById.get(scenarioId)!;

    if (rebaselineRequired.includes(scenarioId)) continue;

    // Environment-invalid trials (Ion auth failed mid-run) are excluded.
    const checks: Array<Record<string, any>> = checkResult.checks ?? [];
    if (checks.some((c) => c.type === "ion_auth_failure")) continue;

    const meta = scenarioIndex.get(scenarioId);
    const isCritical = Boolean(meta?.regression_critical ?? false);

    // Rule 1: deterministic check failures -> REJECT (excluding ion_auth_failure).
    const nonEnvChecks = checks.filter((c) => c.type !== "ion_auth_failure");
    const anyCheckFailed = nonEnvChecks.some((c) => c.result === "fail");
    if (anyCheckFailed) {
      checkFailures += 1;
      if (isCritical) criticalFailures += 1;
      return {
        decision: "REJECT",
        rule_fired: "rule_1_check_failure",
        counts: {
          wins,
          losses,
          ties,
          critical_failures: criticalFailures,
          check_failures: checkFailures,
        },
        rationale: `REJECT: Programmatic check failed on scenario ${scenarioId}`,
        rebaseline_required: rebaselineRequired,
      };
    }

    // Rule 2: critical judge losses -> REJECT.
    const verdict = judgeResult.verdict;
    const judgeUnavailable = Boolean(judgeResult.judge_unavailable ?? false);
    if (!judgeUnavailable) {
      if (isCritical && verdict === "BASELINE") {
        return {
          decision: "REJECT",
          rule_fired: "rule_2_critical_judge_loss",
          counts: {
            wins,
            losses: losses + 1,
            ties,
            critical_failures: criticalFailures,
            check_failures: checkFailures,
          },
          rationale: `REJECT: Judge loss on regression-critical scenario ${scenarioId}`,
          rebaseline_required: rebaselineRequired,
        };
      }
      if (verdict === "CANDIDATE") wins += 1;
      else if (verdict === "BASELINE") losses += 1;
      else if (verdict === "TIE") ties += 1;
    }
  }

  const counts = {
    wins,
    losses,
    ties,
    critical_failures: criticalFailures,
    check_failures: checkFailures,
  };

  if (wins > losses) {
    return {
      decision: "KEEP",
      rule_fired: "rule_3_more_wins",
      counts,
      rationale: `KEEP: Candidate won ${wins} scenarios vs ${losses} baseline wins`,
      rebaseline_required: rebaselineRequired,
    };
  }
  if (losses > wins) {
    return {
      decision: "REJECT",
      rule_fired: "rule_4_more_losses",
      counts,
      rationale: `REJECT: Baseline won ${losses} scenarios vs ${wins} candidate wins`,
      rebaseline_required: rebaselineRequired,
    };
  }
  return {
    decision: "TIE",
    rule_fired: "rule_5_tie_keep_current",
    counts,
    rationale: `TIE: Candidate did not beat current best (${wins} wins, ${losses} losses, ${ties} ties)`,
    rebaseline_required: rebaselineRequired,
  };
}
