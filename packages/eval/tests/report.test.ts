import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updatePublicStatus } from "../src/optimization/report.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("updatePublicStatus", () => {
  it("records a tie without making the tied candidate the current best", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-report-test-"));
    tempRoots.push(root);
    const target = path.join(root, "public-status.json");
    fs.writeFileSync(
      target,
      JSON.stringify({
        schema_version: "1.0",
        summary_type: "public-sanitized-eval-status",
        skills: [
          {
            skill: "cesiumjs-camera",
            scenario_count: 1,
            current_best: { iteration: "003", wins: 2, losses: 0, ties: 0 },
            latest_reviewed_decision: {},
            runner_mode_counts: {},
          },
        ],
      }),
    );

    updatePublicStatus(
      "cesiumjs-camera",
      "004",
      {
        decision: "TIE",
        counts: { wins: 1, losses: 1, ties: 2 },
        rationale: "TIE: Candidate did not beat current best",
      },
      { programmatic_correctness: 1, api_accuracy: 1, visual_win_rate: 0.25, coverage_delta: 0 },
      [{ runner_mode: "global-js" }],
      target,
    );

    const result = JSON.parse(fs.readFileSync(target, "utf8"));
    const skill = result.skills[0];
    expect(skill.latest_reviewed_decision).toMatchObject({ iteration: "004", status: "tie" });
    expect(skill.current_best).toMatchObject({ iteration: "003", wins: 2, losses: 0, ties: 0 });
  });
});
