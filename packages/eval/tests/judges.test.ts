import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseVerdict, judgePanel } from "../src/optimization/pairwiseJudge.js";
import { parseJudgeJson, judgeRender, fakeJudgeCall, type JudgeCall } from "../src/evaluation/judge/staticJudge.js";
import { hashSeed, mulberry32 } from "../src/lib/random.js";

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
      call: async () => ({ text: callResults[Math.min(callIndex++, callResults.length - 1)] }),
      harness: "opencode",
      model: "test-model",
      variant: "low",
      protocol: "pairwise-v1",
      promptsDir,
      seeds,
    });
  }

  it("takes the majority verdict", async () => {
    // Seeded label mapping determines BASELINE/CANDIDATE; a TIE answer is mapping-independent.
    const result = await panelWith(['{"verdict": "TIE", "rationale": "same"}']);
    expect(result.verdict).toBe("TIE");
    expect(result.majority_count).toBe(3);
    expect(result.judge_unavailable).toBe(false);
  });

  it("marks the panel unavailable when any judge fails", async () => {
    const result = await panelWith(["garbage response"]);
    expect(result.judge_unavailable).toBe(true);
    expect(result.verdict).toBeNull();
  });

  it("requires distinct seeds", async () => {
    await expect(panelWith(['{"verdict": "TIE", "rationale": "x"}'], [1, 1, 2])).rejects.toThrow(/different/);
  });

  it("keeps label mapping deterministic per seed", async () => {
    const first = await panelWith(['{"verdict": "A", "rationale": "x"}']);
    const second = await panelWith(['{"verdict": "A", "rationale": "x"}']);
    expect(first.individual_verdicts.map((v) => v.label_mapping)).toEqual(
      second.individual_verdicts.map((v) => v.label_mapping),
    );
  });

  function panelForScenario(scenarioId: string, onPrompt?: (prompt: string, files: string[]) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-panel-"));
    tempDirs.push(root);
    const baseline = makeBundle(root, "baseline");
    const candidate = makeBundle(root, "candidate");
    const promptsDir = path.join(root, "prompts");
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(
      path.join(promptsDir, "pairwise-v1.txt"),
      "Compare {scenario_id}: A={screenshots_a} console={console_a} B={screenshots_b} console={console_b}",
    );
    return {
      baseline,
      candidate,
      result: judgePanel({ ...scenario, id: scenarioId }, { path: baseline }, { path: candidate }, {
        call: async (prompt, files) => {
          onPrompt?.(prompt, files);
          return { text: '{"verdict": "TIE", "rationale": "same"}' };
        },
        harness: "opencode",
        model: "test-model",
        variant: "low",
        protocol: "pairwise-v1",
        promptsDir,
        seeds: [42, 123, 789],
      }),
    };
  }

  it("varies the A/B label arrangement across scenarios (no frozen counterbalancing)", async () => {
    const arrangements = new Set(
      await Promise.all(
        ["eval-001", "eval-002", "eval-003", "eval-004", "eval-005", "eval-006"].map(async (id) =>
          JSON.stringify((await panelForScenario(id).result).individual_verdicts.map((v) => v.label_mapping.A)),
        ),
      ),
    );
    expect(arrangements.size).toBeGreaterThan(1);
  });

  it("never leaks bundle paths into the prompt and attaches neutral filenames", async () => {
    const prompts: string[] = [];
    const attached: string[][] = [];
    const { baseline, candidate, result } = panelForScenario("eval-001", (prompt, files) => {
      prompts.push(prompt);
      attached.push(files);
    });
    await result;
    for (const prompt of prompts) {
      expect(prompt).not.toContain(baseline);
      expect(prompt).not.toContain(candidate);
      expect(prompt).not.toContain("baseline");
      expect(prompt).toContain("candidate-a-frame-1.png");
      expect(prompt).toContain("candidate-b-frame-1.png");
    }
    expect(prompts.length).toBe(3);
    for (const files of attached) {
      expect(files.map((f) => path.basename(f)).sort()).toEqual(["candidate-a-frame-1.png", "candidate-b-frame-1.png"]);
      for (const file of files) expect(file).not.toContain("baseline");
    }
  });

  it("records real artifact paths only in the verdict record", async () => {
    const { baseline, candidate, result } = panelForScenario("eval-001");
    for (const verdict of (await result).individual_verdicts) {
      const sources = Object.values(verdict.screenshot_sources as Record<string, string>);
      expect(sources.some((source) => source.startsWith(baseline))).toBe(true);
      expect(sources.some((source) => source.startsWith(candidate))).toBe(true);
    }
  });

  it("stamps the agent the call actually used (truthful provenance)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-panel-"));
    tempDirs.push(root);
    const baseline = makeBundle(root, "base");
    const candidate = makeBundle(root, "cand");
    const promptsDir = path.join(root, "prompts");
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(path.join(promptsDir, "pairwise-v1.txt"), "Compare {scenario_id}");
    const result = await judgePanel(scenario, { path: baseline }, { path: candidate }, {
      // The invocation reports the agent that actually handled the call.
      call: async () => ({
        text: '{"verdict": "TIE", "rationale": "same"}',
        agent: { harness: "codex", model: "gpt-5.2", variant: "high" },
      }),
      harness: "opencode",
      model: "configured-model",
      variant: "low",
      protocol: "pairwise-v1",
      promptsDir,
      seeds: [42, 123, 789],
    });
    for (const verdict of result.individual_verdicts) {
      expect(verdict.harness).toBe("codex");
      expect(verdict.model_id).toBe("gpt-5.2");
      expect(verdict.model_variant).toBe("high");
    }
  });

  it("resolves an ambiguous even split to TIE instead of insertion order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-panel-"));
    tempDirs.push(root);
    const baseline = makeBundle(root, "base");
    const candidate = makeBundle(root, "cand");
    const promptsDir = path.join(root, "prompts");
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(path.join(promptsDir, "pairwise-v1.txt"), "Compare {scenario_id}");
    const seeds = [1, 2, 3, 4];
    // Answer so mapped verdicts are exactly BASELINE, BASELINE, CANDIDATE, CANDIDATE.
    const labelFor = (seed: number, want: "BASELINE" | "CANDIDATE"): "A" | "B" => {
      const flip = mulberry32(hashSeed(seed, scenario.id, ""))() < 0.5; // flip => A=BASELINE
      return want === "BASELINE" ? (flip ? "A" : "B") : flip ? "B" : "A";
    };
    let callIndex = 0;
    const result = await judgePanel(scenario, { path: baseline }, { path: candidate }, {
      call: async () => {
        const index = callIndex++;
        const want = index < 2 ? "BASELINE" : "CANDIDATE";
        return { text: JSON.stringify({ verdict: labelFor(seeds[index], want), rationale: "x" }) };
      },
      harness: "opencode",
      model: "test-model",
      variant: "low",
      protocol: "pairwise-v1",
      promptsDir,
      seeds,
    });
    expect(result.judge_unavailable).toBe(false);
    expect(result.verdict).toBe("TIE");
  });
});

