/**
 * Binding probe: verifies a (harness, model, variant) selection end-to-end
 * with two INDEPENDENT assertions (registry probe_policy):
 *
 *   1. capability  — the harness really used a tool: a random token exists
 *                    only inside a file on disk, so echoing it proves a real
 *                    file read, not model recall.
 *   2. attribution — which provider/model actually served the call, observed
 *                    on the wire where the harness supports it
 *                    (attribution.observed_by_driver), declared otherwise.
 *
 * Verdicts: pass | pass_provider_unverified | fail_capability |
 * attribution_mismatch | error. An unobservable provider can never yield a
 * full pass. Probes are serialized by callers (probe_policy.serialize):
 * overlapping runs produced false timeouts when this was designed.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import "./drivers.js"; // side-effect: registers built-in drivers
import type { EvalContext, HarnessSpec } from "../config/types.js";
import { fromRepoRoot } from "../lib/paths.js";
import { AdapterTarget, adapterSpec, harnessEnvOverrides, readTargets, status as adapterStatus } from "./adapter.js";
import { driverFor } from "./driver.js";
import { HarnessProgress } from "./progress.js";
import { HarnessNotFoundError, resolveBinary } from "./shared.js";

export type ProbeVerdict = "pass" | "pass_provider_unverified" | "fail_capability" | "attribution_mismatch" | "error";

export interface ProbeResult {
  probe_id: string;
  harness: string;
  /** Set when the probe ran through a protocol adapter. */
  adapter: { id: string; target: string; provider_id: string; model: string } | null;
  requested: { model: string | null; variant: string | null };
  verdict: ProbeVerdict;
  latency_ms: number;
  started_utc: string;
  capability: {
    tool_use_asserted: boolean;
    error: string | null;
  };
  attribution: {
    method: string | null;
    observed: boolean;
    provider: { value: string | null; raw: string | null; source: "wire" | "declared" | "inferred_from_binding" };
    model: { value: string | null; source: "wire" | "declared" };
    credential_route: string | null;
  };
  binary: { path: string | null; version: string | null };
}

export const PROBES_DIR = () => fromRepoRoot("evaluation", "artifacts", "probes");

const PROBE_PROMPT =
  "Read the file token.txt in the current directory and reply with only the token value, nothing else.";

