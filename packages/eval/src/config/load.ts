/**
 * Layered configuration: built-in defaults <- eval.config.json <- environment
 * variables <- CLI flags (applied by commands via resolveRole overrides).
 *
 * Environment variables keep the operational surface the pipeline has always
 * had: `<ROLE>_HARNESS` / `AGENT_HARNESS`, `<HARNESS>_<ROLE>_MODEL`,
 * `<HARNESS>_MODEL`, `<HARNESS>_<ROLE>_VARIANT`, `<HARNESS>_VARIANT` — all
 * uppercase, harness/role interpolated from config rather than hardcoded.
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
  const role = (harness = "opencode"): RoleConfig => ({
    harness,
    model: "auto",
    variant: "auto",
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  });
  return {
    registry: "config/harness-registry.json",
    threshold: 0.95,
    // The judge reads screenshots, so its default harness must be vision-capable:
    // image-bearing calls to a text-only harness are an error, not a reroute.
    roles: { proposer: role(), codegen: role(), judge: role("codex") },
    judgePanel: { size: 3, seeds: [42, 123, 789], pairwiseProtocol: "pairwise-v1", staticProtocol: "static-visual-v1" },
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

function validateRegistry(registry: HarnessRegistry, registryPath: string, root: string): void {
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

  // Full JSON-Schema validation (config/harness-registry.schema.json), same
  // pattern as eval.config.json: skipped only when the schema file is absent.
  const schemaPath = path.join(root, "config", "harness-registry.schema.json");
  if (fs.existsSync(schemaPath)) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(readJson(schemaPath));
    if (!validate(registry)) {
      const details = (validate.errors ?? [])
        .map((error) => `  ${error.instancePath || "<root>"}: ${error.message}`)
        .join("\n");
      throw new Error(`${registryPath} failed schema validation:\n${details}`);
    }
  }

  // Referential integrity across the registry's own axes. Providers are the
  // canonical entities; every harness/alias reference must resolve to one.
  const providerIds = new Set((registry.providers ?? []).map((provider) => provider.id));
  if (providerIds.size) {
    for (const harness of registry.harnesses) {
      if (harness.provider && !providerIds.has(harness.provider)) {
        throw new Error(`${registryPath}: harness '${harness.id}' references unknown provider '${harness.provider}'`);
      }
      const support = harness.provider_support;
      for (const ref of [...(support?.native ?? []), ...(support?.native_3p ?? [])]) {
        if (!providerIds.has(ref)) {
          throw new Error(`${registryPath}: harness '${harness.id}' provider_support references unknown provider '${ref}'`);
        }
      }
      if (!harness.models.some((model) => model.id === harness.default_model)) {
        throw new Error(`${registryPath}: harness '${harness.id}' default_model '${harness.default_model}' is not in its catalog`);
      }
    }
    for (const [alias, spec] of Object.entries(registry.provider_aliases ?? {})) {
      if (!providerIds.has(spec.provider_id)) {
        throw new Error(`${registryPath}: provider_aliases['${alias}'] references unknown provider '${spec.provider_id}'`);
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

  return { ...config, roles };
}

// ---------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------
export interface LoadContextOptions {
  /** Explicit config file path (CLI --config). */
  configPath?: string;
}

/**
 * Fold `<repo>/.env` into the environment, for the credentials the pipeline
 * needs but must never track (CESIUM_ION_TOKEN, harness auth). Already-set
 * variables WIN: an explicit `FOO=bar cesium-eval ...` or a CI secret must not
 * be silently overridden by a stale file on someone's laptop.
 *
 * Deliberately minimal: `KEY=value` lines, `#` comments, optional surrounding
 * quotes. Anything richer belongs in a real config file, not a secret store.
 */
export function loadDotEnv(root: string): void {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (process.env[name] !== undefined) continue;
    process.env[name] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function loadContext(options: LoadContextOptions = {}): EvalContext {
  const root = findRepoRoot();
  loadDotEnv(root);

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
  validateRegistry(registry, registryPath, root);

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
