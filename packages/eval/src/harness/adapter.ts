/**
 * Protocol-adapter lifecycle (registry adapters[], currently LiteLLM).
 *
 * The adapter realizes the DERIVED fourth tier: it translates between a
 * harness's spoken protocol and a provider's served protocol. We ship the
 * ORCHESTRATION — target definition, config generation, pinned launch,
 * health, teardown — but never the binary itself: it runs pinned + on demand
 * (`uvx --from 'litellm[proxy]==<pin>' ...`), so there is nothing global to
 * keep patched.
 *
 * Everything instance-specific (endpoints, master key, targets) lives under
 * evaluation/artifacts/adapter/ — local-only by .gitignore policy. The
 * registry stores only shapes and hints; this module materializes them.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type { AdapterSpec, EvalContext, ProviderSpec } from "../config/types.js";
import { fromRepoRoot } from "../lib/paths.js";
import { cleanSubprocessEnv } from "./shared.js";

export interface AdapterTarget {
  /** Name harnesses address through the proxy (litellm model_name). */
  name: string;
  /** Canonical provider id from registry providers[]. */
  provider_id: string;
  /** Downstream model/deployment reference (litellm `model`, e.g. azure/gpt-5.6-luna). */
  model: string;
  /** Provider params (api_base, api_version) — machine-local, never tracked. */
  params?: Record<string, string>;
  /** Env var the credential comes from (e.g. OPENAI_API_KEY, AZURE_AD_TOKEN). */
  credential_env?: string;
}

/** A target plus its launch-time credential state: whether the env var the
 * target bills through was actually present when the proxy started. Missing
 * credentials must surface HERE, as a setup state — not later as a cryptic
 * runtime error after a probe already spent a harness call. */
export interface AdapterTargetStatus extends AdapterTarget {
  /** true = credential was present at launch; false = missing at launch;
   * null = adapter not running (unknown until launch). */
  credential_ready: boolean | null;
  /** Actionable remediation when the credential is missing. */
  credential_hint: string | null;
}

export interface AdapterStatus {
  id: string;
  display_name: string;
  configured: boolean;
  running: boolean;
  healthy: boolean;
  pid: number | null;
  port: number;
  version_pin: string;
  targets: AdapterTargetStatus[];
  advisory: string;
}

const ADAPTER_DIR = () => fromRepoRoot("evaluation", "artifacts", "adapter");
const pidPath = () => path.join(ADAPTER_DIR(), "adapter.pid");
const keyPath = () => path.join(ADAPTER_DIR(), "master.key");
const logPath = () => path.join(ADAPTER_DIR(), "adapter.log");
const statePath = () => path.join(ADAPTER_DIR(), "adapter.state.json");
/** Machine-local credential files, lowest precedence first. Both are
 * gitignored (`.env` at line 3; `evaluation/artifacts/` at line 39), so
 * secrets never reach a commit. Reading them lets the console/server start
 * the adapter without inheriting secrets from an interactive shell. */
function localEnvPaths(repoRoot: string): string[] {
  return [path.join(ADAPTER_DIR(), "env.local"), path.join(repoRoot, ".env")];
}

/** Parse KEY=VALUE lines (quotes stripped, `export ` and comments ignored).
 * Values are never logged — only the presence of a key is ever reported. */
function readLocalEnvFiles(repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of localEnvPaths(repoRoot)) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue; // absent is fine
    }
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return out;
}

/** What to do about a missing credential, per env var. */
function credentialHint(envVar: string): string {
  if (envVar === "AZURE_AD_TOKEN") {
    return "Azure Entra session unavailable at launch — run `az login --scope https://cognitiveservices.azure.com/.default`, then restart the adapter";
  }
  return `${envVar} was not set when the adapter launched — add it to the repo-root .env (gitignored) or export it, then restart the adapter`;
}

function readLaunchState(): Record<string, boolean> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf-8"));
    return parsed?.credential_state ?? null;
  } catch {
    return null;
  }
}

export function adapterSpec(ctx: EvalContext, id = "litellm"): AdapterSpec {
  const spec = (ctx.registry.adapters ?? []).find((adapter) => adapter.id === id);
  if (!spec) throw new Error(`no adapter '${id}' in registry (declared: ${(ctx.registry.adapters ?? []).map((a) => a.id).join(", ") || "none"})`);
  return spec;
}

function targetsPath(ctx: EvalContext, spec: AdapterSpec): string {
  return path.join(ctx.repoRoot, spec.run.targets_artifact ?? "evaluation/artifacts/adapter/targets.json");
}

export function readTargets(ctx: EvalContext, spec: AdapterSpec): AdapterTarget[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(targetsPath(ctx, spec), "utf-8"));
    return Array.isArray(parsed?.targets) ? parsed.targets : [];
  } catch {
    return [];
  }
}

