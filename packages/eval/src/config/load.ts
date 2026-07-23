/**
 * Layered configuration: built-in defaults <- eval.config.json <- environment
 * variables <- CLI flags (applied by commands via resolveRole overrides).
 *
 * Environment variables keep the operational surface the pipeline has always
 * had: `<ROLE>_HARNESS` / `AGENT_HARNESS`, `<HARNESS>_<ROLE>_MODEL`,
 * `<HARNESS>_MODEL`, `<HARNESS>_<ROLE>_VARIANT`, `<HARNESS>_VARIANT`, and
 * `AGENT_VISION_FALLBACK{,_MODEL}` — all uppercase, harness/role interpolated
 * from config rather than hardcoded.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Ajv } from "ajv";
import { readJson } from "../lib/json.js";
import { repoRoot as findRepoRoot } from "../lib/paths.js";
import type {
  EvalConfig,
  EvalContext,
  HarnessRegistry,
  HarnessSpec,
  ResolvedAgent,
  RoleConfig,
  RoleName,
} from "./types.js";

export const CONFIG_FILE_NAME = "eval.config.json";
const DEFAULT_TIMEOUT_SECONDS = 600;

/** Structural fallbacks only — every operational choice should live in eval.config.json. */
function builtinDefaults(): EvalConfig {
  const role = (): RoleConfig => ({
    harness: "opencode",
    model: "auto",
    variant: "auto",
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  });
  return {
    registry: "config/harness-registry.json",
    threshold: 0.95,
    roles: { proposer: role(), codegen: role(), judge: role() },
    judgePanel: { size: 3, seeds: [42, 123, 789], pairwiseProtocol: "pairwise-v1", staticProtocol: "static-visual-v1" },
    visionFallback: { enabled: true, model: null },
    browser: {
      cesiumVersion: "1.142",
      viewport: { width: 1280, height: 720 },
      navigationTimeoutMs: 60_000,
      screenshotTimeoutMs: 90_000,
      ionPreflightAssetId: 1,
      tileSettleTimeoutMs: 45_000,
      tileSettlePollMs: 250,
      tileSettleQuietPolls: 3,
    },
    server: { host: "127.0.0.1", port: 8933, pollMs: 2500 },
    liveness: { runningMaxAgeSeconds: 1800 },
  };
}

function deepMerge<T>(base: T, overlay: unknown): T {
  if (overlay === null || overlay === undefined) return base;
  if (Array.isArray(base) || Array.isArray(overlay) || typeof base !== "object" || typeof overlay !== "object") {
    return overlay as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    if (key === "$schema") continue;
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

function validateConfigFile(configPath: string, raw: unknown, root: string): void {
  const schemaPath = path.join(root, "config", "eval.config.schema.json");
  if (!fs.existsSync(schemaPath)) return;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(readJson(schemaPath));
  if (!validate(raw)) {
    const details = (validate.errors ?? [])
      .map((error) => `  ${error.instancePath || "<root>"}: ${error.message}`)
      .join("\n");
    throw new Error(`${configPath} failed schema validation:\n${details}`);
  }
}

function validateRegistry(registry: HarnessRegistry, registryPath: string): void {
  if (!Array.isArray(registry.harnesses) || registry.harnesses.length === 0) {
    throw new Error(`${registryPath}: registry must declare at least one harness`);
  }
  for (const harness of registry.harnesses) {
    for (const field of ["id", "binary", "default_model", "default_effort"] as const) {
      if (typeof harness[field] !== "string" || !harness[field]) {
        throw new Error(`${registryPath}: harness entry missing required field '${field}'`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// environment overlay
// ---------------------------------------------------------------------------
const ROLE_ENV_PREFIX: Record<RoleName, string> = {
  proposer: "PROPOSER",
  codegen: "EVAL", // historical prefix for the codegen lane
  judge: "JUDGE",
};

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function applyEnvOverlay(config: EvalConfig): EvalConfig {
  const roles = { ...config.roles };
  for (const role of Object.keys(roles) as RoleName[]) {
    const prefix = ROLE_ENV_PREFIX[role];
    const current = { ...roles[role] };
    current.harness = env(`${prefix}_HARNESS`, "AGENT_HARNESS", "CESIUM_AGENT_HARNESS") ?? current.harness;
    const harnessEnv = current.harness.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    current.model =
      env(`${harnessEnv}_${prefix}_MODEL`, `${harnessEnv}_MODEL`, `${prefix}_MODEL`, "AGENT_MODEL") ?? current.model;
    current.variant = env(`${harnessEnv}_${prefix}_VARIANT`, `${harnessEnv}_VARIANT`) ?? current.variant;
    roles[role] = current;
  }

  const fallbackEnabled = env("AGENT_VISION_FALLBACK");
  const visionFallback = { ...config.visionFallback };
  if (fallbackEnabled !== undefined) {
    visionFallback.enabled = !["0", "off", "false", "no"].includes(fallbackEnabled.trim().toLowerCase());
  }
  visionFallback.model = env("AGENT_VISION_FALLBACK_MODEL") ?? visionFallback.model;

  return { ...config, roles, visionFallback };
}

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------
export interface LoadContextOptions {
  /** Explicit config file path (CLI --config). */
  configPath?: string;
}

export function loadContext(options: LoadContextOptions = {}): EvalContext {
  const root = findRepoRoot();

  let config = builtinDefaults();
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : path.join(root, CONFIG_FILE_NAME);
  if (fs.existsSync(configPath)) {
    const raw = readJson(configPath);
    validateConfigFile(configPath, raw, root);
    config = deepMerge(config, raw);
  } else if (options.configPath) {
    throw new Error(`config file not found: ${configPath}`);
  }
  config = applyEnvOverlay(config);

  const registryPath = path.isAbsolute(config.registry) ? config.registry : path.join(root, config.registry);
  const registry = readJson(registryPath) as HarnessRegistry;
  validateRegistry(registry, registryPath);

  const byId = new Map<string, HarnessSpec>(registry.harnesses.map((harness) => [harness.id, harness]));

  const harness = (id: string): HarnessSpec => {
    const spec = byId.get(id);
    if (!spec) {
      throw new Error(`unknown harness '${id}'; registry declares: ${[...byId.keys()].join(", ")}`);
    }
    return spec;
  };

  const resolveRole = (
    role: RoleName,
    overrides: Partial<Pick<RoleConfig, "harness" | "model" | "variant">> = {},
  ): ResolvedAgent => {
    const roleConfig = config.roles[role];
    const pick = (override: string | undefined, configured: string): string =>
      override !== undefined && override !== "" && override !== "auto" ? override : configured;

    const harnessId = normalizeAuto(pick(overrides.harness, roleConfig.harness)) ?? registry.harnesses[0].id;
    const spec = harness(harnessId);
    const model = normalizeAuto(pick(overrides.model, roleConfig.model));
    const variant = normalizeAuto(pick(overrides.variant, roleConfig.variant)) ?? spec.default_effort;
    return { role, harness: spec, model, variant, timeoutSeconds: roleConfig.timeoutSeconds };
  };

  return { repoRoot: root, config, registry, harness, resolveRole };
}

/** 'auto' (or empty) means "defer to discovery/harness default" -> null. */
function normalizeAuto(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") return null;
  return trimmed;
}
