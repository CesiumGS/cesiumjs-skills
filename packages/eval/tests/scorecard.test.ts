import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evidenceSource, resolveCodegenProvenance, scoreForChecks } from "../src/evaluation/scorecard.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("scorecard helpers", () => {
  it("weights deterministic checks", () => {
    expect(
      scoreForChecks([
        { result: "pass", weight: 3 },
        { result: "fail", weight: 1 },
      ]),
    ).toEqual({
      score: 0.75,
      passed_weight: 3,
      total_weight: 4,
      passed_checks: 1,
      total_checks: 2,
    });
  });

  it("classifies fixture, agent, and mixed evidence", () => {
    const fixture = { evidence_path: "evaluation/fixtures/pass/case.evidence.json" };
    const agent = { evidence_path: "evaluation/artifacts/runs/case.evidence.json" };

    expect(evidenceSource([fixture])).toBe("fixtures");
    expect(evidenceSource([agent])).toBe("agent");
    expect(evidenceSource([fixture, agent])).toBe("mixed");
  });

  it("recovers the majority codegen provenance from source sidecars", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-scorecard-"));
    tempDirs.push(root);

    const sourcePaths = ["one.js", "two.js", "three.js"].map((name) => path.join(root, name));
    for (const sourcePath of sourcePaths) fs.writeFileSync(sourcePath, "// generated\n");
    for (const sourcePath of sourcePaths.slice(0, 2)) {
      fs.writeFileSync(
        sourcePath.replace(/\.js$/, ".meta.json"),
        JSON.stringify({ harness: "opencode", model_id: "github-copilot/gpt-5.6-sol", model_variant: "low" }),
      );
    }
    fs.writeFileSync(
      sourcePaths[2].replace(/\.js$/, ".meta.json"),
      JSON.stringify({ harness: "codex", model_id: "gpt-5.6-sol", model_variant: "high" }),
    );

    const scorecard = {
      cases: sourcePaths.map((sourcePath) => ({ evidence_summary: { actual_source_path: sourcePath } })),
    };

    expect(resolveCodegenProvenance(scorecard, root)).toEqual({
      harness: "opencode",
      model: "github-copilot/gpt-5.6-sol",
      model_variant: "low",
    });
  });
});