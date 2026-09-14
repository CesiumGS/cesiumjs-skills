/**
 * `cesium-eval check ...` — repository safety and hygiene gates:
 * public-artifacts (private-reference scan) and canonical-surface (no legacy
 * top-level eval dirs or stale refs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { gitLsFiles } from "../lib/proc.js";
import { resolveTargets, scanPublicArtifacts } from "../optimization/publicArtifacts.js";

export async function checkPublicArtifactsCommand(repoRoot: string, args: string[]): Promise<number> {
  const targets = resolveTargets(repoRoot, args);
  const hits = scanPublicArtifacts(repoRoot, args);
  if (hits.length) {
    console.error("[check public-artifacts] FAIL: public-safety scan matched:");
    for (const hit of hits) console.error(`  ${hit}`);
    return 1;
  }
  console.log(`[check public-artifacts] OK: scanned ${targets.length} files`);
  return 0;
}

const ALLOWED_REFERENCE_FILES = new Set([
  ".gitignore",
  "optimization/docs/source-of-truth.md",
  "evaluation/README.md",
  "packages/eval/src/commands/check.ts",
]);

const FORBIDDEN_TOP_LEVEL_EVAL_DIRS: Record<string, string> = {
  adapters: "packages/eval/src/harness/",
  checks: "packages/eval/src/evaluation/ or packages/eval/src/optimization/",
  decision: "packages/eval/src/optimization/",
  judges: "packages/eval/src/evaluation/ or packages/eval/src/optimization/",
  proposer: "packages/eval/src/optimization/",
  scripts: "packages/eval/src/commands/",
  tasks: "optimization/docs/",
  tests: "packages/eval/tests/",
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
  console.log("[check canonical-surface] OK: eval work is scoped to packages/eval, optimization/, and evaluation/");
  return 0;
}