export function writeTargets(ctx: EvalContext, spec: AdapterSpec, targets: AdapterTarget[]): void {
  fs.mkdirSync(ADAPTER_DIR(), { recursive: true });
  fs.writeFileSync(
    targetsPath(ctx, spec),
    JSON.stringify({ comment: "Local-only adapter targets — endpoints are machine-specific and never tracked.", targets }, null, 2) + "\n",
  );
}

/** The proxy master key: generated once, 0600, local-only. Harnesses present
 * it to the adapter; it never leaves this machine. */
export function masterKey(): string {
  fs.mkdirSync(ADAPTER_DIR(), { recursive: true });
  try {
    return fs.readFileSync(keyPath(), "utf-8").trim();
  } catch {
    const key = `sk-cesium-adapter-${crypto.randomBytes(12).toString("hex")}`;
    fs.writeFileSync(keyPath(), key + "\n", { mode: 0o600 });
    return key;
  }
}

function pinnedVersion(spec: AdapterSpec): string {
  return spec.security.min_safe_version;
}

/** Generate the litellm config from targets. Credentials are referenced as
 * os.environ/<VAR> — the value only ever exists in the spawned process env. */
export function generateConfig(ctx: EvalContext, spec: AdapterSpec, targets: AdapterTarget[]): string {
  const providers = new Map((ctx.registry.providers ?? []).map((provider) => [provider.id, provider]));
  const lines: string[] = [
    "# GENERATED by cesium-eval adapter — do not edit; edit targets.json instead.",
    "# Local-only: endpoints and credential references are machine-specific.",
    "model_list:",
  ];
  // Params may reference the local env with ${VAR} so endpoints live in ONE
  // place (the gitignored .env) instead of being duplicated into targets.
  const localEnv = readLocalEnvFiles(ctx.repoRoot);
  const expand = (value: string): string => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => localEnv[name] ?? whole);

  for (const target of targets) {
    const provider: ProviderSpec | undefined = providers.get(target.provider_id);
    const hint = (provider?.adapter_hints?.[spec.id] ?? {}) as Record<string, unknown>;
    const prefix = typeof hint.model_prefix === "string" ? hint.model_prefix : "";
    const model = target.model.includes("/") ? target.model : `${prefix}${target.model}`;
    lines.push(`  - model_name: ${target.name}`, `    litellm_params:`, `      model: ${model}`);
    for (const [key, value] of Object.entries(target.params ?? {})) {
      let resolved = expand(value);
      // The Foundry portal hands out the "v1 API" endpoint flavor
      // (https://<res>.openai.azure.com/openai/v1), but litellm's azure/
      // provider appends /openai/deployments/<name>/... itself — leaving the
      // path on produces a 404 "Resource not found". Normalize to the bare
      // resource origin so a portal copy-paste just works.
      if (key === "api_base" && prefix === "azure/") {
        resolved = resolved.replace(/\/openai(\/v1)?\/?$/, "");
      }
      lines.push(`      ${key}: "${resolved}"`);
    }
    if (target.credential_env) {
      const param = target.credential_env === "AZURE_AD_TOKEN" ? "azure_ad_token" : "api_key";
      lines.push(`      ${param}: os.environ/${target.credential_env}`);
    }
  }
  lines.push("", "general_settings:", `  master_key: ${masterKey()}`, "");
  const configFile = path.join(ctx.repoRoot, spec.run.config_artifact);
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, lines.join("\n"), { mode: 0o600 });
  return configFile;
}

function pidAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  try {
    return Number(fs.readFileSync(pidPath(), "utf-8").trim()) || null;
  } catch {
    return null;
  }
}

