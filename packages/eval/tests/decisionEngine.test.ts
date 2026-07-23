import { describe, expect, it } from "vitest";
import { decide, environmentMismatch } from "../src/optimization/decisionEngine.js";

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

const judge = (scenarioId: string, verdict: string) => ({ scenario_id: scenarioId, verdict });

describe("decide", () => {
  it("rejects immediately on a deterministic failure", () => {
    const result = decide([checks("eval-001", "fail")], [judge("eval-001", "CANDIDATE")], [scenario("eval-001")], {});

    expect(result.decision).toBe("REJECT");
    expect(result.rule_fired).toBe("rule_1_check_failure");
  });

  it("keeps a candidate with more judge wins", () => {
    const result = decide(
      [checks("eval-001"), checks("eval-002")],
      [judge("eval-001", "CANDIDATE"), judge("eval-002", "TIE")],
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
      [judge("eval-001", "BASELINE")],
      [scenario("eval-001", true)],
      { "cesiumjs-camera": { "eval-001": "old" } },
    );

    expect(result.decision).toBe("KEEP");
    expect(result.rule_fired).toBe("rule_5_tie_keep_current");
    expect(result.rebaseline_required).toEqual(["eval-001"]);
  });

  it("joins check and judge results by scenario_id, not array position", () => {
    // Judge results deliberately out of order relative to check results: the
    // critical loss on eval-002 must be attributed to eval-002, not eval-001.
    const result = decide(
      [checks("eval-001"), checks("eval-002")],
      [judge("eval-002", "BASELINE"), judge("eval-001", "CANDIDATE")],
      [scenario("eval-001", false), scenario("eval-002", true)],
      {},
    );

    expect(result.decision).toBe("REJECT");
    expect(result.rule_fired).toBe("rule_2_critical_judge_loss");
    expect(result.rationale).toContain("eval-002");
  });

  it("fails loudly when check and judge results are misaligned", () => {
    expect(() =>
      decide(
        [checks("eval-001"), checks("eval-003")],
        [judge("eval-001", "TIE"), judge("eval-002", "TIE")],
        [scenario("eval-001")],
        {},
      ),
    ).toThrow(/misaligned.*no judge verdict for: eval-003.*no check results for: eval-002/s);
  });

  it("fails loudly on duplicate scenario ids", () => {
    expect(() =>
      decide([checks("eval-001"), checks("eval-001")], [judge("eval-001", "TIE")], [scenario("eval-001")], {}),
    ).toThrow(/duplicate scenario_id 'eval-001'/);
  });

  it("fails loudly when a result row is missing scenario_id", () => {
    expect(() => decide([checks("eval-001")], [{ verdict: "TIE" }], [scenario("eval-001")], {})).toThrow(
      /missing a scenario_id/,
    );
  });
});

describe("environmentMismatch", () => {
  it("reports environment keys that drifted between baseline and candidate", () => {
    const mismatch = environmentMismatch(
      { chromium_version: "120.0", webgl_renderer: "Apple M2", model_id: "m1", browser_viewport: { width: 1280, height: 720 } },
      { chromium_version: "126.0", webgl_renderer: "Apple M2", model_id: "m2", browser_viewport: { width: 1280, height: 720 } },
    );
    expect(Object.keys(mismatch).sort()).toEqual(["chromium_version", "model_id"]);
    expect(mismatch.chromium_version).toEqual({ baseline: "120.0", candidate: "126.0" });
  });

  it("is empty when either side lacks metadata or environments match", () => {
    expect(environmentMismatch(null, { chromium_version: "126.0" })).toEqual({});
    expect(environmentMismatch({ chromium_version: "126.0" }, { chromium_version: "126.0" })).toEqual({});
  });
});