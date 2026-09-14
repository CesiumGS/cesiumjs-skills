/** Driver for the Codex CLI (`codex exec --json`). */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, registerDriver } from "./driver.js";
import type { HarnessProgress } from "./progress.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

/**
 * Optional profile support: `CODEX_PROFILE` (or `CODEX_<ROLE>_PROFILE`,
 * resolved by the invoker) selects `~/.codex/<profile>.config.toml`. The
 * `copilot` profile bills text work to the GitHub Copilot subscription; its
 * bearer token is injected from opencode's stored credential when present.
 */
export const COPILOT_PROFILE = "copilot";
export const COPILOT_TOKEN_ENV = "COPILOT_GHO_TOKEN";
export const OPENCODE_AUTH_PATH = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");

export function readCopilotGhoToken(): string | null {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(OPENCODE_AUTH_PATH, "utf-8"));
  } catch {
    return null;
  }
  const cred = data?.["github-copilot"];
  if (cred === null || typeof cred !== "object") return null;
  const token = cred.refresh || cred.access;
  return typeof token === "string" && token ? token : null;
}

export interface CodexCall extends AgentCall {
  profile?: string | null;
}

/**
 * Translate one line of `codex exec --json` into live commentary.
 *
 * The stream is thread/turn/item shaped: `thread.started`, `turn.started`,
 * then `item.started` / `item.updated` / `item.completed` for each unit of
 * work (agent_message, reasoning, command_execution, file_change,
 * mcp_tool_call, web_search, todo_list, error), closing with `turn.completed`
 * and its usage block. We report the transitions that tell a reader what the
 * agent is DOING; the redundant ones (a completed message whose text already
 * streamed) are folded by the reporter's delta tracking.
 *
 * Unknown event and item types are reported by name rather than dropped: a
 * codex release that adds one should show up in the log as something new, not
 * as silence.
 */
export function reportCodexEvent(progress: HarnessProgress, line: string): void {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return; // non-JSON chatter on stdout; the CLI's own logging
  }
  if (!event || typeof event.type !== "string") return;

  switch (event.type) {
    case "thread.started":
      progress.emit({ kind: "session", label: "thread", detail: { id: event.thread_id } });
      return;
    case "turn.started":
      progress.emit({ kind: "session", label: "turn started" });
      return;
    case "turn.completed": {
      const usage = event.usage ?? {};
      progress.usage({
        input: usage.input_tokens,
        output: usage.output_tokens,
        reasoning: usage.reasoning_output_tokens,
        cached: usage.cached_input_tokens,
      });
      return;
    }
    case "turn.failed":
      progress.emit({ kind: "notice", label: "turn failed", text: String(event.error?.message ?? event.error ?? "") });
      return;
    case "item.started":
    case "item.updated":
    case "item.completed":
      break;
    default:
      progress.emit({ kind: "notice", label: event.type });
      return;
  }

  const item = event.item ?? {};
  const id = String(item.id ?? "item");
  const done = event.type === "item.completed";

  switch (item.type) {
    case "agent_message":
      // Deltas only: `item.completed` re-sends the whole message that
      // `item.updated` already streamed.
      progress.emitDelta(`msg:${id}`, "message", "assistant", String(item.text ?? ""));
      return;
    case "reasoning":
      progress.emitDelta(`think:${id}`, "thinking", "reasoning", String(item.text ?? item.summary ?? ""));
      return;
    case "command_execution": {
      const command = String(item.command ?? "");
      if (!done) {
        progress.emit({ kind: "tool", label: "shell", text: command, detail: { state: "running" } });
        return;
      }
      const output = String(item.aggregated_output ?? "");
      progress.emit({
        kind: "tool",
        label: "shell",
        text: command,
        detail: {
          state: item.exit_code === 0 ? "ok" : "exit " + String(item.exit_code ?? "?"),
          lines: output ? output.trimEnd().split("\n").length : 0,
        },
      });
      return;
    }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      progress.emit({
        kind: "tool",
        label: "edit",
        text: changes.map((change: any) => `${change.kind ?? "change"} ${change.path ?? ""}`.trim()).join(", "),
        detail: { state: done ? "applied" : "running", files: changes.length },
      });
      return;
    }
    case "mcp_tool_call":
      progress.emit({
        kind: "tool",
        label: `mcp:${item.server ?? "?"}/${item.tool ?? "?"}`,
        detail: { state: done ? (item.status ?? "done") : "running" },
      });
      return;
    case "web_search":
      progress.emit({ kind: "tool", label: "web_search", text: String(item.query ?? ""), detail: { state: done ? "done" : "running" } });
      return;
    case "todo_list": {
      const items = Array.isArray(item.items) ? item.items : [];
      if (!done) return; // the partial list is noise; the settled one is a plan
      progress.emit({
        kind: "notice",
        label: "plan",
        text: items.map((entry: any) => String(entry.text ?? entry)).join(" | "),
        detail: { steps: items.length },
      });
      return;
    }
    case "error":
      if (done) progress.emit({ kind: "notice", label: "harness", text: String(item.message ?? "") });
      return;
    default:
      if (done) progress.emit({ kind: "tool", label: String(item.type ?? "item"), detail: { state: "done" } });
  }
}

