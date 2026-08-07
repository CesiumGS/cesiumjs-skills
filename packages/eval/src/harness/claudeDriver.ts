/**
 * Driver for Claude Code (`claude -p --output-format json`).
 *
 * The JSON envelope carries wire-OBSERVED attribution: modelUsage reports the
 * canonical model and provider ("firstParty" == Anthropic subscription) that
 * actually served the call, so probes get observed — not declared — identity.
 * Image inputs work natively in headless mode (the Read tool renders image
 * files); files are referenced in the prompt and their directories allowed
 * via --add-dir.
 */
import * as path from "node:path";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, StructuredInvocation, registerDriver } from "./driver.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

interface ClaudeJsonEnvelope {
  result?: unknown;
  is_error?: unknown;
  modelUsage?: Record<string, { canonicalModel?: unknown; provider?: unknown }>;
}

function parseEnvelope(stdout: string): ClaudeJsonEnvelope | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as ClaudeJsonEnvelope;
  } catch {
    return null;
  }
}

class ClaudeCodeDriver implements HarnessDriver {
  readonly id = "claude-code";

  ensureAvailable(spec: HarnessSpec): string {
    return resolveBinary(spec);
  }

  async invoke(spec: HarnessSpec, call: AgentCall): Promise<string> {
    return (await this.invokeStructured(spec, call)).text;
  }

  async invokeStructured(spec: HarnessSpec, call: AgentCall): Promise<StructuredInvocation> {
    // Claude Code speaks anthropic-messages only: any other provider needs
    // the protocol adapter. Fail loudly instead of silently ignoring it.
    if (call.provider && call.provider !== (spec.provider ?? "anthropic")) {
      throw new Error(
        `claude-code reaches only '${spec.provider ?? "anthropic"}' natively; ` +
          `route provider '${call.provider}' through the protocol adapter (cesium-eval adapter) instead.`,
      );
    }
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());

    // Prompt travels on stdin (no argv length limits on large skill-document
    // prompts); the JSON envelope is the whole stdout.
    const argv = ["-p", "--output-format", "json"];
    if (call.model) argv.push("--model", call.model);
    // variant intentionally unused: headless Claude Code exposes no per-call
    // reasoning-effort flag (registry effort_mechanism: null).
    for (const dir of call.addDirs ?? []) argv.push("--add-dir", path.resolve(dir));
    const fileDirs = [...new Set((call.files ?? []).map((file) => path.dirname(path.resolve(file))))];
    for (const dir of fileDirs) argv.push("--add-dir", dir);
    if (call.disableTools) {
      argv.push("--disallowedTools", "*");
    } else if (call.allowedTools?.length) {
      argv.push("--allowedTools", call.allowedTools.join(","));
    }

    let prompt = formatPrompt(call.prompt, call.system);
    if (call.files?.length) {
      const listed = call.files.map((file) => path.resolve(file)).join("\n");
      prompt += `\n\nAttached image files (read them from disk):\n${listed}`;
    }

    const result = await runSubprocess(binary, argv, {
      input: prompt,
      timeoutMs: call.timeoutSeconds * 1000,
      cwd: workdir,
      // call.env last: adapter routing (ANTHROPIC_BASE_URL + key + simple
      // mode) must beat the inherited environment.
      env: { ...cleanSubprocessEnv(), ...(call.env ?? {}) },
    });
    if (result.status !== 0) {
      // The JSON envelope usually carries a readable `result` ("API Error:
      // 401 …") — surface that instead of the raw envelope blob.
      const failed = parseEnvelope(result.stdout ?? "");
      const reason = typeof failed?.result === "string" && failed.result.trim() ? failed.result.trim() : (result.stdout ?? "");
      throw new HarnessInvocationError(spec.id, result.status ?? -1, result.stderr ?? "", reason);
    }

    const envelope = parseEnvelope(result.stdout ?? "");
    const text = typeof envelope?.result === "string" ? envelope.result.trim() : "";
    if (!envelope || envelope.is_error === true || !text) {
      throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", text || "harness returned no final assistant message");
    }

    let observedModel: string | null = null;
    let observedProviderRaw: string | null = null;
    for (const usage of Object.values(envelope.modelUsage ?? {})) {
      if (typeof usage.canonicalModel === "string") observedModel = usage.canonicalModel;
      if (typeof usage.provider === "string") observedProviderRaw = usage.provider;
      if (observedModel) break;
    }
    return { text, observedModel, observedProviderRaw };
  }
}

registerDriver(new ClaudeCodeDriver());
