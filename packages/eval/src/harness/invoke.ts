/**
 * High-level agent invocation: role resolution and live model discovery.
 * Image-bearing calls must target a vision-capable agent — there is no
 * automatic rerouting. Commands call this; drivers stay dumb.
 */
import "./opencodeDriver.js"; // side-effect: registers built-in drivers
import "./codexDriver.js";
import "./copilotDriver.js";
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
  const text = await driverFor(agent.harness).invoke(agent.harness, call);
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
