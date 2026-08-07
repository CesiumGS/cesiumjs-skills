/** Driver for the OpenCode CLI (`opencode run --format json`). */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, StructuredInvocation, registerDriver } from "./driver.js";
import type { HarnessProgress } from "./progress.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess, which } from "./shared.js";

/** Friendly tool names accepted from callers, mapped to permission keys. */
const TOOL_PERMISSION_NAMES: Record<string, string> = {
  Read: "read",
  Grep: "grep",
  Glob: "glob",
  Bash: "bash",
  Edit: "edit",
  Write: "edit",
  Skill: "skill",
};

function permissionEnv(call: AgentCall): string | null {
  if (call.disableTools) return JSON.stringify({ "*": "deny" });
  if (!call.allowedTools) return null;

  const permission: Record<string, unknown> = { "*": "deny" };
  for (const tool of call.allowedTools) {
    permission[(TOOL_PERMISSION_NAMES[tool] ?? tool).toLowerCase()] = "allow";
  }
  if (call.addDirs?.length) {
    const external: Record<string, string> = { "*": "deny" };
    for (const item of call.addDirs) {
      const resolved = path.resolve(item);
      external[resolved] = "allow";
      external[`${resolved}/*`] = "allow";
      external[`${resolved}/**`] = "allow";
    }
    permission.external_directory = external;
  }
  return JSON.stringify(permission);
}

/**
 * Translate one line of `opencode run --format json` into live commentary.
 *
 * OpenCode's stream is part-shaped: `step_start` / `tool_use` / `text` /
 * `reasoning` / `step_finish`, each carrying the part it just settled. A
 * multi-step turn emits one step_start..step_finish pair per model call, which
 * makes step boundaries the natural place to report token spend — that is
 * where the tokens block lives.
 *
 * `tool_use` arrives once per state transition with `part.state.status` of
 * pending/running/completed/error, so the same call can be reported twice; the
 * status is in the line, which is exactly the information a reader watching a
 * slow tool wants.
 */
export function reportOpenCodeEvent(progress: HarnessProgress, line: string): void {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return; // non-JSON chatter on stdout
  }
  if (!event || typeof event.type !== "string") return;
  const part = event.part ?? {};
  const id = String(part.id ?? part.callID ?? "part");

  switch (event.type) {
    case "step_start":
      progress.emit({ kind: "session", label: "step started" });
      return;
    case "step_finish": {
      const tokens = part.tokens ?? {};
      progress.usage({
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cached: tokens.cache?.read,
      });
      if (part.reason && part.reason !== "stop") {
        progress.emit({ kind: "session", label: "step finished", detail: { reason: part.reason } });
      }
      return;
    }
    case "tool_use": {
      const state = part.state ?? {};
      const input = state.input ?? {};
      // The interesting argument differs per tool, and dumping the whole input
      // object buries it. Prefer the conventional ones, fall back to a compact
      // key list so an unfamiliar tool still shows what it was handed.
      const summary =
        input.command ?? input.filePath ?? input.pattern ?? input.path ?? input.url ?? Object.keys(input).join(",");
      progress.emit({
        kind: "tool",
        label: String(part.tool ?? "tool"),
        text: String(summary ?? ""),
        detail: { state: state.status ?? "?", error: state.status === "error" ? String(state.error ?? "yes") : undefined },
      });
      return;
    }
    case "reasoning":
      progress.emitDelta(`think:${id}`, "thinking", "reasoning", String(part.text ?? ""));
      return;
    case "text":
      progress.emitDelta(`msg:${id}`, "message", "assistant", String(part.text ?? ""));
      return;
    case "error":
      progress.emit({ kind: "notice", label: "harness", text: String(event.error?.message ?? event.error ?? "") });
      return;
    default:
      progress.emit({ kind: "notice", label: event.type });
  }
}

