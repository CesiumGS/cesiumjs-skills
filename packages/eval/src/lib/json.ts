/**
 * JSON file helpers. Artifacts are written with 2-space indentation and (for
 * scorecards/state files) deterministically sorted keys so diffs stay stable.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeysDeep) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

/** Deterministic (sorted-keys) pretty JSON. */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, indent);
}

/**
 * Canonical compact form used for content hashing (scenario baselines,
 * candidate hashes): sorted keys, no whitespace, non-ASCII escaped as \uXXXX.
 * The escaping is part of the hash contract — every hash committed in
 * optimization/results/baselines.json and historical meta sidecars was
 * computed over this exact byte form.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)).replace(
    /[\u0080-\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function readJsonOrNull(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Write pretty JSON with sorted keys plus a trailing newline. */
export function writeJsonSorted(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, stableStringify(value) + "\n");
}

/** Write pretty JSON in insertion order plus a trailing newline. */
export function writeJsonPlain(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

/** Atomic write (temp file + rename) used for console-owned state files. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = path.join(path.dirname(filePath), path.basename(filePath) + ".tmp");
  fs.writeFileSync(tmp, stableStringify(value) + "\n");
  fs.renameSync(tmp, filePath);
}

/** Parse a JSONL file tolerantly (skips blank and torn lines). */
export function readJsonl(filePath: string): any[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const events: any[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const data = JSON.parse(line);
      if (data !== null && typeof data === "object") events.push(data);
    } catch {
      // Torn tail write; the next poll sees it whole.
    }
  }
  return events;
}
