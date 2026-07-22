/**
 * High-level agent invocation: role resolution, live model discovery, and
 * registry-driven vision fallback. Commands call this; drivers stay dumb.
 */
import "./opencodeDriver.js"; // side-effect: registers built-in drivers
import "./codexDriver.js";
import type { EvalContext, HarnessSpec, ResolvedAgent, RoleName } from "../config/types.js";
import { AgentCall, driverFor } from "./driver.js";
import type { CodexCall } from "./codexDriver.js";

export interface AgentRequest {
  prompt: string;
  system?: string | null;
  files?: string[];
  cwd?: string;
  addDirs?: string[];
  allowedTools?: string[];
  disableTools?: boolean;
  title?: string | null;
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

/**
 * Map a model id onto the fallback harness's catalog: an explicit config
 * override wins; then a same-basename catalog match; then the fallback
 * harness's default model.
 */
function fallbackModel(ctx: EvalContext, failingModel: string, fallback: HarnessSpec): string {
  const override = ctx.config.visionFallback.model;
  if (override) return override;
  const basename = failingModel.includes("/") ? failingModel.split("/").slice(1).join("/") : failingModel;
  if (fallback.models.some((model) => model.id === basename)) return basename;
  return fallback.default_model;
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

export function ensureAgentAvailable(ctx: EvalContext, role: RoleName, overrides?: AgentRequest["overrides"]): void {
  const agent = ctx.resolveRole(role, overrides ?? {});
  driverFor(agent.harness).ensureAvailable(agent.harness);
}

/** Invoke the configured agent for a role and return the assistant text. */
export function invokeAgent(ctx: EvalContext, role: RoleName, request: AgentRequest): string {
  let agent = ctx.resolveRole(role, request.overrides ?? {});
  let model = resolveModel(agent);
  const hasImages = Boolean(request.files?.length);

  // Registry-driven vision fallback: the registry says whether this harness/
  // model combination can see images and where image calls re-route.
  if (hasImages && ctx.config.visionFallback.enabled && !supportsVision(agent.harness, model)) {
    const fallbackId = agent.harness.vision_fallback_to;
    if (fallbackId) {
      const fallbackSpec = ctx.harness(fallbackId);
      const rerouted = fallbackModel(ctx, model, fallbackSpec);
      console.error(
        `[agent] vision fallback: ${role} call carries images but ${agent.harness.id}/${model} lacks vision; ` +
          `routing to ${fallbackId}/${rerouted}.`,
      );
      agent = { ...agent, harness: fallbackSpec, model: rerouted };
      model = rerouted;
    }
  }

  const call: AgentCall & Partial<CodexCall> = {
    prompt: request.prompt,
    system: request.system ?? null,
    model,
    variant: agent.variant,
    files: request.files,
    cwd: request.cwd,
    addDirs: request.addDirs,
    allowedTools: request.allowedTools,
    disableTools: request.disableTools,
    title: request.title ?? null,
    timeoutSeconds: agent.timeoutSeconds,
    profile: codexProfileFor(role, hasImages),
  };
  return driverFor(agent.harness).invoke(agent.harness, call);
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
