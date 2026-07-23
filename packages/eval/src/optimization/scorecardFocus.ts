/**
 * Convert deterministic scorecards into optimization focus hints.
 * Port of optimization/framework/scorecard_focus.py.
 */
import { pct } from "../lib/format.js";

function failedChecks(caseRow: Record<string, any>): Array<Record<string, any>> {
  return (caseRow.checks ?? []).filter((check: Record<string, any>) => check.result === "fail");
}

function visualFailureDetail(visualReview: Record<string, any>): string {
  const summary = String(visualReview.summary ?? "").trim();
  const dimensions = visualReview.dimensions ?? {};
  const failingDimensions: string[] = [];
  if (dimensions !== null && typeof dimensions === "object" && !Array.isArray(dimensions)) {
    for (const name of Object.keys(dimensions).sort()) {
      const dimension = dimensions[name];
      if (dimension === null || typeof dimension !== "object" || Array.isArray(dimension)) continue;
      const status = String(dimension.status ?? "");
      const score = dimension.score;
      if (["fail", "needs_review"].includes(status) || (typeof score === "number" && score < 6)) {
        failingDimensions.push(name);
      }
    }
  }
  if (failingDimensions.length) {
    const suffix = "Failing visual dimensions: " + failingDimensions.join(", ");
    return `${summary} ${suffix}`.trim();
  }
  return summary || "Visual review did not pass.";
}

function visualFailedChecks(caseRow: Record<string, any>): Array<Record<string, any>> {
  const visualReview = caseRow.visual_review;
  if (visualReview === null || visualReview === undefined || typeof visualReview !== "object" || Array.isArray(visualReview)) {
    return [];
  }
  const status = String(visualReview.status ?? "not_reviewed");
  if (["pass", "not_required"].includes(status)) return [];
  if (
    !visualReview.required &&
    !visualReview.blocking &&
    String(visualReview.reviewer ?? "unassigned") === "unassigned"
  ) {
    return [];
  }
  return [
    {
      check_id: `visual_review_${status}`,
      type: "qualitative_visual_review",
      category: "visual_review",
      critical: Boolean(visualReview.blocking ?? true),
      actual: status,
      expected: "pass",
      tolerance: null,
      detail: visualFailureDetail(visualReview),
    },
  ];
}

function allFailedChecks(caseRow: Record<string, any>): Array<Record<string, any>> {
  return [...failedChecks(caseRow), ...visualFailedChecks(caseRow)];
}

