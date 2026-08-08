import { describe, expect, it } from "vitest";
import type { SkillOverview } from "../types";
import { buildOptimizationQueue } from "./optimizationQueue";

function history(skill: string, iterationCount = 1): SkillOverview {
  return {
    skill,
    iteration_count: iterationCount,
    kept: 0,
    rejected: 0,
    latest: null,
    running: false,
    history: [],
    skill_md: { exists: true },
  };
}

describe("buildOptimizationQueue", () => {
  it("shows handed-off skills before they have optimization artifacts", () => {
    const queue = buildOptimizationQueue([], [
      "cesiumjs-camera/case-1",
      "cesiumjs-camera/case-2",
      "cesiumjs-imagery/case-1",
    ]);

    expect(queue).toEqual([
      {
        skill: "cesiumjs-camera",
        queuedCaseKeys: ["cesiumjs-camera/case-1", "cesiumjs-camera/case-2"],
        history: null,
      },
      {
        skill: "cesiumjs-imagery",
        queuedCaseKeys: ["cesiumjs-imagery/case-1"],
        history: null,
      },
    ]);
  });

  it("merges a handoff with existing history without duplicating skills", () => {
    const camera = history("cesiumjs-camera", 3);
    const entities = history("cesiumjs-entities", 2);
    const queue = buildOptimizationQueue(
      [camera, entities],
      ["cesiumjs-imagery/case-1", "cesiumjs-camera/case-2"],
    );

    expect(queue.map((item) => item.skill)).toEqual([
      "cesiumjs-camera",
      "cesiumjs-imagery",
      "cesiumjs-entities",
    ]);
    expect(queue[0].history).toBe(camera);
    expect(queue[1].history).toBeNull();
    expect(queue[2].history).toBe(entities);
  });

  it("deduplicates exact case keys and ignores malformed keys", () => {
    const queue = buildOptimizationQueue([], [
      "cesiumjs-camera/case-1",
      "cesiumjs-camera/case-1",
      "missing-separator",
      "/missing-skill",
    ]);

    expect(queue).toHaveLength(1);
    expect(queue[0].queuedCaseKeys).toEqual(["cesiumjs-camera/case-1"]);
  });
});
