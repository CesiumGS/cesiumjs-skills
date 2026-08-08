/**
 * High-level agent invocation: role resolution and live model discovery.
 * Image-bearing calls must target a vision-capable agent — there is no
 * automatic rerouting. Commands call this; drivers stay dumb.
 */
import "./drivers.js"; // side-effect: registers built-in drivers
import type { EvalContext, HarnessSpec, ResolvedAgent, RoleName } from "../config/types.js";
import { AgentCall, driverFor } from "./driver.js";
import type { CodexCall } from "./codexDriver.js";
import { HarnessProgress } from "./progress.js";

export interface AgentRequest {
  prompt: string;
  system?: string | null;
  files?: string[];
  cwd?: string;
  addDirs?: string[];
  allowedTools?: string[];
  disableTools?: boolean;
  title?: string | null;
  /** Canonical provider id serving the model (null = harness default binding). */
  provider?: string | null;
  /** Optional flag-level overrides (already normalized: 'auto' means defer). */
  overrides?: { harness?: string; model?: string; variant?: string };
}

/** Whether an agent (harness + concrete model) can accept image inputs. */
export function supportsVision(spec: HarnessSpec, model: string | null): boolean {
  if (!spec.multimodal) return false;
  if (model) {
    const entry = spec.models.find((candidate) => candidate.id === model);
    if (entry && entry.native_vision === false) return false;
  }
  return true;
}

/** Resolve the concrete model for an agent: explicit > discovered > registry default. */
export function resolveModel(agent: ResolvedAgent): string {
  if (agent.model) return agent.model;
  const driver = driverFor(agent.harness);
  return driver.discoverDefaultModel?.(agent.harness) ?? agent.harness.default_model;
}

function codexProfileFor(role: RoleName, hasImages: boolean): string | null {
  if (hasImages) return null; // image work must stay on the vision-capable account
  const prefixes: Record<RoleName, string> = { proposer: "PROPOSER", codegen: "EVAL", judge: "JUDGE" };
  for (const name of [`CODEX_${prefixes[role]}_PROFILE`, "CODEX_PROFILE"]) {
    const value = process.env[name];
    if (value) {
      const normalized = value.trim().toLowerCase();
      return ["", "none", "default"].includes(normalized) ? null : value.trim();
    }
  }
  return null;
}

/** The agent that actually handled a call, for truthful artifact provenance. */
export interface ResolvedAgentInfo {
  harness: string;
  model: string;
  variant: string | null;
}

export interface AgentInvocation {
  text: string;
  /** Truthful provenance: the agent that actually made the call. */
  agent: ResolvedAgentInfo;
}

/** Invoke the configured agent for a role; returns the assistant text plus
 * the agent that actually made the call (for truthful artifact provenance). */
export async function invokeAgent(ctx: EvalContext, role: RoleName, request: AgentRequest): Promise<AgentInvocation> {
  const agent = ctx.resolveRole(role, request.overrides ?? {});
  const model = resolveModel(agent);
  const hasImages = Boolean(request.files?.length);

  // Image-bearing calls must run on a vision-capable agent. We never silently
  // reroute to another harness: if the configured agent can't see images, fail
  // loudly so the caller picks a vision-capable harness for this role.
  if (hasImages && !supportsVision(agent.harness, model)) {
    throw new Error(
      `${agent.harness.id}/${model} cannot accept image inputs ` +
        `(${role} call carries ${request.files!.length} image(s)); ` +
        `choose a vision-capable harness for this role.`,
    );
  }

  // Provider-attribution honesty. A provider override must be served by the
  // model we actually invoke, or the run records a lie (e.g. OpenCode's default
  // github-copilot/gpt-5.6-sol still hits the Copilot binding while the run is
  // stamped as OpenAI, because the driver won't re-prefix a model that already
  // carries a provider). Models are only provided by providers, so:
  if (request.provider && request.provider !== (agent.harness.provider ?? null)) {
    const explicitModel = Boolean(request.overrides?.model && request.overrides.model.toLowerCase() !== "auto");
    // (a) An auto model is resolved from the harness's own binding — it cannot
    // be trusted to belong to the override provider. Demand an explicit one.
    if (!explicitModel) {
      throw new Error(
        `${agent.harness.id}: provider override '${request.provider}' needs an explicit model — ` +
          `the auto model '${model}' comes from the harness's ${agent.harness.provider ?? "default"} binding and ` +
          `is not guaranteed to be served by '${request.provider}'. Pass a model that '${request.provider}' provides.`,
      );
    }
    // (b) An explicit model that names a different provider prefix contradicts
    // the override; the driver would route by the prefix and mis-stamp the run.
    if (model.includes("/")) {
      const prefix = model.slice(0, model.indexOf("/"));
      if (prefix !== request.provider) {
        throw new Error(
          `${agent.harness.id}: model '${model}' is bound to provider '${prefix}', which contradicts the ` +
            `'${request.provider}' override — drop the '${prefix}/' prefix or align the provider.`,
        );
      }
    }
  }

  // The reporter frames the whole call: it announces the dispatch, starts the
  // heartbeat that proves the process is alive during a long think, receives
  // the harness's own event stream from the driver, and closes with a
  // duration. It is created here rather than in the driver so the role — the
  // one thing the driver has no idea about — appears on every line.
  const progress = new HarnessProgress({ role, harness: agent.harness.id, model, variant: agent.variant });
  progress.dispatch({
    prompt: `${(Buffer.byteLength(request.prompt, "utf-8") / 1024).toFixed(1)}KB`,
    system: request.system ? "yes" : undefined,
    images: request.files?.length || undefined,
    tools: request.disableTools ? "none" : request.allowedTools?.join(",") || "harness default",
    provider: request.provider ?? undefined,
    timeout: `${agent.timeoutSeconds}s`,
  });

  const call: AgentCall & Partial<CodexCall> = {
    prompt: request.prompt,
    system: request.system ?? null,
    model,
    provider: request.provider ?? null,
    variant: agent.variant,
    files: request.files,
    cwd: request.cwd,
    addDirs: request.addDirs,
    allowedTools: request.allowedTools,
    disableTools: request.disableTools,
    title: request.title ?? null,
    timeoutSeconds: agent.timeoutSeconds,
    profile: codexProfileFor(role, hasImages),
    progress,
  };
  let text: string;
  try {
    text = await driverFor(agent.harness).invoke(agent.harness, call);
  } catch (error) {
    // A failed call must close its own narrative — otherwise the last line in
    // the log is a heartbeat and the reader has to guess where it died.
    progress.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
  progress.finish({ reply: `${(Buffer.byteLength(text, "utf-8") / 1024).toFixed(1)}KB` });
  return { text, agent: { harness: agent.harness.id, model, variant: agent.variant } };
}

export function ensureAgentAvailable(ctx: EvalContext, role: RoleName, overrides?: AgentRequest["overrides"]): void {
  const agent = ctx.resolveRole(role, overrides ?? {});
  driverFor(agent.harness).ensureAvailable(agent.harness);
}

/** Describe the fully-resolved agent for stamping into artifacts/metadata. */
export function describeAgent(ctx: EvalContext, role: RoleName, overrides?: AgentRequest["overrides"]): {
  harness: string;
  model: string;
  variant: string | null;
} {
  const agent = ctx.resolveRole(role, overrides ?? {});
  return { harness: agent.harness.id, model: resolveModel(agent), variant: agent.variant };
}
