/**
 * Skills adapter: generates CesiumJS scenario code through the configured
 * codegen agent, writing the JS artifact plus a provenance meta sidecar.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { writeJsonSorted } from "../lib/json.js";
import { sha256Text } from "../lib/proc.js";
import { fromRepoRoot } from "../lib/paths.js";
import { describeAgent, invokeAgent } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";

const WRAP_FENCE_RE = /^```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)\n```\s*$/;
const INLINE_FENCE_RE = /```(?:javascript|js|ts|typescript)\s*\n([\s\S]*?)\n```/;

/** Extract the JavaScript body from a model response that may carry fences/prose. */
export function stripCodeFences(text: string): string {
  const stripped = text.trim();
  const wrap = WRAP_FENCE_RE.exec(stripped);
  if (wrap) return wrap[1].trim();
  const inline = INLINE_FENCE_RE.exec(stripped);
  if (inline) return inline[1].trim();
  return stripped;
}

/** Safety patterns that must never appear in generated output. */
const ION_TOKEN_RE = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i;
const ABSOLUTE_PATH_RE = /(?:\/Users\/|\/home\/|C:\\Users\\)/i;

export function safetyScan(code: string): void {
  if (ION_TOKEN_RE.test(code)) {
    throw new Error("SAFETY VIOLATION: Generated code contains Cesium Ion token. Refusing to write output file.");
  }
  if (ABSOLUTE_PATH_RE.test(code)) {
    throw new Error("SAFETY VIOLATION: Generated code contains absolute filesystem path. Refusing to write output file.");
  }
}

/**
 * The runtime contract the generated code must satisfy (async IIFE, global
 * Cesium, `window.viewer` assignment, public-asset constraints, framing
 * guidance). Loaded from the versioned prompt asset so prompt engineering
 * stays data, not code.
 */
function codegenSystemPrompt(skillContent: string): string {
  const templatePath = fromRepoRoot("optimization", "prompts", "codegen", "system-v1.txt");
  const template = fs.readFileSync(templatePath, "utf-8");
  return template.replace("{skill_content}", skillContent);
}

export interface CodegenResult {
  outputPath: string;
  metadata: Record<string, any>;
}

export interface CodegenOptions {
  skill: string;
  iteration: string;
  skillPath: string;
  scenario: Record<string, any>;
  overrides?: { harness?: string; model?: string; variant?: string };
  temperature?: number;
  outputRoot?: string;
}

/** Generate code for one scenario and write `<eval-id>.js` + `.meta.json`. */
export function generateScenarioCode(ctx: EvalContext, options: CodegenOptions): CodegenResult {
  const { scenario } = options;
  if (!scenario.id || !scenario.prompt) throw new Error("scenario must have 'id' and 'prompt' fields");
  if (!fs.existsSync(options.skillPath)) throw new Error(`Skill file not found: ${options.skillPath}`);

  const skillContent = fs.readFileSync(options.skillPath, "utf-8");
  const skillContentHash = sha256Text(skillContent);
  const described = describeAgent(ctx, "codegen", options.overrides);
  const timestamp = new Date().toISOString();

  const responseText = invokeAgent(ctx, "codegen", {
    prompt: scenario.prompt,
    system: codegenSystemPrompt(skillContent),
    disableTools: true, // pure code generation; no file access needed
    title: `${options.skill} ${scenario.id} codegen`,
    overrides: options.overrides,
  });
  if (!responseText) throw new Error("codegen agent returned an empty response");

  const generatedCode = stripCodeFences(responseText);
  safetyScan(generatedCode);

  const outputDir = options.outputRoot
    ? path.join(options.outputRoot, options.skill, options.iteration)
    : fromRepoRoot("optimization", "generated", options.skill, options.iteration);
  fs.mkdirSync(outputDir, { recursive: true });

  const jsPath = path.join(outputDir, `${scenario.id}.js`);
  fs.writeFileSync(jsPath, generatedCode);

  const metadata = {
    harness: described.harness,
    model_id: described.model,
    model_variant: described.variant,
    temperature: options.temperature ?? 1.0,
    skill_content_hash: skillContentHash,
    timestamp_utc: timestamp,
    scenario_id: scenario.id,
    skill: options.skill,
    iteration: options.iteration,
  };
  writeJsonSorted(path.join(outputDir, `${scenario.id}.meta.json`), metadata);

  return { outputPath: jsPath, metadata };
}
