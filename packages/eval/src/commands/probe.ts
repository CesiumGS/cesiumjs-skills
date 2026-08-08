/**
 * `cesium-eval probe` — verify (harness, model, variant) bindings end-to-end.
 *
 * Two independent assertions per binding (see harness/probe.ts): capability
 * (real tool use via a token-file read) and attribution (which provider/model
 * actually served the call). Probes run SERIALIZED per registry probe_policy:
 * overlapping probes produced false timeouts when this was designed.
 *
 * Exit code 0 when every probed harness reaches pass or
 * pass_provider_unverified; 1 otherwise.
 */
import type { EvalContext } from "../config/types.js";
import { ProbeResult, runProbe } from "../harness/probe.js";
import { registeredDrivers } from "../harness/driver.js";

export interface ProbeCommandOptions {
  harness?: string;
  model?: string;
  variant?: string;
  adapter?: string;
  json?: boolean;
}

function line(result: ProbeResult): string {
  const attribution = result.attribution;
  const provider = attribution.provider.value ?? "unknown";
  const model = attribution.model.value ?? "?";
  const observed = attribution.observed ? "wire" : attribution.provider.source;
  const via = result.adapter ? `  via ${result.adapter.id}:${result.adapter.target}` : "";
  return [
    result.harness.padEnd(12),
    result.verdict.padEnd(26),
    `${String(result.latency_ms).padStart(6)}ms`,
    `${provider}/${model}`,
    `(attribution: ${observed})${via}`,
  ].join("  ");
}

export async function probeCommand(ctx: EvalContext, options: ProbeCommandOptions): Promise<number> {
  const requested = (options.harness ?? "all").trim();
  const known = ctx.registry.harnesses.map((harness) => harness.id);
  const targets = requested === "all" ? known : requested.split(",").map((id) => id.trim());
  for (const target of targets) {
    if (!known.includes(target)) {
      console.error(`error: unknown harness '${target}' (registry declares: ${known.join(", ")})`);
      return 2;
    }
    if (!registeredDrivers().includes(target)) {
      console.error(`error: harness '${target}' has no driver (drivers exist for: ${registeredDrivers().join(", ")})`);
      return 2;
    }
  }
  if (targets.length > 1 && (options.model || options.variant || options.adapter)) {
    console.error("error: --model/--variant/--adapter apply to a single harness; pick one with --harness <id>");
    return 2;
  }

  const results: ProbeResult[] = [];
  for (const target of targets) {
    // Serialized on purpose (probe_policy.serialize).
    const result = await runProbe(ctx, target, {
      model: options.model ?? null,
      variant: options.variant ?? null,
      adapterTarget: options.adapter ?? null,
    });
    results.push(result);
    if (!options.json) console.log(line(result));
  }
  if (options.json) console.log(JSON.stringify({ results }, null, 2));

  const failed = results.filter((result) => result.verdict !== "pass" && result.verdict !== "pass_provider_unverified");
  if (failed.length && !options.json) {
    console.error(`\n${failed.length}/${results.length} probe(s) failed`);
  }
  return failed.length ? 1 : 0;
}
