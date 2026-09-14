/** Repo-root discovery and path helpers shared by every command. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot: string | null = null;

/**
 * Resolve the repository root. Precedence:
 * 1. CESIUM_SKILLS_ROOT env var (explicit override),
 * 2. walk up from cwd looking for a `.git` directory plus `skills/`,
 * 3. walk up from this file (works for `node packages/eval/...` installs).
 */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  const override = process.env.CESIUM_SKILLS_ROOT;
  if (override && fs.existsSync(override)) {
    cachedRoot = path.resolve(override);
    return cachedRoot;
  }
  const marker = (dir: string) => fs.existsSync(path.join(dir, ".git")) && fs.existsSync(path.join(dir, "skills"));
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (marker(dir)) {
      cachedRoot = dir;
      return dir;
    }
    if (path.dirname(dir) === dir) break;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here; ; dir = path.dirname(dir)) {
    if (marker(dir)) {
      cachedRoot = dir;
      return dir;
    }
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(
    "could not locate the cesiumjs-skills repository root; run from inside the repo or set CESIUM_SKILLS_ROOT",
  );
}

/** Repo-relative POSIX path when under the root, else the input unchanged. */
export function repoRelative(target: string): string {
  const root = repoRoot();
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return target.toString();
  return rel.split(path.sep).join("/");
}

/** Resolve a possibly-relative path against the repo root. */
export function fromRepoRoot(...segments: string[]): string {
  const joined = path.join(...segments);
  return path.isAbsolute(joined) ? joined : path.join(repoRoot(), joined);
}

export function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Sorted matches of `<dir>/<prefix>*<suffix>` (non-recursive), as absolute paths. */
export function globFiles(dir: string, prefix: string, suffix: string): string[] {
  return listFiles(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => path.join(dir, name));
}

/** Sorted matches of `<root>/<*>/<prefix>*<suffix>` (one level of subdirs). */
export function globAcrossDirs(root: string, prefix: string, suffix: string): string[] {
  const out: string[] = [];
  for (const sub of listDirs(root)) {
    out.push(...globFiles(path.join(root, sub), prefix, suffix));
  }
  return out.sort();
}

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}
