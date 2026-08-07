import type { SkillOverview } from "../types";

/**
 * One skill on the Optimize rail. A handoff can create a queue entry before
 * the skill has any optimization artifacts, so history is deliberately
 * optional instead of being represented by a synthetic SkillOverview.
 */
export interface OptimizationQueueSkill {
  skill: string;
  queuedCaseKeys: string[];
  history: SkillOverview | null;
}

function skillFromCaseKey(key: string): string | null {
  const separator = key.indexOf("/");
  if (separator <= 0) return null;
  return key.slice(0, separator);
}

/**
 * Merge the persisted Review handoff with on-disk optimization history.
 * Queued skills come first (largest focus first), followed by history-only
 * skills in the order supplied by the API.
 */
export function buildOptimizationQueue(
  history: SkillOverview[],
  queuedCaseKeys: string[],
): OptimizationQueueSkill[] {
  const historyBySkill = new Map(history.map((item) => [item.skill, item]));
  const queuedBySkill = new Map<string, string[]>();

  for (const key of queuedCaseKeys) {
    const skill = skillFromCaseKey(key);
    if (!skill) continue;
    const keys = queuedBySkill.get(skill) ?? [];
    if (!keys.includes(key)) keys.push(key);
    queuedBySkill.set(skill, keys);
  }

  const queued = [...queuedBySkill.entries()]
    .sort(([skillA, keysA], [skillB, keysB]) => keysB.length - keysA.length || skillA.localeCompare(skillB))
    .map(([skill, keys]) => ({
      skill,
      queuedCaseKeys: keys,
      history: historyBySkill.get(skill) ?? null,
    }));

  const queuedSkills = new Set(queued.map((item) => item.skill));
  const historyOnly = history
    .filter((item) => !queuedSkills.has(item.skill))
    .map((item) => ({
      skill: item.skill,
      queuedCaseKeys: [],
      history: item,
    }));

  return [...queued, ...historyOnly];
}
