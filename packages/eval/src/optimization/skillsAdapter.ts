/**
 * Skills adapter: generates CesiumJS scenario code through the configured
 * codegen agent, writing the JS artifact plus a provenance meta sidecar.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { writeJsonSorted } from "../lib/json.js";
import { sha256Text } from "../lib/proc.js";
import { fromRepoRoot } from "../lib/paths.js";
import { invokeAgent } from "../harness/invoke.js";
import type { EvalContext } from "../config/types.js";

const WRAP_FENCE_RE = /^```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)\n```\s*$/;
const INLINE_FENCE_RE = /```(?:javascript|js|ts|typescript)\s*\n([\s\S]*?)\n```/;
const SKILL_TEXT_EXTENSIONS = new Set([".css", ".frag", ".glsl", ".html", ".js", ".json", ".md", ".txt", ".vert"]);
const MAX_SKILL_BUNDLE_BYTES = 512 * 1024;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_SKILL_BUNDLE_FILES = 64;

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

export interface SkillBundle {
  content: string;
  primaryContent: string;
  supportingFiles: string[];
}

/**
 * Load the complete text surface shipped by one skill. Agent Skills can route
 * readers from SKILL.md into local reference/example files; grading only the
 * entrypoint makes a supporting-file regression invisible. The bundle is
 * deterministic, text-only, size-bounded, and rejects symlinks so a candidate
 * skill can never make codegen ingest an unrelated runner file.
 */
export function loadSkillBundle(skillPath: string): SkillBundle {
  const primaryPath = path.resolve(skillPath);
  const root = path.dirname(primaryPath);
  const primaryContent = fs.readFileSync(primaryPath, "utf-8");
  const files: Array<{ relative: string; content: string; bytes: number }> = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill bundle contains a symbolic link: ${path.relative(root, full)}`);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || full === primaryPath) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      const extension = path.extname(entry.name).toLowerCase();
      if (!SKILL_TEXT_EXTENSIONS.has(extension)) {
        throw new Error(`Skill bundle contains an unsupported non-text file: ${relative}`);
      }
      const bytes = fs.statSync(full).size;
      if (bytes > MAX_SKILL_FILE_BYTES) throw new Error(`Skill bundle file exceeds ${MAX_SKILL_FILE_BYTES} bytes: ${relative}`);
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(full));
      } catch {
        throw new Error(`Skill bundle file is not valid UTF-8 text: ${relative}`);
      }
      files.push({ relative, content, bytes });
    }
  }

  // Follow explicit Markdown links to text files in sibling skill directories.
  // This covers cross-skill references such as
  // ../cesiumjs-models-particles/REFERENCE.md without handing the model a file
  // browser. Links escaping the skills root are deliberately not ingested.
  const skillsRoot = path.dirname(root);
  const indexed = new Set(files.map((file) => path.resolve(root, file.relative)));
  const sources: Array<{ full: string; content: string }> = [
    { full: primaryPath, content: primaryContent },
    ...files.map((file) => ({ full: path.resolve(root, file.relative), content: file.content })),
  ];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const links = source.content.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g);
    for (const match of links) {
      const rawTarget = match[1].replace(/^<|>$/g, "").split("#", 1)[0];
      if (!rawTarget || /^(?:[a-z]+:|\/|#)/i.test(rawTarget)) continue;
      let target: string;
      try {
        target = decodeURIComponent(rawTarget);
      } catch {
        throw new Error(`Skill bundle contains an invalid encoded link: ${rawTarget}`);
      }
      const full = path.resolve(path.dirname(source.full), target);
      const relativeToSkills = path.relative(skillsRoot, full);
      if (relativeToSkills.startsWith("..") || path.isAbsolute(relativeToSkills)) continue;
      if (indexed.has(full) || full === primaryPath || !fs.existsSync(full)) continue;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Skill bundle link resolves to a symbolic link: ${target}`);
      if (!stat.isFile()) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      const extension = path.extname(full).toLowerCase();
      if (!SKILL_TEXT_EXTENSIONS.has(extension)) throw new Error(`Skill bundle link targets an unsupported file: ${relative}`);
      if (stat.size > MAX_SKILL_FILE_BYTES) throw new Error(`Skill bundle file exceeds ${MAX_SKILL_FILE_BYTES} bytes: ${relative}`);
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(full));
      } catch {
        throw new Error(`Skill bundle file is not valid UTF-8 text: ${relative}`);
      }
      indexed.add(full);
      files.push({ relative, content, bytes: stat.size });
      sources.push({ full, content });
    }
  }

  files.sort((a, b) => a.relative.localeCompare(b.relative));
  if (files.length > MAX_SKILL_BUNDLE_FILES) {
    throw new Error(`Skill bundle has ${files.length} supporting files; maximum is ${MAX_SKILL_BUNDLE_FILES}`);
  }
  const totalBytes = Buffer.byteLength(primaryContent, "utf-8") + files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > MAX_SKILL_BUNDLE_BYTES) {
    throw new Error(`Skill bundle is ${totalBytes} bytes; maximum is ${MAX_SKILL_BUNDLE_BYTES}`);
  }

  const supportingFiles = files.map((file) => file.relative);
  if (!files.length) return { content: primaryContent, primaryContent, supportingFiles };
  const supporting = files.map(
    (file) => `\n<supporting_file path=${JSON.stringify(file.relative)}>\n${file.content}\n</supporting_file>`,
  );
  const content = [
    primaryContent,
    "\n\n<skill_supporting_files>",
    "The following files ship with this skill and are part of the candidate being evaluated.",
    ...supporting,
    "</skill_supporting_files>",
  ].join("\n");
  return { content, primaryContent, supportingFiles };
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
  /** `provider` is routed as its own request field, not as a role override —
   * see the invokeAgent call below. */
  overrides?: { harness?: string; provider?: string; model?: string; variant?: string };
  temperature?: number;
  outputRoot?: string;
}

