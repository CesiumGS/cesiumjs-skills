import { describe, expect, it } from "vitest";
import type { BaselineCoverageDTO, SkillCoverageDTO } from "../types";
import { summarizeBaselineCoverage } from "./baselineCoverage";

function coverage(skills: SkillCoverageDTO[]): BaselineCoverageDTO {
  return {
    root: "optimization/runs",
    skills,
  };
}

describe("summarizeBaselineCoverage", () => {
  it("counts every selected skill when only one has renderable baseline cases", () => {
    const skills: SkillCoverageDTO[] = [
      { skill: "cesiumjs-imagery", cases: 2, screenshots: 2, covered: true },
      ...Array.from({ length: 7 }, (_, index) => ({
        skill: `cesiumjs-unready-${index}`,
        cases: 0,
        screenshots: 0,
        covered: false,
      })),
    ];

    const summary = summarizeBaselineCoverage(coverage(skills));

    expect(summary.selectedCount).toBe(8);
    expect(summary.coveredCount).toBe(1);
    expect(summary.missingScreenshots).toHaveLength(0);
    expect(summary.missingBaselineCases).toHaveLength(7);
    expect(summary.fullyCovered).toBe(false);
  });

  it("separates renderable screenshot gaps from missing generated cases", () => {
    const summary = summarizeBaselineCoverage(
      coverage([
        { skill: "cesiumjs-camera", cases: 3, screenshots: 1, covered: false },
        { skill: "cesiumjs-entities", cases: 0, screenshots: 0, covered: false },
      ]),
    );

    expect(summary.missingScreenshots.map((skill) => skill.skill)).toEqual(["cesiumjs-camera"]);
    expect(summary.missingBaselineCases.map((skill) => skill.skill)).toEqual(["cesiumjs-entities"]);
  });

  it("is fully covered only when every selected skill is ready", () => {
    const summary = summarizeBaselineCoverage(
      coverage([
        { skill: "cesiumjs-camera", cases: 2, screenshots: 2, covered: true },
        { skill: "cesiumjs-imagery", cases: 1, screenshots: 1, covered: true },
      ]),
    );

    expect(summary).toMatchObject({
      selectedCount: 2,
      coveredCount: 2,
      fullyCovered: true,
    });
  });
});
