import { describe, expect, it } from "vitest";
import { confirmedHumanFlagKeys } from "../src/commands/serve.js";

describe("confirmedHumanFlagKeys", () => {
  it("accepts only human-authored flags from the focused run", () => {
    const result = confirmedHumanFlagKeys(
      {
        run_id: "run-1",
        decisions: {
          "camera/confirmed": {
            skill: "cesiumjs-camera",
            case_id: "eval-001",
            decision: "flag",
            source: "human",
          },
          "camera/suggested": {
            skill: "cesiumjs-camera",
            case_id: "eval-002",
            decision: "flag",
            source: "auto",
          },
          "camera/accepted": {
            skill: "cesiumjs-camera",
            case_id: "eval-003",
            decision: "accept",
            source: "human",
          },
        },
      },
      "run-1",
    );

    expect([...result]).toEqual(["cesiumjs-camera/eval-001"]);
  });

  it("rejects decisions persisted for another run", () => {
    expect(
      confirmedHumanFlagKeys(
        {
          run_id: "old-run",
          decisions: {
            flagged: { skill: "cesiumjs-camera", case_id: "eval-001", decision: "flag", source: "human" },
          },
        },
        "current-run",
      ).size,
    ).toBe(0);
  });
});
