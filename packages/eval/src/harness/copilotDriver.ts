/** Driver for the GitHub Copilot CLI (`copilot --silent`, prompt on stdin). */
import * as path from "node:path";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, registerDriver } from "./driver.js";
import { reportPlainTextLine } from "./progress.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

/** Friendly tool names accepted from callers, mapped to Copilot CLI tool ids. */
const TOOL_NAMES: Record<string, string> = {
  Read: "view",
  Grep: "rg",
  Glob: "glob",
  Bash: "bash",
  Edit: "apply_patch",
  Write: "apply_patch",
};

/**
 * `--available-tools=<csv>` filters which tools the model can see; an empty
 * list hides everything (verified: read-only tools run without approval
 * prompts in non-interactive mode, so no --allow-tool patterns are needed
 * for the read/search surface the pipeline uses).
 */
function availableToolsArg(call: AgentCall): string | null {
  if (call.disableTools) return "--available-tools=";
  if (!call.allowedTools) return null;
  const tools = [...new Set(call.allowedTools.map((tool) => TOOL_NAMES[tool] ?? tool.toLowerCase()))];
  return `--available-tools=${tools.join(",")}`;
}

/**
 * The Copilot CLI hard-errors when --effort targets a model without reasoning
 * effort support, and the pipeline always resolves a variant (harness
 * default_effort). Consult the catalog: only forward levels the model
 * declares. Unknown models pass through so the CLI can report honestly.
 */
function effortFor(spec: HarnessSpec, call: AgentCall): string | null {
  if (!call.variant) return null;
  const entry = call.model ? spec.models.find((model) => model.id === call.model) : undefined;
  if (entry && !(entry.effort_levels ?? []).includes(call.variant)) return null;
  return call.variant;
}

class CopilotDriver implements HarnessDriver {
  readonly id = "copilot";

  ensureAvailable(spec: HarnessSpec): string {
    return resolveBinary(spec);
  }

  async invoke(spec: HarnessSpec, call: AgentCall): Promise<string> {
    // The Copilot CLI bills through the GitHub broker only; other providers
    // are BYOK config, not a per-call switch. Fail loudly, never reroute.
    if (call.provider && call.provider !== (spec.provider ?? "github-copilot")) {
      throw new Error(
        `copilot reaches only '${spec.provider ?? "github-copilot"}' per call; ` +
          `provider '${call.provider}' needs its BYOK configuration or the protocol adapter.`,
      );
    }
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());

    // Piped stdin puts the CLI in non-interactive mode; --silent restricts
    // stdout to the assistant response. The prompt travels on stdin (not -p)
    // to avoid argv length limits on large skill-document prompts.
    // Keep the pinned CI surface deterministic and prevent read-only tools from
    // inspecting unrelated files left in the shared system temp directory.
    // Copilot already restricts paths to the checkout by default; this removes
    // its one implicit outside-worktree exception.
    const argv = [
      "--silent",
      "--no-color",
      "--no-ask-user",
      "--no-auto-update",
      "--disallow-temp-dir",
      "--log-level",
      "none",
      "-C",
      workdir,
    ];
    if (call.model) argv.push("--model", call.model);
    const effort = effortFor(spec, call);
    if (effort) argv.push("--effort", effort);
    for (const dir of call.addDirs ?? []) argv.push("--add-dir", path.resolve(dir));
    for (const file of call.files ?? []) argv.push("--attachment", path.resolve(file));
    const availableTools = availableToolsArg(call);
    if (availableTools !== null) argv.push(availableTools);
    if (call.title) argv.push("--name", call.title);

    const result = await runSubprocess(binary, argv, {
      input: formatPrompt(call.prompt, call.system),
      timeoutMs: call.timeoutSeconds * 1000,
      cwd: workdir,
      env: cleanSubprocessEnv(),
      // This CLI emits prose, not events: the live signal is the answer
      // arriving line by line (see reportPlainTextLine).
      onStdoutLine: call.progress?.enabled ? (line) => reportPlainTextLine(call.progress!, line) : undefined,
    });
    if (result.status !== 0) {
      throw new HarnessInvocationError(spec.id, result.status ?? -1, result.stderr ?? "", result.stdout ?? "");
    }
    const text = (result.stdout ?? "").trim();
    if (!text) {
      throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", "harness returned no assistant text");
    }
    return text;
  }
}

registerDriver(new CopilotDriver());
