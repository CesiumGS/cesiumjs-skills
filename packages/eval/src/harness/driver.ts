/**
 * Harness driver contract. A driver knows how to shell out to one agent CLI.
 * Harness metadata (binaries, models, vision capabilities) lives in the
 * registry (config/harness-registry.json); note that a registry entry is only
 * usable when a driver with the same id is implemented and registered here.
 */
import type { HarnessSpec } from "../config/types.js";

export interface AgentCall {
  prompt: string;
  system?: string | null;
  /** Concrete model id, or null to let the harness use its configured default. */
  model: string | null;
  /** Reasoning-effort / variant level, or null for the harness default. */
  variant: string | null;
  files?: string[];
  cwd?: string;
  addDirs?: string[];
  allowedTools?: string[];
  disableTools?: boolean;
  title?: string | null;
  timeoutSeconds: number;
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
