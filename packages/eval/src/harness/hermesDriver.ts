/**
 * Driver for Hermes Agent (`hermes -z <prompt> --usage-file <path>`).
 *
 * The usage file carries wire-OBSERVED attribution: {provider, model} for the
 * call that actually ran (raw strings like "openai-codex" are ROUTE labels and
 * normalize through the registry's provider_aliases). Text-only on this
 * install; the prompt travels as an argv argument (-z), so extremely large
 * prompts risk ARG_MAX limits — noted in the registry entry.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HarnessSpec } from "../config/types.js";
import { AgentCall, HarnessDriver, StructuredInvocation, registerDriver } from "./driver.js";
import { reportPlainTextLine } from "./progress.js";
import { HarnessInvocationError, cleanSubprocessEnv, formatPrompt, resolveBinary, runSubprocess } from "./shared.js";

class HermesDriver implements HarnessDriver {
  readonly id = "hermes";

  ensureAvailable(spec: HarnessSpec): string {
    return resolveBinary(spec);
  }

  async invoke(spec: HarnessSpec, call: AgentCall): Promise<string> {
    return (await this.invokeStructured(spec, call)).text;
  }

  async invokeStructured(spec: HarnessSpec, call: AgentCall): Promise<StructuredInvocation> {
    const binary = this.ensureAvailable(spec);
    const workdir = path.resolve(call.cwd ?? process.cwd());
    const usagePath = path.join(
      os.tmpdir(),
      `cesium-eval-hermes-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );

    const argv = ["-z", formatPrompt(call.prompt, call.system), "--usage-file", usagePath];
    // Hermes's native provider switch (hermes --provider); models are
    // provider-scoped, so an explicit provider pins routing.
    if (call.provider) argv.push("--provider", call.provider);
    if (call.model) argv.push("-m", call.model);
    // variant intentionally unused: no per-call effort flag is verified for
    // hermes (registry effort_mechanism: null). addDirs/allowedTools have no
    // hermes equivalent on this driver path; Hermes manages its own toolsets.

    try {
      const result = await runSubprocess(binary, argv, {
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

      let observedProviderRaw: string | null = null;
      let observedModel: string | null = null;
      try {
        const usage = JSON.parse(fs.readFileSync(usagePath, "utf-8"));
        if (usage?.failed === true) {
          throw new HarnessInvocationError(spec.id, 0, result.stderr ?? "", "hermes usage file reports the run failed");
        }
        if (typeof usage?.provider === "string") observedProviderRaw = usage.provider;
        if (typeof usage?.model === "string") observedModel = usage.model;
      } catch (error) {
        if (error instanceof HarnessInvocationError) throw error;
        // Usage file unreadable: keep the text, report attribution unobserved.
      }
      return { text, observedProviderRaw, observedModel };
    } finally {
      fs.rmSync(usagePath, { force: true });
    }
  }
}

registerDriver(new HermesDriver());
