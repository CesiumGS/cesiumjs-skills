/** Shared subprocess plumbing for harness drivers. */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Secrets that must never reach an agent-CLI subprocess (API-key billing must
 * not silently replace subscription auth).
 */
export const DISALLOWED_ENV_VARS = ["OPENAI_API_KEY"] as const;

export function cleanSubprocessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const name of DISALLOWED_ENV_VARS) delete env[name];
  return env;
}

/** Wrap a system instruction + task into a single stdin prompt. */
export function formatPrompt(prompt: string, system?: string | null): string {
  if (!system) return prompt;
  return [
    "Follow these system-level instructions for this automated evaluation run.",
    "",
    "<system_instructions>",
    system.trim(),
    "</system_instructions>",
    "",
    "<task>",
    prompt.trim(),
    "</task>",
  ].join("\n");
}

/** Locate an executable on PATH, or null. */
export function which(command: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export class HarnessNotFoundError extends Error {}

export class HarnessInvocationError extends Error {
  constructor(
    public harnessId: string,
    public returncode: number,
    public stderr: string,
    public stdout: string,
  ) {
    super(`${harnessId} CLI exited with code ${returncode}: ${summarize(stderr, stdout)}`);
  }
}

function summarize(stderr: string, stdout: string, limit = 4000): string {
  const streams: string[] = [];
  if (stderr.trim()) streams.push(`stderr:\n${stderr.trim()}`);
  if (stdout.trim()) streams.push(`stdout:\n${stdout.trim()}`);
  if (!streams.length) return "<no output>";
  const text = streams.join("\n\n");
  if (text.length <= limit) return text;
  const head = Math.floor(limit / 2);
  return `${text.slice(0, head).trimEnd()}\n...[truncated]...\n${text.slice(-(limit - head)).trimStart()}`;
}