class CodexDriver implements HarnessDriver {
  readonly id = "codex";

  ensureAvailable(spec: HarnessSpec): string {
    return resolveBinary(spec);
  }

  async invoke(spec: HarnessSpec, call: CodexCall): Promise<string> {
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());
    const outputPath = path.join(
      os.tmpdir(),
      `cesium-eval-codex-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const argv = ["exec", "--json", "--sandbox", "read-only", "--cd", workdir, "--output-last-message", outputPath];
    if (call.profile) argv.push("-p", call.profile);
    // Non-native providers route via codex's model_providers config; an
    // unknown id fails loudly in codex itself rather than silently rerouting.
    if (call.provider && call.provider !== (spec.provider ?? "openai")) {
      argv.push("-c", `model_provider="${call.provider}"`);
    }
    if (call.model) argv.push("--model", call.model);
    if (call.variant) argv.push("-c", `model_reasoning_effort="${call.variant}"`);
    for (const dir of call.addDirs ?? []) argv.push("--add-dir", path.resolve(dir));
    for (const file of call.files ?? []) argv.push("--image", path.resolve(file));
    if (call.disableTools) argv.push("--ignore-rules");
    // codex exec has no per-tool allow-list; allowedTools is accepted for API
    // symmetry and intentionally unused here.
    argv.push("-");

    const env = cleanSubprocessEnv();
    if (call.profile === COPILOT_PROFILE && !(COPILOT_TOKEN_ENV in env)) {
      const token = readCopilotGhoToken();
      if (!token) {
        throw new HarnessInvocationError(
          spec.id,
          1,
          `codex '${COPILOT_PROFILE}' profile requested but no GitHub Copilot token was found in ${OPENCODE_AUTH_PATH}. ` +
            "Authenticate Copilot in opencode first.",
          "",
        );
      }
      env[COPILOT_TOKEN_ENV] = token;
    }

    let text = "";
    try {
      const progress = call.progress;
      const result = await runSubprocess(binary, argv, {
        input: formatPrompt(call.prompt, call.system),
        timeoutMs: call.timeoutSeconds * 1000,
        cwd: workdir,
        env,
        onStdoutLine: progress?.enabled ? (line) => reportCodexEvent(progress, line) : undefined,
      });
      try {
        text = fs.readFileSync(outputPath, "utf-8").trim();
      } catch {
        text = "";
      }
      if (result.status !== 0) {
        throw new HarnessInvocationError(spec.id, result.status ?? -1, result.stderr ?? "", result.stdout ?? "");
      }
      if (!text) {
        throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", "harness returned no final assistant message");
      }
    } finally {
      fs.rmSync(outputPath, { force: true });
    }
    return text;
  }
}

registerDriver(new CodexDriver());
