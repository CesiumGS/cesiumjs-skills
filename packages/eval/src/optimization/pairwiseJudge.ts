/**
 * Pairwise judging: a single seeded judge compares baseline vs candidate
 * bundles blind (A/B label randomization), and a panel of N judges takes a
 * majority vote. The LLM call is injected so the logic stays unit testable.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { mulberry32 } from "../lib/random.js";

/** One pairwise LLM call: rendered prompt + attached screenshots -> raw text. */
export type PairwiseCall = (prompt: string, files: string[]) => string;

export interface PairwiseJudgeOptions {
  call: PairwiseCall;
  /** Provenance stamped into the verdict record. */
  harness: string;
  model: string | null;
  variant: string | null;
  protocol: string;
  promptsDir: string;
  seed: number;
}

export type Verdict = "BASELINE" | "CANDIDATE" | "TIE";

export interface JudgeVerdict {
  verdict: Verdict;
  rationale: string;
  harness: string;
  model_id: string;
  model_variant: string | null;
  screenshot_input_mode: string;
  screenshots_attached: number;
  protocol_version: string;
  label_mapping: Record<"A" | "B", "BASELINE" | "CANDIDATE">;
  seed: number;
}

interface BundleEvidence {
  console: Record<string, any>;
  checks: Record<string, any>;
  scene_state: Record<string, any>;
  screenshots: string[];
}

function loadEvidence(bundlePath: string): BundleEvidence {
  if (!fs.existsSync(bundlePath)) throw new Error(`Bundle directory not found: ${bundlePath}`);
  const consolePath = path.join(bundlePath, "console.json");
  if (!fs.existsSync(consolePath)) throw new Error(`console.json not found in bundle: ${bundlePath}`);
  const checksPath = path.join(bundlePath, "programmatic-checks.json");
  if (!fs.existsSync(checksPath)) throw new Error(`programmatic-checks.json not found in bundle: ${bundlePath}`);
  const sceneStatePath = path.join(bundlePath, "scene-state.json");
  const screenshots = fs
    .readdirSync(bundlePath)
    .filter((name) => name.startsWith("screenshot") && name.endsWith(".png"))
    .sort()
    .map((name) => path.resolve(bundlePath, name));
  if (!screenshots.length) throw new Error(`No screenshots found in bundle: ${bundlePath}`);
  return {
    console: readJson(consolePath),
    checks: readJson(checksPath),
    scene_state: fs.existsSync(sceneStatePath) ? readJson(sceneStatePath) : { available: false },
    screenshots,
  };
}

function formatConsole(consoleData: Record<string, any>): string {
  const errors: any[] = consoleData.errors ?? [];
  const messages: any[] = consoleData.console_messages ?? [];
  const parts: string[] = [];
  if (errors.length) {
    parts.push(`**Errors (${errors.length})**:`);
    for (const err of errors.slice(0, 5)) parts.push(`  - ${err.text ?? err.message ?? "Unknown error"}`);
    if (errors.length > 5) parts.push(`  ... and ${errors.length - 5} more errors`);
  } else {
    parts.push("**Errors**: None");
  }
  if (messages.length) {
    parts.push(`\n**Console Messages (${messages.length})**:`);
    for (const msg of messages.slice(0, 10)) parts.push(`  - [${msg.type ?? "log"}] ${msg.text ?? ""}`);
    if (messages.length > 10) parts.push(`  ... and ${messages.length - 10} more messages`);
  } else {
    parts.push("\n**Console Messages**: None");
  }
  return parts.join("\n");
}

function formatChecks(checksData: Record<string, any>): string {
  const checks: any[] = checksData.checks ?? [];
  if (!checks.length) return "No programmatic checks";
  const parts = checks.map(
    (check) =>
      `[${check.result === "pass" ? "PASS" : "FAIL"}] ${check.check_id ?? check.type} (${check.type}): ${check.detail ?? ""}`,
  );
  const summary = checksData.summary ?? {};
  parts.push(`\n**Summary**: ${summary.passed ?? 0}/${summary.total ?? 0} passed, ${summary.failed ?? 0} failed`);
  return parts.join("\n");
}