function categoryFailures(scorecard: Record<string, any>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const caseRow of scorecard.cases ?? []) {
    for (const check of allFailedChecks(caseRow)) {
      const category = String(check.category ?? "uncategorized");
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return counts;
}

function criticalCounts(scorecard: Record<string, any>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const failure of scorecard.critical_failures ?? []) {
    const category = String(failure.category ?? "uncategorized");
    counts[category] = (counts[category] ?? 0) + 1;
  }
  for (const caseRow of scorecard.cases ?? []) {
    for (const check of visualFailedChecks(caseRow)) {
      if (check.critical) {
        const category = String(check.category ?? "uncategorized");
        counts[category] = (counts[category] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function visualScore(scorecard: Record<string, any>): number {
  const summary = scorecard.visual_summary ?? {};
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) return 0;
  const required = Number(summary.required_count ?? summary.total_cases ?? 0);
  if (required <= 0) return 1;
  const passed = Number(summary.pass_count ?? 0);
  return passed / required;
}

export function buildFocus(scorecard: Record<string, any>): Record<string, any> {
  const threshold = Number(scorecard.threshold ?? 0.95);
  const categoryFails = categoryFailures(scorecard);
  const criticals = criticalCounts(scorecard);
  const categoryScores = scorecard.category_scores ?? {};

  const categories: Array<Record<string, any>> = [];
  const categoryNames = new Set([...Object.keys(categoryScores), ...Object.keys(categoryFails), ...Object.keys(criticals)]);
  for (const category of [...categoryNames].sort()) {
    const data = categoryScores[category] ?? {};
    const score =
      category === "visual_review" && !(category in categoryScores)
        ? visualScore(scorecard)
        : Number(data.score ?? 0);
    const failedCount = categoryFails[category] ?? 0;
    const criticalCount = criticals[category] ?? 0;
    if (score >= threshold && failedCount === 0 && criticalCount === 0) continue;
    categories.push({
      category,
      score,
      threshold,
      failed_checks: failedCount,
      critical_failures: criticalCount,
      priority: criticalCount * 100 + failedCount * 10 + Math.max(0, threshold - score),
    });
  }
  categories.sort((a, b) => (b.priority - a.priority) || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const cases: Array<Record<string, any>> = [];
  const skills: Record<string, number> = {};
  for (const caseRow of scorecard.cases ?? []) {
    const failed = allFailedChecks(caseRow);
    if (!failed.length) continue;
    const skill = String(caseRow.skill ?? "");
    skills[skill] = (skills[skill] ?? 0) + failed.length;
    cases.push({
      skill,
      case_id: caseRow.case_id ?? "",
      case_name: caseRow.case_name ?? "",
      task: caseRow.task ?? "",
      evidence_path: caseRow.evidence_path ?? "",
      score: caseRow.score ?? 0,
      failed_checks: failed.map((check) => ({
        check_id: check.check_id ?? "",
        type: check.type ?? "",
        category: check.category ?? "uncategorized",
        critical: Boolean(check.critical ?? false),
        actual: check.actual ?? null,
        expected: check.expected ?? null,
        tolerance: check.tolerance ?? null,
        detail: check.detail ?? "",
      })),
    });
  }
  cases.sort((a, b) => {
    const critA = a.failed_checks.filter((check: Record<string, any>) => check.critical).length;
    const critB = b.failed_checks.filter((check: Record<string, any>) => check.critical).length;
    if (critB !== critA) return critB - critA;
    if (a.skill !== b.skill) return a.skill < b.skill ? -1 : 1;
    return a.case_id < b.case_id ? -1 : a.case_id > b.case_id ? 1 : 0;
  });

  const categoryToCases: Record<string, Set<string>> = {};
  for (const caseRow of cases) {
    for (const check of caseRow.failed_checks) {
      (categoryToCases[check.category] ??= new Set()).add(`${caseRow.skill}/${caseRow.case_id}`);
    }
  }

  return {
    schema_version: "1.0",
    source_run_id: scorecard.run_id ?? "",
    source_git_commit: scorecard.git_commit ?? "",
    source_result: scorecard.overall_result ?? "",
    source_score: scorecard.overall_score ?? 0,
    threshold,
    focus_required: Boolean(categories.length || cases.length),
    categories: categories.map((category) => ({
      ...category,
      affected_cases: [...(categoryToCases[category.category] ?? new Set())].sort(),
    })),
    skills: Object.entries(skills)
      .sort(([skillA, countA], [skillB, countB]) => (countB - countA) || (skillA < skillB ? -1 : 1))
      .map(([skill, failedCount]) => ({ skill, failed_checks: failedCount })),
    cases,
  };
}

function markdownValue(value: unknown, maxLength = 140): string {
  let text: string;
  if (value === null || value === undefined) text = "null";
  else if (typeof value === "string") text = value;
  else {
    const sortDeep = (v: any): any => {
      if (Array.isArray(v)) return v.map(sortDeep);
      if (v !== null && typeof v === "object") {
        const out: Record<string, any> = {};
        for (const key of Object.keys(v).sort()) out[key] = sortDeep(v[key]);
        return out;
      }
      return v;
    };
    text = JSON.stringify(sortDeep(value));
  }
  text = text.replace(/\n/g, " ").replace(/\|/g, "\\|");
  return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "...";
}

export function focusToMarkdown(focus: Record<string, any>): string {
  const lines = [
    "# Optimization Focus From Scorecard",
    "",
    `- Source run: \`${focus.source_run_id}\``,
    `- Source result: **${String(focus.source_result).toUpperCase()}**`,
    `- Source score: ${pct(Number(focus.source_score))}`,
    `- Threshold: ${pct(Number(focus.threshold))}`,
    "",
  ];
  if (!focus.focus_required) {
    lines.push("No optimization focus is required from this scorecard.");
    return lines.join("\n").replace(/\s+$/, "") + "\n";
  }

  lines.push("## Categories", "", "| Category | Score | Failed Checks | Critical Failures | Affected Cases |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const category of focus.categories) {
    lines.push(
      `| ${category.category} | ${pct(category.score)} | ` +
        `${category.failed_checks} | ${category.critical_failures} | ` +
        `${category.affected_cases.join(", ")} |`,
    );
  }

  lines.push("", "## Cases", "");
  for (const caseRow of focus.cases) {
    lines.push(`### ${caseRow.skill} / ${caseRow.case_id} - ${caseRow.case_name}`);
    lines.push(`- Score: ${pct(Number(caseRow.score))}`);
    lines.push(`- Evidence: \`${caseRow.evidence_path}\``);
    for (const check of caseRow.failed_checks) {
      lines.push(
        `- \`${check.check_id}\` (${check.category}): ${check.detail}; ` +
          `actual=${markdownValue(check.actual)}; ` +
          `expected=${markdownValue(check.expected)}; ` +
          `tolerance=${markdownValue(check.tolerance)}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").replace(/\s+$/, "") + "\n";
}

/** Create a proposer-compatible decision record from scorecard focus. */
export function focusToDecision(focus: Record<string, any>, skill: string | null = null): Record<string, any> {
  const cases = (focus.cases ?? []).filter((caseRow: Record<string, any>) => skill === null || caseRow.skill === skill);
  const categories: Array<Record<string, any>> = [];
  for (const category of focus.categories ?? []) {
    const affected = (category.affected_cases ?? []).filter(
      (caseId: string) => skill === null || String(caseId).startsWith(`${skill}/`),
    );
    if (affected.length || skill === null) {
      categories.push({ ...category, affected_cases: affected });
    }
  }

  const failedChecksCount = cases.reduce(
    (sum: number, caseRow: Record<string, any>) => sum + (caseRow.failed_checks ?? []).length,
    0,
  );
  const criticalFailures = cases.reduce(
    (sum: number, caseRow: Record<string, any>) =>
      sum + (caseRow.failed_checks ?? []).filter((check: Record<string, any>) => check.critical).length,
    0,
  );
  const categorySummary =
    categories
      .slice(0, 5)
      .map((category) => `${category.category} ${pct(Number(category.score))}`)
      .join(", ") || "no failing categories";
  const caseLines: string[] = [];
  for (const caseRow of cases.slice(0, 8)) {
    const checkSummaries = (caseRow.failed_checks ?? [])
      .slice(0, 3)
      .map((check: Record<string, any>) => `${check.check_id}: ${check.detail}`)
      .join("; ");
    caseLines.push(`- ${caseRow.skill}/${caseRow.case_id} ${caseRow.case_name}: ${checkSummaries}`);
  }
  const rationale =
    "Deterministic scorecard focus should guide the next local optimization. " +
    `Source result=${focus.source_result} score=${pct(Number(focus.source_score ?? 0))} ` +
    `threshold=${pct(Number(focus.threshold ?? 0.95))}. ` +
    `Failing categories: ${categorySummary}. ` +
    "Failed checks:\n" +
    (caseLines.length ? caseLines.join("\n") : "- none");

  return {
    decision: cases.length ? "SCORECARD_FOCUS" : "SCORECARD_CLEAN",
    rule_fired: criticalFailures ? "scorecard_critical_failure_focus" : "scorecard_threshold_focus",
    rationale,
    counts: { wins: 0, losses: failedChecksCount, ties: 0 },
    scorecard_focus: {
      source_run_id: focus.source_run_id ?? "",
      source_git_commit: focus.source_git_commit ?? "",
      source_result: focus.source_result ?? "",
      source_score: focus.source_score ?? 0,
      threshold: focus.threshold ?? 0.95,
      skill,
      failed_checks: failedChecksCount,
      critical_failures: criticalFailures,
      categories,
      cases,
    },
  };
}
