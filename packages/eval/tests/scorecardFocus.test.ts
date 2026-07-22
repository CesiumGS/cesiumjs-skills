import { describe, expect, it } from "vitest";
import { buildFocus, focusToDecision } from "../src/optimization/scorecardFocus.js";

const scorecard = {
  run_id: "scorecard-x",
  git_commit: "abc",
  overall_result: "fail",
  overall_score: 0.8,
  threshold: 0.95,
  category_scores: {
    camera_framing: { score: 0.5 },
    execution_health: { score: 1.0 },
  },
  critical_failures: [{ category: "camera_framing" }],
  visual_summary: { required_count: 0 },
  cases: [
    {
      skill: "cesiumjs-camera",
      case_id: "eval-001",
      case_name: "framing",
      task: "frame the tower",
      evidence_path: "e.json",
      score: 0.5,
      checks: [
        { check_id: "ok", result: "pass", category: "execution_health" },
        { check_id: "bad", result: "fail", category: "camera_framing", critical: true, detail: "off-center" },
      ],
      visual_review: { status: "not_reviewed", required: false, blocking: false, reviewer: "unassigned" },
    },
    {
      skill: "cesiumjs-entities",
      case_id: "eval-002",
      case_name: "clean",
      task: "add entity",
      evidence_path: "e2.json",
      score: 1,
      checks: [{ check_id: "ok", result: "pass", category: "execution_health" }],
      visual_review: { status: "pass", required: true, blocking: true, reviewer: "judge" },
    },
    {
      skill: "cesiumjs-entities",
      case_id: "eval-003",
      case_name: "visual-fail",
      task: "render water",
      evidence_path: "e3.json",
      score: 1,
      checks: [{ check_id: "ok", result: "pass", category: "execution_health" }],
      visual_review: {
        status: "fail",
        required: true,
        blocking: true,
        reviewer: "judge",
        summary: "black frame",
        dimensions: { render_liveness: { status: "fail", score: 1 } },
      },
    },
  ],
};

describe("buildFocus", () => {
  it("collects failing categories, skills, and cases with priorities", () => {
    const focus = buildFocus(scorecard);
    expect(focus.focus_required).toBe(true);
    expect(focus.source_run_id).toBe("scorecard-x");

    const categories = focus.categories.map((c: any) => c.category);
    expect(categories).toContain("camera_framing");
    expect(categories).toContain("visual_review");
    expect(categories).not.toContain("execution_health");

    const caseKeys = focus.cases.map((c: any) => `${c.skill}/${c.case_id}`);
    expect(caseKeys).toEqual(["cesiumjs-camera/eval-001", "cesiumjs-entities/eval-003"]);

    const visualCase = focus.cases.find((c: any) => c.case_id === "eval-003");
    expect(visualCase.failed_checks[0].type).toBe("qualitative_visual_review");
    expect(visualCase.failed_checks[0].detail).toContain("render_liveness");
  });

  it("skips unreviewed non-blocking visual statuses", () => {
    const focus = buildFocus(scorecard);
    // eval-001's visual_review is unassigned/not required -> no visual check appended.
    const camera = focus.cases.find((c: any) => c.case_id === "eval-001");
    expect(camera.failed_checks).toHaveLength(1);
  });

  it("reports no focus for a clean scorecard", () => {
    const clean = {
      ...scorecard,
      overall_result: "pass",
      overall_score: 1,
      category_scores: { execution_health: { score: 1 } },
      critical_failures: [],
      cases: [scorecard.cases[1]],
    };
    const focus = buildFocus(clean);
    expect(focus.focus_required).toBe(false);
    expect(focus.cases).toHaveLength(0);
  });
});

describe("focusToDecision", () => {
  it("restricts to one skill and counts failures", () => {
    const focus = buildFocus(scorecard);
    const decision = focusToDecision(focus, "cesiumjs-camera");
    expect(decision.decision).toBe("SCORECARD_FOCUS");
    expect(decision.rule_fired).toBe("scorecard_critical_failure_focus");
    expect(decision.scorecard_focus.cases).toHaveLength(1);
    expect(decision.scorecard_focus.skill).toBe("cesiumjs-camera");
  });

  it("emits SCORECARD_CLEAN when the skill has no failing cases", () => {
    const focus = buildFocus(scorecard);
    const decision = focusToDecision(focus, "cesiumjs-nonexistent");
    expect(decision.decision).toBe("SCORECARD_CLEAN");
  });
});
