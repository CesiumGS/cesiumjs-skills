/** Shared subprocess plumbing for harness drivers. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { HarnessSpec } from "../config/types.js";

/**
 * Secrets that must never reach an agent-CLI subprocess (API-key billing must
 * not silently replace subscription auth). A harness whose registry entry
 * DECLARES api-key billing (credential.env_passthrough) re-grants a var
 * explicitly — deliberate is fine, silent is not.
 */
export const DISALLOWED_ENV_VARS = ["OPENAI_API_KEY"] as const;

export function cleanSubprocessEnv(allow: string[] = []): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const name of DISALLOWED_ENV_VARS) {
    if (!allow.includes(name)) delete env[name];
  }
  return env;
}

function expandHome(candidate: string): string {
  return candidate.startsWith("~/") ? path.join(os.homedir(), candidate.slice(2)) : candidate;
}

/**
 * Resolve a harness binary: registry-declared absolute candidates first
 * (install scripts often wire PATH via .zshrc, invisible to non-interactive
 * shells), then PATH lookup. Throws HarnessNotFoundError with install help.
 */
export function resolveBinary(spec: HarnessSpec): string {
  for (const candidate of spec.binary_candidates ?? []) {
    const expanded = expandHome(candidate);
    try {
      fs.accessSync(expanded, fs.constants.X_OK);
      return expanded;
    } catch {
      // keep looking
    }
  }
  const binary = which(spec.binary);
  if (!binary) {
    throw new HarnessNotFoundError(
      `'${spec.binary}' CLI not found on PATH` +
        (spec.binary_candidates?.length ? ` (also tried: ${spec.binary_candidates.join(", ")})` : "") +
        `. Install ${spec.name ?? spec.id} and authenticate (${spec.auth ?? "see registry"}).`,
    );
  }
  return binary;
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

export interface SubprocessOptions {
  input?: string;
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string>;
  maxBuffer?: number;
}

export interface SubprocessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run one subprocess asynchronously (the event loop stays free, so SIGINT
 * handling and concurrent panel calls work). Rejects on spawn failure,
 * timeout, or output overflow; a non-zero exit is returned, not thrown.
 */
export function runSubprocess(binary: string, argv: string[], options: SubprocessOptions): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    const limit = options.maxBuffer ?? 64 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error(`subprocess timed out after ${Math.round(options.timeoutMs / 1000)}s: ${binary}`)),
      options.timeoutMs,
    );
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > limit) fail(new Error(`subprocess stdout exceeded ${limit} bytes: ${binary}`));
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > limit) fail(new Error(`subprocess stderr exceeded ${limit} bytes: ${binary}`));
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
  });
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