function extractTextFromJsonEvents(stdout: string): string {
  const parts: string[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== "text") continue;
    const text = typeof event.part?.text === "string" ? event.part.text.trim() : "";
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

/** OpenCode's server log records `providerID=... modelID=...` per stream call.
 * Windowed read: capture the byte offset BEFORE the run, then parse only the
 * bytes this run appended — last-line-wins is racy under concurrency. */
const OPENCODE_LOG_PATH = path.join(os.homedir(), ".local", "share", "opencode", "log", "opencode.log");

function logOffset(): number {
  try {
    return fs.statSync(OPENCODE_LOG_PATH).size;
  } catch {
    return 0;
  }
}

function scrapeAttribution(offset: number): { provider: string | null; model: string | null } {
  try {
    const fd = fs.openSync(OPENCODE_LOG_PATH, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= offset) return { provider: null, model: null };
      const buffer = Buffer.alloc(Math.min(size - offset, 4 * 1024 * 1024));
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      const fresh = buffer.toString("utf-8");
      const hits = [...fresh.matchAll(/providerID=(\S+)\s+modelID=(\S+)/g)];
      const last = hits.at(-1);
      return last ? { provider: last[1], model: last[2] } : { provider: null, model: null };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { provider: null, model: null };
  }
}

class OpenCodeDriver implements HarnessDriver {
  readonly id = "opencode";
  private discovered = new Map<string, string | null>();

  ensureAvailable(spec: HarnessSpec): string {
    return resolveBinary(spec);
  }

  /** Live model discovery driven by the registry's `discovery` block. */
  discoverDefaultModel(spec: HarnessSpec): string | null {
    if (!spec.discovery) return null;
    if (this.discovered.has(spec.id)) return this.discovered.get(spec.id) ?? null;

    let result: string | null = null;
    const binary = which(spec.binary);
    if (binary) {
      try {
        const stdout = execFileSync(binary, spec.discovery.args, {
          encoding: "utf-8",
          timeout: 15_000,
          env: cleanSubprocessEnv(),
        });
        const models = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const { prefer_family: family, prefer_suffix: suffix } = spec.discovery;
        result =
          models.find((model) => model === spec.default_model) ??
          models.find(
            (model) => (!family || model.includes(family)) && (!suffix || model.endsWith(suffix)),
          ) ??
          null;
      } catch {
        result = null;
      }
    }
    this.discovered.set(spec.id, result);
    return result;
  }

  async invoke(spec: HarnessSpec, call: AgentCall): Promise<string> {
    return (await this.invokeStructured(spec, call)).text;
  }

  async invokeStructured(spec: HarnessSpec, call: AgentCall): Promise<StructuredInvocation> {
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());
    const offset = logOffset();

    const argv = ["run", "--format", "json", "--dir", workdir];
    // OpenCode addresses models as provider/model: an explicit provider is
    // the prefix (catalog ids may already carry one — don't double-prefix).
    const model = call.model && call.provider && !call.model.includes("/") ? `${call.provider}/${call.model}` : call.model;
    if (model) argv.push("--model", model);
    if (call.variant) argv.push("--variant", call.variant);
    for (const file of call.files ?? []) argv.push("--file", path.resolve(file));
    if (call.title) argv.push("--title", call.title);

    const env = cleanSubprocessEnv();
    const permission = permissionEnv(call);
    if (permission !== null) env.OPENCODE_PERMISSION = permission;

    const progress = call.progress;
    const result = await runSubprocess(binary, argv, {
      input: formatPrompt(call.prompt, call.system),
      timeoutMs: call.timeoutSeconds * 1000,
      cwd: workdir,
      env,
      onStdoutLine: progress?.enabled ? (line) => reportOpenCodeEvent(progress, line) : undefined,
    });
    if (result.status !== 0) {
      throw new HarnessInvocationError(spec.id, result.status ?? -1, result.stderr ?? "", result.stdout ?? "");
    }
    const text = extractTextFromJsonEvents(result.stdout ?? "");
    if (!text) {
      throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", "harness returned no assistant text");
    }
    const scraped = scrapeAttribution(offset);
    return { text, observedProviderRaw: scraped.provider, observedModel: scraped.model };
  }
}

registerDriver(new OpenCodeDriver());
