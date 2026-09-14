/**
 * Harness driver contract. A driver knows how to shell out to one agent CLI.
 * Harness metadata (binaries, models, vision capabilities) lives in the
 * registry (config/harness-registry.json); note that a registry entry is only
 * usable when a driver with the same id is implemented and registered here.
 */
import type { HarnessSpec } from "../config/types.js";
import type { HarnessProgress } from "./progress.js";

export interface AgentCall {
  prompt: string;
  system?: string | null;
  /** Concrete model id, or null to let the harness use its configured default. */
  model: string | null;
  /** Canonical provider id serving the model, or null for the harness's bound
   * default. Models are only provided by providers, so a model choice implies
   * one; drivers route it natively (pi/hermes --provider, opencode prefix,
   * codex model_provider) and FAIL LOUDLY when the harness cannot reach it. */
  provider?: string | null;
  /** Reasoning-effort / variant level, or null for the harness default. */
  variant: string | null;
  files?: string[];
  cwd?: string;
  addDirs?: string[];
  allowedTools?: string[];
  disableTools?: boolean;
  title?: string | null;
  timeoutSeconds: number;
  /** Extra env for the subprocess (adapter routing: base-url + key overrides).
   * Merged AFTER the clean env, so deliberate overrides win. */
  env?: Record<string, string>;
  /** Live commentary sink. Drivers translate their CLI's own event stream into
   * reporter events as the lines arrive; when absent (direct driver calls,
   * tests) they simply skip it. Never load-bearing for the returned text. */
  progress?: HarnessProgress;
}

/** One structured call: the assistant text plus wire-OBSERVED attribution
 * (which provider/model actually served it), when the harness surfaces it.
 * Raw provider strings normalize through the registry's provider_aliases. */
export interface StructuredInvocation {
  text: string;
  /** Provider string as reported on the wire (e.g. "firstParty", "openai-codex"), or null when unobservable. */
  observedProviderRaw: string | null;
  /** Model id as reported on the wire, or null when unobservable. */
  observedModel: string | null;
}

export interface HarnessDriver {
  readonly id: string;
  /** Absolute path to the binary; throws HarnessNotFoundError when missing. */
  ensureAvailable(spec: HarnessSpec): string;
  /** Optionally discover the live default model (e.g. `opencode models ...`). */
  discoverDefaultModel?(spec: HarnessSpec): string | null;
  /** Run one non-interactive call and return the assistant text (async; the
   * event loop stays free for signals and concurrent panel calls). */
  invoke(spec: HarnessSpec, call: AgentCall): Promise<string>;
  /** Like invoke, but also extracts observed attribution where this harness's
   * output path supports it (registry attribution.observed_by_driver). */
  invokeStructured?(spec: HarnessSpec, call: AgentCall): Promise<StructuredInvocation>;
}

const DRIVERS = new Map<string, HarnessDriver>();

export function registerDriver(driver: HarnessDriver): void {
  if (DRIVERS.has(driver.id)) throw new Error(`duplicate harness driver: ${driver.id}`);
  DRIVERS.set(driver.id, driver);
}

export function driverFor(spec: HarnessSpec): HarnessDriver {
  const driver = DRIVERS.get(spec.id);
  if (!driver) {
    throw new Error(
      `no driver implemented for harness '${spec.id}' (registry declares it, drivers exist for: ${[...DRIVERS.keys()].join(", ")})`,
    );
  }
  return driver;
}

export function registeredDrivers(): string[] {
  return [...DRIVERS.keys()].sort();
}
