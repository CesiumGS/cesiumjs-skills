import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fromRepoRoot } from "../src/lib/paths.js";

const SCRIPT = fromRepoRoot(".github", "scripts", "render-gate-summary.mjs");
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-summary-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function render(dir: string, exitCode: number): string {
  const output = path.join(dir, "summary.md");
  execFileSync(
    process.execPath,
    [
      SCRIPT,
      "--status",
      path.join(dir, "gate-status.tsv"),
      "--skills",
      path.join(dir, "skill-contract.json"),
      "--scorecard",
      path.join(dir, "scorecard.json"),
      "--fixtures",
      path.join(dir, "fixture-verification.json"),
      "--output",
      output,
      "--exit-code",
      String(exitCode),
    ],
    {
      env: {
        ...process.env,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_RUN_ID: "123",
        GITHUB_SHA: "0123456789abcdef",
      },
    },
  );
  return fs.readFileSync(output, "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("native deterministic gate summary", () => {
  it("renders an actionable scorecard when the skill contract fails before scoring", () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "gate-status.tsv"),
      [
        "build\tpass\t2\tCompleted",
        "validate-evaluation\tpass\t1\tCompleted",
        "validate-optimization\tpass\t1\tCompleted",
        "skill-contract\tfail\t0\tExited with code 1",
      ].join("\n") + "\n",
    );
    writeJson(path.join(dir, "skill-contract.json"), {
      schema_version: "1.0",
      result: "fail",
      checked_skills: ["a", "b"],
      checked_skill_count: 2,
      registry_symbol_count: 551,
      affected_skills: ["a", "b"],
      violation_count: 2,
      violations_by_rule: { description: 1, title: 1 },
      violations: [
        { skill: "a", file: "skills/a/SKILL.md", rule: "description", detail: "empty <description>" },
        { skill: "b", file: "skills/b/SKILL.md", rule: "title", detail: "missing title" },
      ],
      setup_error: null,
    });

    const markdown = render(dir, 1);
    expect(markdown).toContain("# ❌ Deterministic Gate Failed");
    expect(markdown).toContain("2 contract violations across 2 affected skills");
    expect(markdown).toContain("| **❌ FAIL** | **—** | **2** | **2** | **—** | **4.0s** |");
    expect(markdown).toContain("| Check skill contract | ❌ Failed |");
    expect(markdown).toContain("| Eval CLI unit tests | ⏭️ Not run |");
    expect(markdown).toContain("<details open><summary><strong>All skill findings</strong></summary>");
    expect(markdown).toContain("empty &lt;description&gt;");
    expect(markdown).not.toContain("empty <description>");
  });

  it("renders scores, progress bars, and fixture reconciliation on success", () => {
    const dir = tempDir();
    fs.writeFileSync(
      path.join(dir, "gate-status.tsv"),
      [
        "build\tpass\t1\tCompleted",
        "validate-evaluation\tpass\t0\tCompleted",
        "validate-optimization\tpass\t0\tCompleted",
        "skill-contract\tpass\t1\tCompleted",
        "unit-tests\tpass\t2\tCompleted",
        "score\tpass\t1\tCompleted",
        "verify-fixtures\tpass\t1\tCompleted",
        "canonical-surface\tpass\t0\tCompleted",
        "public-artifacts\tpass\t0\tCompleted",
        "working-tree\tskipped\t0\tCI-only assertion",
      ].join("\n") + "\n",
    );
    writeJson(path.join(dir, "skill-contract.json"), {
      result: "pass",
      checked_skill_count: 15,
      registry_symbol_count: 551,
      affected_skills: [],
      violation_count: 0,
      violations_by_rule: {},
      violations: [],
      setup_error: null,
    });
    writeJson(path.join(dir, "scorecard.json"), {
      overall_score: 1,
      threshold: 0.95,
      critical_failures: [],
      category_scores: { correctness: { score: 1, passed_checks: 12, total_checks: 12 } },
    });
    writeJson(path.join(dir, "fixture-verification.json"), {
      total: 18,
      matched: 18,
      mismatched: [],
      by_matcher: { exact: { fixture_pass: 10, fixture_fail: 8 } },
    });

    const markdown = render(dir, 0);
    expect(markdown).toContain("# ✅ Deterministic Gate Passed");
    expect(markdown).toContain("| **✅ PASS** | **100.0%** | **15** | **0** | **18/18** | **6.0s** |");
    expect(markdown).toContain("`██████████`");
    expect(markdown).toContain("✅ **18/18 fixtures**");
    expect(markdown).toContain("[Open workflow run](https://github.com/owner/repo/actions/runs/123)");
  });
});