export async function health(spec: AdapterSpec, port: number, timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${spec.run.health_path}`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function status(ctx: EvalContext, id = "litellm"): Promise<AdapterStatus> {
  const spec = adapterSpec(ctx, id);
  const targets = readTargets(ctx, spec);
  const pid = readPid();
  const running = pidAlive(pid);
  const launchState = running ? readLaunchState() : null;
  return {
    id: spec.id,
    display_name: spec.display_name,
    configured: targets.length > 0,
    running,
    healthy: running ? await health(spec, spec.run.default_port) : false,
    pid: running ? pid : null,
    port: spec.run.default_port,
    version_pin: pinnedVersion(spec),
    targets: targets.map((target) => {
      const ready = !target.credential_env ? true : launchState ? (launchState[target.credential_env] ?? false) : null;
      return {
        ...target,
        credential_ready: running ? ready : null,
        credential_hint: running && ready === false && target.credential_env ? credentialHint(target.credential_env) : null,
      };
    }),
    advisory: spec.security.advisory,
  };
}

/** Best-effort Azure Entra token for keyless azure targets. Returns null when
 * the az session is absent/expired — the caller decides whether that target
 * matters. The token only exists in the spawned process env. */
function azureAdToken(): string | null {
  try {
    return (
      execFileSync("az", ["account", "get-access-token", "--resource", "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv"], {
        encoding: "utf-8",
        timeout: 20_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export async function start(ctx: EvalContext, id = "litellm"): Promise<AdapterStatus> {
  const spec = adapterSpec(ctx, id);
  const current = await status(ctx, id);
  if (current.running) {
    if (current.healthy) return current;
    // Spawning a second proxy here would fail to bind, overwrite the pid file
    // with a dead pid, and orphan the real process on the port.
    throw new Error(
      `adapter '${id}' is already running (pid ${current.pid ?? "unknown"}) but failed its health probe; ` +
        `stop it first (cesium-eval adapter stop), then start again`,
    );
  }
  const targets = readTargets(ctx, spec);
  if (!targets.length) {
    throw new Error(`no adapter targets configured — write ${spec.run.targets_artifact} (see \`cesium-eval adapter init\`)`);
  }
  const configFile = generateConfig(ctx, spec, targets);

  // Deliberate credential passthrough: the adapter is the declared consumer of
  // provider API keys (that is its whole job); each target names its env var.
  const allow = [...new Set(targets.map((target) => target.credential_env).filter((env): env is string => Boolean(env)))];
  const env = cleanSubprocessEnv(allow);
  const localEnv = readLocalEnvFiles(ctx.repoRoot);
  for (const name of allow) {
    if (!env[name] && localEnv[name]) env[name] = localEnv[name];
  }
  // Entra tokens are short-lived (~1h), so they are minted per launch rather
  // than stored. Only attempted when no static key already satisfies the target.
  if (allow.includes("AZURE_AD_TOKEN") && !env.AZURE_AD_TOKEN) {
    const token = azureAdToken();
    if (token) env.AZURE_AD_TOKEN = token;
  }

  fs.mkdirSync(ADAPTER_DIR(), { recursive: true });
  // Record which credentials actually made it into the proxy's env — status()
  // and probe preflight report a missing one as a SETUP state instead of
  // letting a later call fail with a cryptic downstream error.
  const credentialState = Object.fromEntries(allow.map((envVar) => [envVar, Boolean(env[envVar])]));
  fs.writeFileSync(statePath(), JSON.stringify({ launched_utc: new Date().toISOString(), credential_state: credentialState }, null, 2) + "\n");
  const out = fs.openSync(logPath(), "a");
  const child = spawn(
    "uvx",
    ["--from", `litellm[proxy]==${pinnedVersion(spec)}`, "litellm", "--config", configFile, "--port", String(spec.run.default_port)],
    { detached: true, stdio: ["ignore", out, out], env },
  );
  child.unref();
  fs.writeFileSync(pidPath(), String(child.pid) + "\n");

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await health(spec, spec.run.default_port)) return status(ctx, id);
    if (!pidAlive(child.pid ?? null)) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  const tail = fs.existsSync(logPath()) ? fs.readFileSync(logPath(), "utf-8").split("\n").slice(-6).join("\n") : "";
  throw new Error(`adapter failed to become healthy on :${spec.run.default_port}\n${tail}`);
}

export async function stop(ctx: EvalContext, id = "litellm"): Promise<AdapterStatus> {
  const pid = readPid();
  if (pidAlive(pid)) {
    try {
      process.kill(pid!, "SIGTERM");
    } catch {
      // already gone
    }
  }
  fs.rmSync(pidPath(), { force: true });
  return status(ctx, id);
}

/** Env overrides that point a harness at the adapter. Only harnesses whose
 * BYOK mechanism is base_url_override can be redirected purely via env —
 * config-surface harnesses (codex model_providers, opencode provider blocks)
 * are documented in the registry but not yet automated. */
export function harnessEnvOverrides(ctx: EvalContext, harnessId: string, adapterId = "litellm"): Record<string, string> {
  const spec = adapterSpec(ctx, adapterId);
  const harness = ctx.harness(harnessId);
  if (harness.provider_support?.byok?.mechanism !== "base_url_override") {
    throw new Error(
      `adapter routing via env is only automated for base_url_override harnesses; ` +
        `'${harnessId}' uses ${harness.provider_support?.byok?.mechanism ?? "no byok mechanism"} — configure it manually per the registry`,
    );
  }
  const base = `http://127.0.0.1:${spec.run.default_port}`;
  if (harnessId === "claude-code") {
    // CLAUDE_CODE_SIMPLE=1 is load-bearing: with a subscription login present,
    // the keychain OAuth token otherwise outranks the env override and the
    // proxy sees an unknown bearer (-> 'No connected db'). Verified live.
    return { CLAUDE_CODE_SIMPLE: "1", ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: masterKey() };
  }
  throw new Error(`no env-override template for harness '${harnessId}'`);
}
