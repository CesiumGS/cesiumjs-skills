import { describe, expect, it } from "vitest";
import type { BaselineCoverageDTO, SkillCoverageDTO } from "../types";
import { summarizeBaselineCoverage } from "./baselineCoverage";

function coverage(skills: SkillCoverageDTO[]): BaselineCoverageDTO {
  return {
    root: "evaluation/artifacts/baselines",
    skills,
  };
}

/** A skill row with the fields this summarizer reads; `auditable` (the
 *  deterministic-lane predicate) defaults to the rendered screenshot count. */
function skillRow(row: Omit<SkillCoverageDTO, "auditable"> & { auditable?: number }): SkillCoverageDTO {
  return { ...row, auditable: row.auditable ?? row.screenshots };
}

describe("summarizeBaselineCoverage", () => {
  it("counts every selected skill when only one has renderable baseline cases", () => {
    const skills: SkillCoverageDTO[] = [
      skillRow({ skill: "cesiumjs-imagery", cases: 2, generated: 2, screenshots: 2, covered: true }),
      ...Array.from({ length: 7 }, (_, index) =>
        skillRow({
          skill: `cesiumjs-unready-${index}`,
          cases: 2,
          generated: 0,
          screenshots: 0,
          covered: false,
        }),
      ),
    ];

    const summary = summarizeBaselineCoverage(coverage(skills));

    expect(summary.selectedCount).toBe(8);
    expect(summary.coveredCount).toBe(1);
    expect(summary.missingScreenshots).toHaveLength(0);
    expect(summary.missingBaselineCases).toHaveLength(7);
    expect(summary.needsPreparation).toHaveLength(7);
    expect(summary.fullyCovered).toBe(false);
  });

  it("separates renderable screenshot gaps from missing generated cases", () => {
    const summary = summarizeBaselineCoverage(
      coverage([
        skillRow({ skill: "cesiumjs-camera", cases: 3, generated: 3, screenshots: 1, covered: false }),
        skillRow({ skill: "cesiumjs-entities", cases: 2, generated: 0, screenshots: 0, covered: false }),
      ]),
    );

    expect(summary.missingScreenshots.map((skill) => skill.skill)).toEqual(["cesiumjs-camera"]);
    expect(summary.missingBaselineCases.map((skill) => skill.skill)).toEqual(["cesiumjs-entities"]);
    expect(summary.needsPreparation.map((skill) => skill.skill)).toEqual(["cesiumjs-camera", "cesiumjs-entities"]);
  });

  it("is fully covered only when every selected skill is ready", () => {
    const summary = summarizeBaselineCoverage(
      coverage([
        skillRow({ skill: "cesiumjs-camera", cases: 2, generated: 2, screenshots: 2, covered: true }),
        skillRow({ skill: "cesiumjs-imagery", cases: 1, generated: 1, screenshots: 1, covered: true }),
      ]),
    );

    expect(summary).toMatchObject({
      selectedCount: 2,
      coveredCount: 2,
      fullyCovered: true,
    });
  });
});
