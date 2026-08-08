/**
 * Driver for Claude Code (`claude -p --output-format stream-json --verbose`).
 *
 * The terminal `{"type":"result"}` line carries wire-OBSERVED attribution:
 * modelUsage reports the canonical model and provider ("firstParty" ==
 * Anthropic subscription) that actually served the call, so probes get
 * observed — not declared — identity. Image inputs work natively in headless
 * mode (the Read tool renders image files); files are referenced in the prompt
 * and their directories allowed via --add-dir.
 *
 * WHY stream-json RATHER THAN json
 *
 * The plain `json` format buffers everything and emits one object at exit, so
 * a multi-minute call was a blank log. `stream-json` emits the SAME result
 * envelope as its last line, preceded by the per-turn assistant/tool events —
 * so switching costs nothing at the end and gains the whole play-by-play in
 * the middle. `--verbose` is required by the CLI for stream-json under -p.
 */
import * as path from "node:path";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, StructuredInvocation, registerDriver } from "./driver.js";
import type { HarnessProgress } from "./progress.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

interface ClaudeJsonEnvelope {
  result?: unknown;
  is_error?: unknown;
  modelUsage?: Record<string, { canonicalModel?: unknown; provider?: unknown }>;
}

/**
 * Pull the result envelope out of a stream-json stdout: the LAST line whose
 * type is "result". Scanning for the last line rather than the last `{`..`}`
 * span matters now that stdout holds many objects — the old whole-buffer brace
 * scan would splice unrelated events into one unparseable blob.
 */
function parseEnvelope(stdout: string): ClaudeJsonEnvelope | null {
  let envelope: ClaudeJsonEnvelope | null = null;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type === "result") envelope = parsed as ClaudeJsonEnvelope;
  }
  return envelope;
}

/**
 * Translate one stream-json line into live commentary.
 *
 * Assistant messages arrive as content blocks: `text` for prose, `thinking`
 * for extended reasoning, `tool_use` for a call the model is making. The
 * matching `user` message carries `tool_result` blocks — that pairing is what
 * lets the log show a tool starting and then settling, rather than a wall of
 * calls with no outcomes.
 */
export function reportClaudeEvent(progress: HarnessProgress, line: string): void {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event || typeof event.type !== "string") return;

  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        progress.emit({
          kind: "session",
          label: "session",
          detail: { id: event.session_id, model: event.model, tools: Array.isArray(event.tools) ? event.tools.length : undefined },
        });
      }
      // Hook chatter and post-turn summaries are Claude Code's own bookkeeping,
      // not agent activity; reporting them would drown the useful events.
      return;

    case "assistant": {
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of blocks) {
        if (block?.type === "text") {
          progress.emitDelta(`msg:${event.message?.id}:${block.type}`, "message", "assistant", String(block.text ?? ""));
        } else if (block?.type === "thinking") {
          progress.emitDelta(`think:${event.message?.id}`, "thinking", "reasoning", String(block.thinking ?? ""));
        } else if (block?.type === "tool_use") {
          const input = block.input ?? {};
          const summary = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.prompt ?? Object.keys(input).join(",");
          progress.emit({ kind: "tool", label: String(block.name ?? "tool"), text: String(summary ?? ""), detail: { state: "running" } });
        }
      }
      const usage = event.message?.usage;
      if (usage) {
        progress.usage({
          input: usage.input_tokens,
          output: usage.output_tokens,
          cached: usage.cache_read_input_tokens,
        });
      }
      return;
    }

    case "user": {
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
      for (const block of blocks) {
        if (block?.type !== "tool_result") continue;
        const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        // Capped HERE rather than left to the reporter's verbosity: a tool
        // result is arbitrary file or command output, and at `full` an agent
        // that read a credential file would spill it into a CI log. The gist
        // is what makes the call legible; the bytes are not.
        progress.emit({
          kind: "tool",
          label: "result",
          text: content.slice(0, 200),
          detail: { state: block.is_error ? "error" : "ok", bytes: content.length },
        });
      }
      return;
    }

    case "rate_limit_event": {
      const info = event.rate_limit_info ?? {};
      // Only worth a line when it is not the routine "allowed" tick — a
      // throttled run looks exactly like a slow one otherwise.
      if (info.status && info.status !== "allowed") {
        progress.emit({ kind: "notice", label: "rate limit", detail: { status: info.status, type: info.rateLimitType } });
      }
      return;
    }

    case "result":
      if (event.is_error) progress.emit({ kind: "notice", label: "result", text: String(event.result ?? ""), detail: { error: "true" } });
      return;

    default:
      return;
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
    const argv = ["-p", "--output-format", "stream-json", "--verbose"];
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
      onStdoutLine: call.progress?.enabled ? (line) => reportClaudeEvent(call.progress!, line) : undefined,
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
