/**
 * Harness health + probe orchestration for the console. Availability comes
 * from the registry's binary resolution (binary_candidates then PATH); probe
 * results are the persisted artifacts under evaluation/artifacts/probes/.
 * Probes are SERIALIZED per registry probe_policy — one in flight, ever; a
 * second request gets a 409 from the route via ProbeBusyError.
 */
import type { EvalContext, HarnessSpec } from "../config/types.js";
import { registeredDrivers } from "../harness/driver.js";
import { ProbeResult, latestProbes, runProbe } from "../harness/probe.js";
import { resolveBinary } from "../harness/shared.js";

export class ProbeBusyError extends Error {}

export interface HarnessHealthRow {
  id: string;
  name: string;
  provider: string | null;
  provider_label: string | null;
  credential_route: string | null;
  auth: string | null;
  roles: string[];
  multimodal: boolean;
  vision_note: string | null;
  default_model: string;
  driver_registered: boolean;
  available: boolean;
  availability_error: string | null;
  attribution_method: string | null;
  attribution_observed_by_driver: boolean;
  probe_timeout_ms: number | null;
  quirks: string[];
  docs_url: string | null;
  last_probe: ProbeResult | null;
}

function healthRow(spec: HarnessSpec, drivers: string[], lastProbe: ProbeResult | null): HarnessHealthRow {
  let available = false;
  let availabilityError: string | null = null;
  try {
    resolveBinary(spec);
    available = true;
  } catch (error: any) {
    availabilityError = String(error?.message ?? error);
  }
  return {
    id: spec.id,
    name: spec.name,
    provider: spec.provider ?? null,
    provider_label: spec.provider_label ?? null,
    credential_route: spec.credential_route ?? null,
    auth: spec.auth ?? null,
    roles: spec.roles ?? [],
    multimodal: spec.multimodal,
    vision_note: spec.vision_note ?? null,
    default_model: spec.default_model,
    driver_registered: drivers.includes(spec.id),
    available,
    availability_error: availabilityError,
    attribution_method: spec.attribution?.method ?? null,
    attribution_observed_by_driver: spec.attribution?.observed_by_driver === true,
    probe_timeout_ms: spec.probe?.timeout_ms ?? null,
    quirks: spec.quirks ?? [],
    docs_url: spec.docs_url ?? null,
    last_probe: lastProbe,
  };
}

export function harnessHealth(ctx: EvalContext): { harnesses: HarnessHealthRow[] } {
  const drivers = registeredDrivers();
  const probes = latestProbes();
  return {
    harnesses: ctx.registry.harnesses.map((spec) => healthRow(spec, drivers, probes[spec.id] ?? null)),
  };
}

// One probe in flight, ever (probe_policy.serialize): overlapping probes
// produced false timeouts when this was designed.
let probeInFlight: string | null = null;

export async function probeHarness(
  ctx: EvalContext,
  payload: Record<string, any>,
): Promise<ProbeResult> {
  const harnessId = String(payload.harness ?? "");
  const known = ctx.registry.harnesses.map((spec) => spec.id);
  if (!known.includes(harnessId)) {
    throw new Error(`unknown harness: '${harnessId}' (registry declares: ${known.join(", ")})`);
  }
  if (!registeredDrivers().includes(harnessId)) {
    throw new Error(`harness '${harnessId}' has no driver (drivers exist for: ${registeredDrivers().join(", ")})`);
  }
  const model = payload.model ? String(payload.model) : null;
  const variant = payload.variant ? String(payload.variant) : null;
  if (model && (model.length > 200 || !/^[\w./:-]+$/.test(model))) throw new Error("invalid model");
  if (variant && (variant.length > 32 || !/^[\w-]+$/.test(variant))) throw new Error("invalid variant");

  if (probeInFlight) {
    throw new ProbeBusyError(`a probe of '${probeInFlight}' is already running; probes are serialized by policy`);
  }
  probeInFlight = harnessId;
  try {
    return await runProbe(ctx, harnessId, { model, variant });
  } finally {
    probeInFlight = null;
  }
}
