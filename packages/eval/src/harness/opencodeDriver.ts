/** Driver for the OpenCode CLI (`opencode run --format json`). */
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, registerDriver } from "./driver.js";
import { HarnessInvocationError, HarnessNotFoundError, cleanSubprocessEnv, formatPrompt, which } from "./shared.js";

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

class OpenCodeDriver implements HarnessDriver {
  readonly id = "opencode";
  private discovered = new Map<string, string | null>();

  ensureAvailable(spec: HarnessSpec): string {
    const binary = which(spec.binary);
    if (!binary) {
      throw new HarnessNotFoundError(
        `'${spec.binary}' CLI not found on PATH. Install ${spec.name ?? spec.id} and authenticate (${spec.auth ?? "see registry"}).`,
      );
    }
    return binary;
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

  invoke(spec: HarnessSpec, call: AgentCall): string {
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());

    const argv = ["run", "--format", "json", "--dir", workdir];
    if (call.model) argv.push("--model", call.model);
    if (call.variant) argv.push("--variant", call.variant);
    for (const file of call.files ?? []) argv.push("--file", path.resolve(file));
    if (call.title) argv.push("--title", call.title);

    const env = cleanSubprocessEnv();
    const permission = permissionEnv(call);
    if (permission !== null) env.OPENCODE_PERMISSION = permission;

    const result = spawnSync(binary, argv, {
      input: formatPrompt(call.prompt, call.system),
      encoding: "utf-8",
      timeout: call.timeoutSeconds * 1000,
      cwd: workdir,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new HarnessInvocationError(spec.id, result.status ?? -1, result.stderr ?? "", result.stdout ?? "");
    }
    const text = extractTextFromJsonEvents(result.stdout ?? "");
    if (!text) {
      throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", "harness returned no assistant text");
    }
    return text;
  }
}

registerDriver(new OpenCodeDriver());
