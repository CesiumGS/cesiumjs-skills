/**
 * Decision engine for autonomous keep/reject of skill candidates.
 * Port of optimization/framework/decision/engine.py (five-rule cascade).
 */
import * as fs from "node:fs";
import { readJson } from "../lib/json.js";

export interface DecisionResult {
  decision: string;
  rule_fired: string;
  counts: Record<string, number>;
  rationale: string;
  rebaseline_required: string[];
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
 * REJECT, 3) more wins -> KEEP, 4) more losses -> REJECT, 5) tie -> KEEP.
 */
export function decide(
  checkResults: Array<Record<string, any>>,
  judgeResults: Array<Record<string, any>>,
  scenarioMeta: Array<Record<string, any>>,
  baselines: Record<string, Record<string, string>>,
): DecisionResult {
  const rebaselineRequired: string[] = [];
  const scenarioIndex = new Map<string, Record<string, any>>(scenarioMeta.map((s) => [s.scenario_id, s]));

  for (const [scenarioId, meta] of scenarioIndex) {
    const skill = meta.skill ?? "";
    const currentHash = meta.current_hash ?? "";
    if (checkRebaselineRequired(scenarioId, skill, currentHash, baselines)) {
      rebaselineRequired.push(scenarioId);
    }
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let criticalFailures = 0;
  let checkFailures = 0;

  const pairs = Math.min(checkResults.length, judgeResults.length);
  for (let i = 0; i < pairs; i++) {
    const checkResult = checkResults[i];
    const judgeResult = judgeResults[i];
    const scenarioId = checkResult.scenario_id;

    if (rebaselineRequired.includes(scenarioId)) continue;

    // Environment-invalid trials (Ion auth failed mid-run) are excluded.
    const checks: Array<Record<string, any>> = checkResult.checks ?? [];
    if (checks.some((c) => c.type === "ion_auth_failure")) continue;

    const meta = scenarioIndex.get(scenarioId) ?? {};
    const isCritical = Boolean(meta.regression_critical ?? false);

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
    decision: "KEEP",
    rule_fired: "rule_5_tie_keep_current",
    counts,
    rationale: `KEEP: Tie (${wins} wins, ${losses} losses, ${ties} ties) - keeping current best`,
    rebaseline_required: rebaselineRequired,
  };
}