/** Generate code for one scenario and write `<eval-id>.js` + `.meta.json`. */
export async function generateScenarioCode(ctx: EvalContext, options: CodegenOptions): Promise<CodegenResult> {
  const { scenario } = options;
  if (!scenario.id || !scenario.prompt) throw new Error("scenario must have 'id' and 'prompt' fields");
  if (!fs.existsSync(options.skillPath)) throw new Error(`Skill file not found: ${options.skillPath}`);

  const skillBundle = loadSkillBundle(options.skillPath);
  const skillContentHash = sha256Text(skillBundle.primaryContent);
  const skillBundleHash = sha256Text(skillBundle.content);
  const timestamp = new Date().toISOString();

  // Provider is NOT a role override: invokeAgent routes it as its own request
  // field and refuses a provider it cannot honestly serve. Folding it into
  // `overrides` instead dropped it silently — the run then used the harness's
  // default binding while downstream flags stamped the requested provider into
  // the scorecard, which is precisely the attribution lie invokeAgent guards
  // against.
  const { provider, ...selection } = options.overrides ?? {};
  const invocation = await invokeAgent(ctx, "codegen", {
    prompt: scenario.prompt,
    system: codegenSystemPrompt(skillBundle.content),
    disableTools: true, // pure code generation; no file access needed
    title: `${options.skill} ${scenario.id} codegen`,
    provider: provider ?? null,
    overrides: selection,
  });
  const responseText = invocation.text;
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
    harness: invocation.agent.harness,
    model_id: invocation.agent.model,
    model_variant: invocation.agent.variant,
    // Null means the harness's own binding served the model, which is the
    // truthful stamp when no provider was requested.
    model_provider: provider ?? null,
    temperature: options.temperature ?? 1.0,
    skill_content_hash: skillContentHash,
    skill_bundle_hash: skillBundleHash,
    supporting_files: skillBundle.supportingFiles,
    timestamp_utc: timestamp,
    scenario_id: scenario.id,
    skill: options.skill,
    iteration: options.iteration,
  };
  writeJsonSorted(path.join(outputDir, `${scenario.id}.meta.json`), metadata);

  return { outputPath: jsPath, metadata };
}
