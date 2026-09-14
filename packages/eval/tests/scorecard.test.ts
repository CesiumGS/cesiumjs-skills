import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evidenceSource, resolveCodegenProvenance, scoreForChecks, visualSummary } from "../src/evaluation/scorecard.js";

/** A visual-review case row at a given status. Defaults are required + blocking
 * off, matching how a missing screenshot surfaces (required but non-blocking). */
function vcase(status: string, opts: { required?: boolean; blocking?: boolean } = {}) {
  return {
    case_id: `c-${status}`,
    case_name: status,
    skill: "cesiumjs-camera",
    visual_review: { status, required: opts.required ?? true, blocking: opts.blocking ?? false },
  };
}

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

describe("visualSummary coverage", () => {
  it("passes when every required case was reviewed and passed", () => {
    const summary = visualSummary([vcase("pass"), vcase("pass")], true);
    expect(summary.result).toBe("pass");
    expect(summary.required_not_reviewed_count).toBe(0);
  });

  it("marks a fully un-reviewed run as not_run, never pass", () => {
    const summary = visualSummary([vcase("not_reviewed"), vcase("not_reviewed")], true);
    expect(summary.result).toBe("not_run");
  });

  it("treats partial coverage as not_run even when the reviewed cases pass", () => {
    // The reviewer's gap: one required case judged pass, another required case
    // never judged (missing screenshot) and non-blocking. Must not read green.
    const summary = visualSummary([vcase("pass"), vcase("not_reviewed")], true);
    expect(summary.result).toBe("not_run");
    expect(summary.required_not_reviewed_count).toBe(1);
  });

  it("still reports a confirmed blocking failure over incompleteness", () => {
    const summary = visualSummary([vcase("fail", { blocking: true }), vcase("not_reviewed")], true);
    expect(summary.result).toBe("fail");
  });

  it("ignores un-reviewed cases that were not required", () => {
    const summary = visualSummary([vcase("pass"), vcase("not_reviewed", { required: false })], true);
    expect(summary.result).toBe("pass");
    expect(summary.required_not_reviewed_count).toBe(0);
  });
});