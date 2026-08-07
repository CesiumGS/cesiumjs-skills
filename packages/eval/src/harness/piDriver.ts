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
import type { HarnessProgress } from "./progress.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

/** Only forward --thinking levels the picked model declares (mirrors the
 * copilot driver's effort handling): pi hard-errors on unsupported levels. */
function thinkingFor(spec: HarnessSpec, call: AgentCall): string | null {
  if (!call.variant) return null;
  const entry: ModelSpec | undefined = call.model ? spec.models.find((model) => model.id === call.model) : undefined;
  if (entry && !(entry.effort_levels ?? []).includes(call.variant)) return null;
  return call.variant;
}

/**
 * Translate one line of `pi -p --mode json` into live commentary.
 *
 * Pi's stream is by far the most granular of the supported harnesses: it emits
 * a `message_update` per TOKEN (`text_delta`, `toolcall_delta`), which would
 * be one log line per token. So this reports the `*_end` boundaries instead —
 * `thinking_end`, `text_end`, `toolcall_end` each carry the settled content —
 * plus the tool-execution and turn events. The result is one line per block of
 * work, matching the other drivers, with the heartbeat covering the gaps.
 *
 * (`thinking_end.content` is empty for providers that return encrypted
 * reasoning rather than a summary, which is why it is only reported when
 * non-empty: a run of blank "reasoning ·" lines is worse than none.)
 */
export function reportPiEvent(progress: HarnessProgress, line: string): void {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event || typeof event.type !== "string") return;

  switch (event.type) {
    case "session":
      progress.emit({ kind: "session", label: "session", detail: { id: event.id } });
      return;
    case "turn_start":
      progress.emit({ kind: "session", label: "turn started" });
      return;
    case "turn_end": {
      const usage = event.message?.usage;
      if (usage) {
        progress.usage({
          input: usage.input,
          output: usage.output,
          reasoning: usage.reasoning,
          cached: usage.cacheRead,
        });
      }
      return;
    }
    case "tool_execution_start":
      progress.emit({
        kind: "tool",
        label: String(event.toolName ?? "tool"),
        text: String(event.args?.command ?? event.args?.path ?? event.args?.filePath ?? Object.keys(event.args ?? {}).join(",")),
        detail: { state: "running" },
      });
      return;
    case "tool_execution_end": {
      const blocks = Array.isArray(event.result?.content) ? event.result.content : [];
      const output = blocks.map((block: any) => String(block?.text ?? "")).join("");
      progress.emit({
        kind: "tool",
        label: String(event.toolName ?? "tool"),
        detail: { state: event.isError ? "error" : "ok", bytes: output.length },
      });
      return;
    }
    case "message_update": {
      const inner = event.assistantMessageEvent ?? {};
      const content = String(inner.content ?? "");
      if (inner.type === "text_end" && content) {
        progress.emit({ kind: "message", label: "assistant", text: content });
      } else if (inner.type === "thinking_end" && content) {
        progress.emit({ kind: "thinking", label: "reasoning", text: content });
      }
      // Every other message_update is a per-token delta; reporting those would
      // be one log line per token. `toolcall_end` is deliberately skipped too:
      // it names the same call that `tool_execution_start` reports a moment
      // later with the same arguments, and reporting both made every tool use
      // take three lines instead of two.
      return;
    }
    default:
      // message_start/message_end/agent_* are envelope bookkeeping already
      // covered by the events above; staying quiet keeps the log readable.
      return;
  }
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
    // Pi's native provider switch: models are provider-scoped, so an explicit
    // provider pins routing instead of pi's silent credential fallback.
    if (call.provider) argv.push("--provider", call.provider);
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
      onStdoutLine: call.progress?.enabled ? (line) => reportPiEvent(call.progress!, line) : undefined,
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
