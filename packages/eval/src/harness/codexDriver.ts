/** Driver for the Codex CLI (`codex exec --json`). */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, registerDriver } from "./driver.js";
import { HarnessInvocationError, HarnessNotFoundError, cleanSubprocessEnv, formatPrompt, runSubprocess, which } from "./shared.js";

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

class CodexDriver implements HarnessDriver {
  readonly id = "codex";

  ensureAvailable(spec: HarnessSpec): string {
    const binary = which(spec.binary);
    if (!binary) {
      throw new HarnessNotFoundError(
        `'${spec.binary}' CLI not found on PATH. Install ${spec.name ?? spec.id} and authenticate (${spec.auth ?? "see registry"}).`,
      );
    }
    return binary;
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
      const result = await runSubprocess(binary, argv, {
        input: formatPrompt(call.prompt, call.system),
        timeoutMs: call.timeoutSeconds * 1000,
        cwd: workdir,
        env,
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
