import type { BaselineCoverageDTO, SkillCoverageDTO } from "../types";

export interface BaselineCoverageSummary {
  selectedCount: number;
  coveredCount: number;
  needsPreparation: SkillCoverageDTO[];
  missingScreenshots: SkillCoverageDTO[];
  missingBaselineCases: SkillCoverageDTO[];
  fullyCovered: boolean;
}

/**
 * Summarize readiness against the complete selected-skill set.
 *
 * A skill without generated baseline cases is still selected and therefore
 * still unready. Keeping that category separate from renderable screenshot
 * gaps lets the launcher offer only actions that can actually make progress.
 */
export function summarizeBaselineCoverage(
  coverage: BaselineCoverageDTO | null,
): BaselineCoverageSummary {
  const skills = coverage?.skills ?? [];
  const selectedCount = skills.length;
  const coveredCount = skills.filter((skill) => skill.covered).length;
  const missingBaselineCases = skills.filter((skill) => skill.generated < skill.cases);
  const missingScreenshots = skills.filter(
    (skill) => skill.generated === skill.cases && skill.screenshots < skill.cases,
  );
  const needsPreparation = skills.filter((skill) => !skill.covered);

  return {
    selectedCount,
    coveredCount,
    needsPreparation,
    missingScreenshots,
    missingBaselineCases,
    fullyCovered: coverage !== null && selectedCount > 0 && coveredCount === selectedCount,
  };
}