describe("static judge", () => {
  it("parseJudgeJson extracts balanced objects from prose", () => {
    expect(parseJudgeJson('prefix {"overall": 8, "band": "PASS"} suffix')).toMatchObject({ band: "PASS" });
    expect(parseJudgeJson("```json\n{\"overall\": 3}\n```")).toMatchObject({ overall: 3 });
    expect(parseJudgeJson("nothing")).toBeNull();
  });

  function renderWith(call: JudgeCall, withScreenshot = true) {
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
      call,
      model: "test-model",
      nJudges: 3,
      seeds: [42, 123, 789],
      protocol: "static-visual-v1",
      promptsDir,
    });
  }

  it("emits a passing item for a clean render", async () => {
    const item = await renderWith(fakeJudgeCall());
    expect(item.status).toBe("pass");
    expect(item.overall_score).toBeGreaterThanOrEqual(7);
    expect(item.judge.n_parsed).toBe(3);
    expect(item.case_id).toBe("eval-101");
  });

  it("applies the liveness gate and blocks", async () => {
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
    const item = await renderWith(async () => ({ text: dead }));
    expect(item.status).toBe("fail");
    expect(item.overall_score).toBeLessThanOrEqual(2);
    expect(item.judge.gates_triggered).toContain("liveness_gate");
    expect(item.failure_flags).toContain("black_frame_ion_auth");
  });

  it("returns not_reviewed when the bundle has no screenshot", async () => {
    const item = await renderWith(fakeJudgeCall(), false);
    expect(item.status).toBe("not_reviewed");
    expect(item.score).toBeNull();
  });

  it("returns needs_review when every judge is unparseable", async () => {
    const item = await renderWith(async () => ({ text: "garbage" }));
    expect(item.status).toBe("needs_review");
    expect(item.blocking).toBe(true);
    expect(item.judge.per_judge).toHaveLength(3);
  });
});
