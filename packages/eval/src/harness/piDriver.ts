/**
 * Driver for Pi (`pi -p --mode json`, prompt on stdin).
 *
 * The JSONL event stream carries wire-OBSERVED attribution: assistant
 * message_end events report {provider, model} for the call that actually ran.
 * Pi's registry entry declares api-key billing (credential.env_passthrough),
 * so OPENAI_API_KEY is re-granted DELIBERATELY here — the default subprocess
 * env strips it to keep API-key billing from silently replacing subscription
 * auth on the other harnesses.
 */
import * as path from "node:path";
import type { HarnessSpec, ModelSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, StructuredInvocation, registerDriver } from "./driver.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

/** Only forward --thinking levels the picked model declares (mirrors the
 * copilot driver's effort handling): pi hard-errors on unsupported levels. */
function thinkingFor(spec: HarnessSpec, call: AgentCall): string | null {
  if (!call.variant) return null;
  const entry: ModelSpec | undefined = call.model ? spec.models.find((model) => model.id === call.model) : undefined;
  if (entry && !(entry.effort_levels ?? []).includes(call.variant)) return null;
  return call.variant;
}

interface PiMessage {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
}

class PiDriver implements HarnessDriver {
  readonly id = "pi";

  ensureAvailable(spec: HarnessSpec): string {
    return resolveBinary(spec);
  }

  async invoke(spec: HarnessSpec, call: AgentCall): Promise<string> {
    return (await this.invokeStructured(spec, call)).text;
  }

  async invokeStructured(spec: HarnessSpec, call: AgentCall): Promise<StructuredInvocation> {
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());

    // Prompt travels on stdin (verified: `echo ... | pi -p` answers) to avoid
    // argv length limits on large skill-document prompts.
    const argv = ["-p", "--mode", "json"];
    if (call.model) argv.push("--model", call.model);
    const thinking = thinkingFor(spec, call);
    if (thinking) argv.push("--thinking", thinking);
    if (call.disableTools) argv.push("--no-tools");
    else if (call.allowedTools?.length) argv.push("--tools", call.allowedTools.map((tool) => tool.toLowerCase()).join(","));

    const result = await runSubprocess(binary, argv, {
      input: formatPrompt(call.prompt, call.system),
      timeoutMs: call.timeoutSeconds * 1000,
      cwd: workdir,
      env: cleanSubprocessEnv(spec.credential?.env_passthrough ?? []),
    });
    if (result.status !== 0) {
      throw new HarnessInvocationError(spec.id, result.status ?? -1, result.stderr ?? "", result.stdout ?? "");
    }

    // Parse the JSONL stream: the LAST assistant message_end with text is the
    // final answer (earlier ones are tool-call rounds).
    let text = "";
    let observedProviderRaw: string | null = null;
    let observedModel: string | null = null;
    for (const rawLine of (result.stdout ?? "").split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("{")) continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type !== "message_end") continue;
      const message = event.message as PiMessage | undefined;
      if (message?.role !== "assistant") continue;
      if (typeof message.provider === "string") observedProviderRaw = message.provider;
      if (typeof message.model === "string") observedModel = message.model;
      const parts = (message.content ?? [])
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => (part.text as string).trim())
        .filter(Boolean);
      if (parts.length) text = parts.join("\n");
    }
    if (!text) {
      throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", "harness returned no final assistant message");
    }
    return { text, observedProviderRaw, observedModel };
  }
}

registerDriver(new PiDriver());