function describeScreenshots(paths: string[], side: string): string {
  if (!paths.length) return `(no screenshots captured for Candidate ${side})`;
  return paths.map((p, idx) => `- Candidate ${side}, frame ${idx + 1}: ${p}`).join("\n");
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/** Extract `{verdict, rationale}` from the judge's response (JSON, fenced, or inline). */
export function parseVerdict(responseText: string): { verdict: "A" | "B" | "TIE"; rationale: string } {
  const validate = (candidate: any): { verdict: "A" | "B" | "TIE"; rationale: string } | null => {
    if (candidate !== null && typeof candidate === "object" && "verdict" in candidate && "rationale" in candidate) {
      if (!["A", "B", "TIE"].includes(candidate.verdict)) {
        throw new Error(`Invalid verdict value: ${candidate.verdict}`);
      }
      return candidate;
    }
    return null;
  };

  try {
    const direct = validate(JSON.parse(responseText.trim()));
    if (direct) return direct;
  } catch (exc) {
    if (exc instanceof Error && exc.message.startsWith("Invalid verdict")) throw exc;
  }

  const fence = /```json\s*([\s\S]*?)```/.exec(responseText);
  if (fence) {
    try {
      const fenced = validate(JSON.parse(fence[1].trim()));
      if (fenced) return fenced;
    } catch (exc) {
      if (exc instanceof Error && exc.message.startsWith("Invalid verdict")) throw exc;
    }
  }

  for (const match of responseText.matchAll(/\{[^{}]*"verdict"[^{}]*"rationale"[^{}]*\}/gs)) {
    try {
      const inline = validate(JSON.parse(match[0]));
      if (inline) return inline;
    } catch (exc) {
      if (exc instanceof Error && exc.message.startsWith("Invalid verdict")) throw exc;
    }
  }

  throw new Error(
    "Could not parse verdict from judge response. Response must contain JSON with 'verdict' and 'rationale' keys. " +
      `Got: ${responseText.slice(0, 200)}`,
  );
}

/** Compare baseline vs candidate bundles blind and return a structured verdict. */
export function judgePairwise(
  scenario: Record<string, any>,
  baselineBundle: { path: string },
  candidateBundle: { path: string },
  options: PairwiseJudgeOptions,
): JudgeVerdict {
  const promptPath = path.join(options.promptsDir, `${options.protocol}.txt`);
  if (!fs.existsSync(promptPath)) throw new Error(`Prompt template not found: ${promptPath}`);
  const template = fs.readFileSync(promptPath, "utf-8");

  // Seeded blind A/B assignment (deterministic per seed).
  const flip = mulberry32(options.seed)() < 0.5;
  const [bundleA, bundleB] = flip ? [baselineBundle, candidateBundle] : [candidateBundle, baselineBundle];
  const labelMapping: JudgeVerdict["label_mapping"] = flip
    ? { A: "BASELINE", B: "CANDIDATE" }
    : { A: "CANDIDATE", B: "BASELINE" };

  const evidenceA = loadEvidence(bundleA.path);
  const evidenceB = loadEvidence(bundleB.path);
  const screenshotFiles = [...evidenceA.screenshots, ...evidenceB.screenshots];

  const prompt = renderTemplate(template, {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    scenario_description: scenario.description,
    scenario_prompt: scenario.prompt,
    expected_behaviors: (scenario.expected_behaviors ?? []).map((behavior: string) => `- ${behavior}`).join("\n"),
    visual_expectations: scenario.visual_expectations ?? "N/A",
    screenshots_a: describeScreenshots(evidenceA.screenshots, "A"),
    console_a: formatConsole(evidenceA.console),
    checks_a: formatChecks(evidenceA.checks),
    scene_state_a: JSON.stringify(evidenceA.scene_state, null, 2),
    screenshots_b: describeScreenshots(evidenceB.screenshots, "B"),
    console_b: formatConsole(evidenceB.console),
    checks_b: formatChecks(evidenceB.checks),
    scene_state_b: JSON.stringify(evidenceB.scene_state, null, 2),
  });

  const responseText = options.call(prompt, screenshotFiles);
  const parsed = parseVerdict(responseText);
  const finalVerdict: Verdict = parsed.verdict === "TIE" ? "TIE" : labelMapping[parsed.verdict];

  return {
    verdict: finalVerdict,
    rationale: parsed.rationale,
    harness: options.harness,
    model_id: options.model ?? `${options.harness}-default`,
    model_variant: options.variant,
    screenshot_input_mode: "attached_image_files",
    screenshots_attached: screenshotFiles.length,
    protocol_version: options.protocol,
    label_mapping: labelMapping,
    seed: options.seed,
  };
}

export interface PanelOptions extends Omit<PairwiseJudgeOptions, "seed"> {
  seeds: number[];
}

export interface PanelResult {
  verdict: Verdict | null;
  individual_verdicts: Array<Record<string, any>>;
  majority_count: number;
  judge_unavailable: boolean;
  scenario_id: string;
  protocol_version: string;
}

/** Invoke one judge per seed and compute the majority verdict. */
export function judgePanel(
  scenario: Record<string, any>,
  baselineBundle: { path: string },
  candidateBundle: { path: string },
  options: PanelOptions,
): PanelResult {
  const seeds = options.seeds;
  if (new Set(seeds).size !== seeds.length) {
    throw new Error(`panel seeds must all be different, got ${JSON.stringify(seeds)}`);
  }

  const individual: Array<Record<string, any>> = seeds.map((seed, index) => {
    try {
      const verdict = judgePairwise(scenario, baselineBundle, candidateBundle, { ...options, seed });
      return {
        judge_index: index,
        verdict: verdict.verdict,
        rationale: verdict.rationale,
        harness: verdict.harness,
        model_id: verdict.model_id,
        model_variant: verdict.model_variant,
        protocol_version: verdict.protocol_version,
        label_mapping: verdict.label_mapping,
        seed: verdict.seed,
      };
    } catch (exc: any) {
      return {
        judge_index: index,
        verdict: null,
        error: String(exc?.message ?? exc),
        harness: options.harness,
        model_id: options.model,
        seed,
      };
    }
  });

  const valid = individual.filter((entry) => entry.verdict !== null);
  if (valid.length < seeds.length) {
    return {
      verdict: null,
      individual_verdicts: individual,
      majority_count: 0,
      judge_unavailable: true,
      scenario_id: scenario.id,
      protocol_version: options.protocol,
    };
  }

  const counts = new Map<string, number>();
  for (const entry of valid) counts.set(entry.verdict, (counts.get(entry.verdict) ?? 0) + 1);
  let majorityVerdict: Verdict = "TIE";
  let majorityCount = 1;
  if (counts.size === valid.length && valid.length > 1) {
    // All different (e.g. 1-1-1): resolve to TIE.
    majorityVerdict = "TIE";
    majorityCount = 1;
  } else {
    for (const [verdict, count] of counts) {
      if (count > majorityCount || (count === majorityCount && majorityVerdict === "TIE")) {
        majorityVerdict = verdict as Verdict;
        majorityCount = count;
      }
    }
  }

  return {
    verdict: majorityVerdict,
    individual_verdicts: individual,
    majority_count: majorityCount,
    judge_unavailable: false,
    scenario_id: scenario.id,
    protocol_version: options.protocol,
  };
}

export function writeJudgeVerdicts(panelResult: PanelResult, outputPath: string): void {
  writeJsonPlain(outputPath, panelResult);
}