/** Best-effort `<binary> --version` first line; never throws. */
function binaryVersion(binaryPath: string): string | null {
  try {
    const stdout = execFileSync(binaryPath, ["--version"], { encoding: "utf-8", timeout: 20_000 });
    return stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/** Canonicalize a raw wire provider string via registry provider_aliases. */
function canonicalProvider(ctx: EvalContext, raw: string | null): { id: string | null; route: string | null } {
  if (!raw) return { id: null, route: null };
  const alias = ctx.registry.provider_aliases?.[raw];
  if (alias) return { id: alias.provider_id, route: alias.credential_route ?? null };
  return { id: raw, route: null };
}

export interface ProbeOptions {
  model?: string | null;
  variant?: string | null;
  /** Override the registry probe timeout (milliseconds). */
  timeoutMs?: number;
  /** Route the probe through a protocol adapter to this target (an adapter
   * target name). Behind the adapter the wire PROVIDER claim is meaningless
   * (registry adapters[].attribution_rule) — verification shifts to the
   * MODEL id, and provider is inferred from the target's binding. */
  adapterTarget?: string | null;
}

export async function runProbe(ctx: EvalContext, harnessId: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const spec: HarnessSpec = ctx.harness(harnessId);
  const probeId = `${harnessId}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
  const startedUtc = new Date().toISOString();
  const token = `PROBE-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  const fixtureDir = path.join(PROBES_DIR(), `.fixture-${probeId}`);
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, "token.txt"), `token=${token}\n`);

  const declaredMethod = spec.attribution?.method ?? null;
  const observedByDriver = spec.attribution?.observed_by_driver === true;
  const timeoutMs = options.timeoutMs ?? spec.probe?.timeout_ms ?? 240_000;

  let binaryPath: string | null = null;
  let verdict: ProbeVerdict = "error";
  let capabilityError: string | null = null;
  let toolUse = false;
  let rawProvider: string | null = null;
  let observedModel: string | null = null;
  let resolvedModel: string | null = options.model ?? null;
  // Declared out here so the catch below can close the narrative on a call
  // that never got as far as returning.
  let probeProgress: HarnessProgress | null = null;
  const t0 = Date.now();

  // Adapter routing: resolve the target, require a healthy adapter, and
  // override the harness env to point at the proxy.
  let adapterInfo: ProbeResult["adapter"] = null;
  let adapterEnv: Record<string, string> | undefined;
  if (options.adapterTarget) {
    const adapter = adapterSpec(ctx);
    const target: AdapterTarget | undefined = readTargets(ctx, adapter).find((entry) => entry.name === options.adapterTarget);
    if (!target) throw new Error(`unknown adapter target '${options.adapterTarget}' — declare it in ${adapter.run.targets_artifact}`);
    const state = await adapterStatus(ctx, adapter.id);
    if (!state.healthy) throw new Error(`adapter '${adapter.id}' is not running/healthy — start it first (cesium-eval adapter start)`);
    // Preflight: a target whose credential never reached the proxy cannot
    // succeed — fail HERE with the remediation instead of spending a real
    // harness call to discover 'Missing credentials' downstream.
    const targetState = state.targets.find((entry) => entry.name === target.name);
    if (targetState?.credential_ready === false) {
      throw new Error(`adapter target '${target.name}' has no credential: ${targetState.credential_hint ?? "set its env var and restart the adapter"}`);
    }
    adapterEnv = harnessEnvOverrides(ctx, harnessId, adapter.id);
    adapterInfo = { id: adapter.id, target: target.name, provider_id: target.provider_id, model: target.name };
  }

  try {
    binaryPath = resolveBinary(spec);
    const driver = driverFor(spec);
    // Probe the binding the pipeline would actually use: explicit model >
    // live discovery > registry default (mirrors invoke.resolveModel). Left
    // implicit, a harness falls back to its OWN local default and the probe
    // verifies somebody else's binding — observed live: opencode drifting to
    // its local openai default instead of the registry's github-copilot one.
    // Through an adapter the model is the TARGET name the proxy maps.
    resolvedModel = adapterInfo
      ? adapterInfo.model
      : (options.model ?? driver.discoverDefaultModel?.(spec) ?? spec.default_model);
    const call = {
      prompt: PROBE_PROMPT,
      system: null,
      model: resolvedModel,
      variant: options.variant ?? null,
      cwd: fixtureDir,
      timeoutSeconds: Math.ceil(timeoutMs / 1000),
      env: adapterEnv,
      // Probes are the first thing run against a fresh runner and the first
      // thing to hang when a credential is wrong, so they get the same live
      // commentary as pipeline calls.
      progress: (probeProgress = new HarnessProgress({
        role: "probe",
        harness: spec.id,
        model: resolvedModel,
        variant: options.variant ?? null,
      })),
    };
    probeProgress.dispatch({ timeout: `${call.timeoutSeconds}s`, adapter: adapterInfo?.id });

    let text: string;
    if (driver.invokeStructured) {
      const structured = await driver.invokeStructured(spec, call);
      text = structured.text;
      rawProvider = structured.observedProviderRaw;
      observedModel = structured.observedModel;
    } else {
      text = await driver.invoke(spec, call);
    }
    probeProgress.finish({ toolUse: String(text.includes(token)) });
    toolUse = text.includes(token);
    if (!toolUse) capabilityError = "token absent from response (no tool use observed)";
  } catch (error: any) {
    capabilityError = error instanceof HarnessNotFoundError ? `not installed: ${error.message}` : String(error?.message ?? error);
    probeProgress?.fail(capabilityError);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
  const latencyMs = Date.now() - t0;

  // Attribution: observed (wire) beats declared. The expected provider is the
  // harness's registry binding; a wire mismatch is its own failure mode.
  //
  // ADAPTER BINDINGS invert this (adapters[].attribution_rule): behind the
  // proxy the harness believes it talks to its own first party, so the wire
  // PROVIDER claim is meaningless (observed live: Claude Code said
  // 'firstParty' while gpt-5.5 served the call). The MODEL id stays truthful
  // because the proxy maps model names — so verification shifts to the model.
  const providerObserved = rawProvider !== null && adapterInfo === null;
  const canonical = canonicalProvider(ctx, rawProvider);
  const expectedProvider = adapterInfo?.provider_id ?? spec.provider ?? null;

  if (capabilityError !== null && !toolUse) {
    verdict = capabilityError.startsWith("not installed") ? "error" : capabilityError.includes("token absent") ? "fail_capability" : "error";
  } else if (adapterInfo) {
    verdict = observedModel !== null && observedModel !== adapterInfo.model ? "attribution_mismatch" : "pass";
  } else if (providerObserved && expectedProvider && canonical.id !== expectedProvider) {
    verdict = "attribution_mismatch";
  } else if (providerObserved) {
    verdict = "pass";
  } else {
    // Capability proven but the provider was not observable on this path
    // (probe_policy: this can never be a full pass).
    verdict = "pass_provider_unverified";
  }

  const result: ProbeResult = {
    probe_id: probeId,
    harness: harnessId,
    adapter: adapterInfo,
    requested: { model: resolvedModel, variant: options.variant ?? null },
    verdict,
    latency_ms: latencyMs,
    started_utc: startedUtc,
    capability: { tool_use_asserted: toolUse, error: capabilityError },
    attribution: {
      method: declaredMethod,
      observed: providerObserved,
      provider: {
        value: providerObserved ? canonical.id : expectedProvider,
        raw: rawProvider,
        source: adapterInfo
          ? "inferred_from_binding"
          : providerObserved
            ? "wire"
            : spec.attribution?.provider_source === "inferred_from_binding"
              ? "inferred_from_binding"
              : "declared",
      },
      model: {
        value: observedModel ?? resolvedModel ?? spec.default_model,
        source: observedModel ? "wire" : "declared",
      },
      credential_route: adapterInfo ? "adapter" : (canonical.route ?? spec.credential_route ?? null),
    },
    binary: { path: binaryPath, version: binaryPath ? binaryVersion(binaryPath) : null },
  };

  // Persist for the console's harness-health panel (evaluation/artifacts/ is
  // local-only by .gitignore policy, like every other run artifact).
  fs.mkdirSync(PROBES_DIR(), { recursive: true });
  fs.writeFileSync(path.join(PROBES_DIR(), `${probeId}.json`), JSON.stringify(result, null, 2) + "\n");
  if (!observedByDriver && providerObserved) {
    // Registry said unobservable but the driver observed something — the
    // registry is stale; surface loudly rather than silently diverging.
    console.error(`[probe] note: ${harnessId} observed attribution although registry declares observed_by_driver=false`);
  }
  return result;
}

/** Latest persisted NATIVE probe per harness id, for the console health
 * panel. Adapter probes are a different binding (they verify an adapter
 * target, not the harness's registry provider) — showing one on the harness
 * row would misattribute it, so they surface in the adapter panel instead. */
export function latestProbes(): Record<string, ProbeResult> {
  const dir = PROBES_DIR();
  const latest: Record<string, ProbeResult> = {};
  if (!fs.existsSync(dir)) return latest;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as ProbeResult;
      if (parsed?.harness && !parsed.adapter) latest[parsed.harness] = parsed; // sorted names => last wins
    } catch {
      // skip unreadable artifacts
    }
  }
  return latest;
}
