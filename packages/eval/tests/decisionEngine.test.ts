import { describe, expect, it } from "vitest";
import { decide } from "../src/optimization/decisionEngine.js";

const scenario = (scenarioId: string, critical = false) => ({
  scenario_id: scenarioId,
  skill: "cesiumjs-camera",
  current_hash: "current",
  regression_critical: critical,
});

const checks = (scenarioId: string, result = "pass") => ({
  scenario_id: scenarioId,
  checks: [{ type: "camera", result }],
});

describe("decide", () => {
  it("rejects immediately on a deterministic failure", () => {
    const result = decide([checks("eval-001", "fail")], [{ verdict: "CANDIDATE" }], [scenario("eval-001")], {});

    expect(result.decision).toBe("REJECT");
    expect(result.rule_fired).toBe("rule_1_check_failure");
  });

  it("keeps a candidate with more judge wins", () => {
    const result = decide(
      [checks("eval-001"), checks("eval-002")],
      [{ verdict: "CANDIDATE" }, { verdict: "TIE" }],
      [scenario("eval-001"), scenario("eval-002")],
      {},
    );

    expect(result.decision).toBe("KEEP");
    expect(result.rule_fired).toBe("rule_3_more_wins");
    expect(result.counts).toMatchObject({ wins: 1, losses: 0, ties: 1 });
  });

  it("excludes scenarios whose baseline hash is stale", () => {
    const result = decide(
      [checks("eval-001")],
      [{ verdict: "BASELINE" }],
      [scenario("eval-001", true)],
      { "cesiumjs-camera": { "eval-001": "old" } },
    );

    expect(result.decision).toBe("KEEP");
    expect(result.rule_fired).toBe("rule_5_tie_keep_current");
    expect(result.rebaseline_required).toEqual(["eval-001"]);
  });
});