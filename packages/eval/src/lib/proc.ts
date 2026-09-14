/** Small process helpers: git metadata and hashing. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

export function gitCommit(repoRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export function gitLsFiles(repoRoot: string): string[] {
  const stdout = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8" });
  return stdout.split("\n").filter((line) => line.length > 0);
}

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
