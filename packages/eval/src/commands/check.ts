/**
 * `cesium-eval check canonical-surface` — ensure active eval work stays in
 * optimization/ or evaluation/ (no legacy top-level eval dirs or stale refs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { gitLsFiles } from "../lib/proc.js";

const ALLOWED_REFERENCE_FILES = new Set([
  ".gitignore",
  "optimization/docs/source-of-truth.md",
  "evaluation/README.md",
  "packages/eval/src/commands/check.ts",
]);

const FORBIDDEN_TOP_LEVEL_EVAL_DIRS: Record<string, string> = {
  adapters: "optimization/framework/",
  checks: "optimization/framework/",
  decision: "optimization/framework/",
  judges: "optimization/framework/",
  proposer: "optimization/framework/",
  scripts: "optimization/scripts/ or evaluation/scripts/",
  tasks: "optimization/docs/",
  tests: "optimization/tests/ or evaluation/tests/",
};

const FORBIDDEN_TOP_LEVEL_EVAL_FILES: Record<string, string> = {
  "prd.json": "optimization/docs/prd.json",
};

const FORBIDDEN_REFERENCE_PATTERNS: Record<string, RegExp> = {
  "historical tuning path": /\btuning\//,
  "old tuning runner": /\brun_eval_suite\.py\b/,
  "old tuning coverage tool": /\bcoverage-analyzer\.py\b/,
};

export async function checkCanonicalSurfaceCommand(repoRoot: string): Promise<number> {
  const tracked = gitLsFiles(repoRoot);
  const failures: string[] = [];

  for (const relPath of tracked.filter((p) => p === "tuning" || p.startsWith("tuning/"))) {
    failures.push(`${relPath}: tracked historical tuning content is not allowed`);
  }
  for (const relPath of tracked.filter((p) => p === "evals" || p.startsWith("evals/"))) {
    failures.push(`${relPath}: legacy evals/ content must be moved to optimization/ or evaluation/`);
  }

  for (const relPath of tracked) {
    if (relPath in FORBIDDEN_TOP_LEVEL_EVAL_FILES) {
      failures.push(`${relPath}: eval planning artifacts must live under ${FORBIDDEN_TOP_LEVEL_EVAL_FILES[relPath]}`);
    }
    const topLevel = relPath.split("/", 1)[0];
    if (topLevel in FORBIDDEN_TOP_LEVEL_EVAL_DIRS) {
      failures.push(`${relPath}: eval pipeline files must live under ${FORBIDDEN_TOP_LEVEL_EVAL_DIRS[topLevel]}`);
    }
  }

  for (const relPath of tracked) {
    if (ALLOWED_REFERENCE_FILES.has(relPath)) continue;
    const filePath = path.join(repoRoot, relPath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary
    text.split("\n").forEach((line, index) => {
      for (const [label, pattern] of Object.entries(FORBIDDEN_REFERENCE_PATTERNS)) {
        if (pattern.test(line)) failures.push(`${relPath}:${index + 1}: ${label}`);
      }
    });
  }

  if (failures.length) {
    console.error("[check canonical-surface] FAIL:");
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }
  console.log("[check canonical-surface] OK: eval work is scoped to optimization/ and evaluation/");
  return 0;
}
