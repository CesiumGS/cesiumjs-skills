/**
 * Public-safety scanner: scans the complete tracked repository surface for
 * private or unsafe references (tokens, local paths, emails, private URLs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { repoRelative, walkFiles } from "../lib/paths.js";
import { gitLsFiles } from "../lib/proc.js";

const SKIP_SUFFIXES = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip",
  ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".webm",
]);

/** Configurable pattern list — add new sensitive patterns here. */
const PATTERNS: Record<string, RegExp> = {
  "gist URL": /https?:\/\/gist\.github\.com\//i,
  "local filesystem path (macOS)": /\/Users\/[A-Za-z0-9._-]+\//,
  "local filesystem path (Linux)": /\/home\/[A-Za-z0-9._-]+\//,
  "email address": /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  "Cesium token assignment": /Cesium\.Ion\.defaultAccessToken\s*=\s*['"][A-Za-z0-9._-]{40,}['"]/,
  "URL access token": /access_token=eyJ[A-Za-z0-9._-]{20,}/,
  // Hex escapes keep the scanner's own source from becoming its only hit while
  // preserving the exact runtime expressions.
  "private-source marker": /\b(?:DO NOT \x44ISTRIBUTE|proprietary and \x69nternal|Share\x50oint|dev\.\x61zure)\b/i,
};

const ALLOWED_EMAILS = [/^actions@github\.com$/, /^noreply@github\.com$/, /^.*@users\.noreply\.github\.com$/];

function trackedFiles(repoRoot: string): string[] {
  return gitLsFiles(repoRoot)
    .filter(
      (relPath) =>
        fs.existsSync(path.join(repoRoot, relPath)) &&
        fs.statSync(path.join(repoRoot, relPath)).isFile(),
    )
    .map((relPath) => path.join(repoRoot, relPath))
    .sort();
}

/** Resolve the concrete file list a scan will cover (for reporting). */
export function resolveTargets(repoRoot: string, args: string[]): string[] {
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
    // Unknown binary extensions are also excluded without maintaining an
    // exhaustive suffix list. Text containing NUL cannot yield a useful line
    // number and should be covered by a dedicated binary scanner instead.
    if (text.includes("\0")) continue;
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
