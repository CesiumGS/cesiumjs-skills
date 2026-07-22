import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseVerdict, judgePanel } from "../src/optimization/pairwiseJudge.js";
import { parseJudgeJson, judgeRender, fakeJudgeCall } from "../src/evaluation/judge/staticJudge.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeBundle(root: string, name: string): string {
  const bundle = path.join(root, name);
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, "screenshot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(bundle, "console.json"), JSON.stringify({ errors: [], console_messages: [] }));
  fs.writeFileSync(
    path.join(bundle, "programmatic-checks.json"),
    JSON.stringify({ checks: [{ check_id: "c", type: "code_runs", result: "pass", detail: "" }], summary: { total: 1, passed: 1, failed: 0 } }),
  );
  fs.writeFileSync(path.join(bundle, "scene-state.json"), JSON.stringify({ available: true }));
  return bundle;
}

describe("parseVerdict (pairwise)", () => {
  it("parses direct JSON", () => {
    expect(parseVerdict('{"verdict": "A", "rationale": "clean render"}')).toMatchObject({ verdict: "A" });
  });

  it("parses fenced JSON", () => {
    const text = 'Some prose.\n```json\n{"verdict": "TIE", "rationale": "equivalent"}\n```\nMore prose.';
    expect(parseVerdict(text)).toMatchObject({ verdict: "TIE" });
  });

  it("parses inline JSON embedded in prose", () => {
    const text = 'I think {"verdict": "B", "rationale": "better framing"} overall.';
    expect(parseVerdict(text)).toMatchObject({ verdict: "B" });
  });

  it("rejects invalid verdict values", () => {
    expect(() => parseVerdict('{"verdict": "C", "rationale": "?"}')).toThrow(/Invalid verdict/);
  });

  it("throws a clear error on unparseable responses", () => {
    expect(() => parseVerdict("no json here")).toThrow(/Could not parse verdict/);
  });
});

describe("judgePanel", () => {
  const scenario = {
    id: "eval-001",
    name: "test",
    description: "d",
    prompt: "p",
    expected_behaviors: ["works"],
    visual_expectations: "looks right",
  };

  function panelWith(callResults: string[], seeds = [42, 123, 789]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-panel-"));
    tempDirs.push(root);
    const baseline = makeBundle(root, "baseline");
    const candidate = makeBundle(root, "candidate");
    const promptsDir = path.join(root, "prompts");
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(path.join(promptsDir, "pairwise-v1.txt"), "Compare {scenario_id}: A={screenshots_a} B={screenshots_b}");
    let callIndex = 0;
    return judgePanel(scenario, { path: baseline }, { path: candidate }, {
      call: () => callResults[Math.min(callIndex++, callResults.length - 1)],
      harness: "opencode",
      model: "test-model",
      variant: "low",
      protocol: "pairwise-v1",
      promptsDir,
      seeds,
    });
  }

  it("takes the majority verdict", () => {
    // Seeded label mapping determines BASELINE/CANDIDATE; a TIE answer is mapping-independent.
    const result = panelWith(['{"verdict": "TIE", "rationale": "same"}']);
    expect(result.verdict).toBe("TIE");
    expect(result.majority_count).toBe(3);
    expect(result.judge_unavailable).toBe(false);
  });

  it("marks the panel unavailable when any judge fails", () => {
    const result = panelWith(["garbage response"]);
    expect(result.judge_unavailable).toBe(true);
    expect(result.verdict).toBeNull();
  });

  it("requires distinct seeds", () => {
    expect(() => panelWith(['{"verdict": "TIE", "rationale": "x"}'], [1, 1, 2])).toThrow(/different/);
  });

  it("keeps label mapping deterministic per seed", () => {
    const first = panelWith(['{"verdict": "A", "rationale": "x"}']);
    const second = panelWith(['{"verdict": "A", "rationale": "x"}']);
    expect(first.individual_verdicts.map((v) => v.label_mapping)).toEqual(
      second.individual_verdicts.map((v) => v.label_mapping),
    );
  });
});

describe("static judge", () => {
  it("parseJudgeJson extracts balanced objects from prose", () => {
    expect(parseJudgeJson('prefix {"overall": 8, "band": "PASS"} suffix')).toMatchObject({ band: "PASS" });
    expect(parseJudgeJson("```json\n{\"overall\": 3}\n```")).toMatchObject({ overall: 3 });
    expect(parseJudgeJson("nothing")).toBeNull();
  });

  function renderWith(call: (prompt: string) => string, withScreenshot = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-judge-"));
    tempDirs.push(root);
    const bundle = path.join(root, "bundle");
    fs.mkdirSync(bundle, { recursive: true });
    if (withScreenshot) fs.writeFileSync(path.join(bundle, "screenshot.png"), Buffer.from([1]));
    const promptsDir = path.join(root, "prompts");
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(path.join(promptsDir, "static-visual-v1.system.txt"), "You are a judge. {lens}");
    fs.writeFileSync(path.join(promptsDir, "static-visual-v1.user.txt"), "Scenario {scenario_id}: {screenshots}");
    return judgeRender({ skill: "cesiumjs-camera", id: "eval-101", name: "n", prompt: "p" }, bundle, {
      call: (prompt) => call(prompt),
      model: "test-model",
      nJudges: 3,
      seeds: [42, 123, 789],
      protocol: "static-visual-v1",
      promptsDir,
    });
  }

  it("emits a passing item for a clean render", () => {
    const item = renderWith(fakeJudgeCall());
    expect(item.status).toBe("pass");
    expect(item.overall_score).toBeGreaterThanOrEqual(7);
    expect(item.judge.n_parsed).toBe(3);
    expect(item.case_id).toBe("eval-101");
  });

  it("applies the liveness gate and blocks", () => {
    const dead = JSON.stringify({
      dimensions: {
        render_liveness: { score: 1, failure_modes: ["black_frame_ion_auth"] },
        subject_presence_and_recognizability: { score: 8 },
        framing_and_composition: { score: 8 },
        prompt_and_behavior_fidelity: { score: 8 },
        visual_correctness_and_artifacts: { score: 8 },
        legibility_and_clarity: { score: 8 },
      },
      failure_modes_detected: ["black_frame_ion_auth"],
      overall: 2,
      band: "FAIL",
      rationale: "black frame",
    });
    const item = renderWith(() => dead);
    expect(item.status).toBe("fail");
    expect(item.overall_score).toBeLessThanOrEqual(2);
    expect(item.judge.gates_triggered).toContain("liveness_gate");
    expect(item.failure_flags).toContain("black_frame_ion_auth");
  });

  it("returns not_reviewed when the bundle has no screenshot", () => {
    const item = renderWith(fakeJudgeCall(), false);
    expect(item.status).toBe("not_reviewed");
    expect(item.score).toBeNull();
  });

  it("returns needs_review when every judge is unparseable", () => {
    const item = renderWith(() => "garbage");
    expect(item.status).toBe("needs_review");
    expect(item.blocking).toBe(true);
    expect(item.judge.per_judge).toHaveLength(3);
  });
});
