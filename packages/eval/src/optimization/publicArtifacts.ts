/**
 * Public-safety scanner: scans tracked docs and eval artifacts for private or
 * unsafe references (tokens, local paths, emails, private URLs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fromRepoRoot, repoRelative, walkFiles } from "../lib/paths.js";
import { gitLsFiles } from "../lib/proc.js";

const SCANNED_ROOTS = [".architecture", "docs", "wiki", "optimization", "evaluation", "README.md", ".github/workflows"];
const SKIP_PREFIXES = ["optimization/tests/", "packages/"];
const SKIP_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** Configurable pattern list — add new sensitive patterns here. */
const PATTERNS: Record<string, RegExp> = {
  "gist URL": /https?:\/\/gist\.github\.com\//i,
  "local filesystem path (macOS)": /\/Users\/[A-Za-z0-9._-]+\//,
  "local filesystem path (Linux)": /\/home\/[A-Za-z0-9._-]+\//,
  "email address": /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  "localhost trace URL": /https?:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\//,
  "Cesium token assignment": /Cesium\.Ion\.defaultAccessToken\s*=\s*['"][A-Za-z0-9._-]{40,}['"]/,
  "URL access token": /access_token=eyJ[A-Za-z0-9._-]{20,}/,
  "private-source marker": /\b(?:DO NOT DISTRIBUTE|proprietary and internal|SharePoint|dev\.azure)\b/i,
};

const ALLOWED_EMAILS = [/^actions@github\.com$/, /^noreply@github\.com$/, /^.*@users\.noreply\.github\.com$/];

function isScannedRelPath(relPath: string): boolean {
  return SCANNED_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

function trackedFiles(repoRoot: string): string[] {
  return gitLsFiles(repoRoot)
    .filter(
      (relPath) =>
        isScannedRelPath(relPath) &&
        !SKIP_PREFIXES.some((prefix) => relPath.startsWith(prefix)) &&
        fs.existsSync(path.join(repoRoot, relPath)) &&
        fs.statSync(path.join(repoRoot, relPath)).isFile(),
    )
    .map((relPath) => path.join(repoRoot, relPath))
    .sort();
}

function resolveTargets(repoRoot: string, args: string[]): string[] {
  if (!args.length) return trackedFiles(repoRoot);
  const targets = new Set<string>();
  for (const raw of args) {
    const target = path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) targets.add(target);
    else if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      for (const file of walkFiles(target)) targets.add(file);
    }
  }
  return [...targets].sort();
}

export function scanPublicArtifacts(repoRoot: string, args: string[] = []): string[] {
  const hits: string[] = [];
  for (const filePath of resolveTargets(repoRoot, args)) {
    if (SKIP_SUFFIXES.has(path.extname(filePath).toLowerCase())) continue;
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const rel = repoRelative(filePath);
    text.split("\n").forEach((line, index) => {
      for (const [label, pattern] of Object.entries(PATTERNS)) {
        const match = pattern.exec(line);
        if (!match) continue;
        if (label === "email address") {
          if (rel === "README.md") continue; // public project contact text allowed
          if (ALLOWED_EMAILS.some((allowed) => allowed.test(match[0]))) continue;
        }
        hits.push(`${rel}:${index + 1}: ${label}`);
      }
    });
  }
  return hits;
}

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
