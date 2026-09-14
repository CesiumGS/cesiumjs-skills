/**
 * Pairwise judging: a single seeded judge compares baseline vs candidate
 * bundles blind (A/B label randomization), and a panel of N judges takes a
 * majority vote. The LLM call is injected so the logic stays unit testable.
 *
 * Blinding: the A/B flip is derived from (seed, scenario id, salt) so the
 * arrangement varies across scenarios/iterations; screenshots are staged
 * under neutral filenames and evidence text is scrubbed of bundle paths so
 * the prompt cannot reveal which side is the baseline. Real artifact paths
 * live only in the persisted verdict record (`screenshot_sources`).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readJson, writeJsonPlain } from "../lib/json.js";
import { hashSeed, mulberry32 } from "../lib/random.js";

/** One pairwise LLM call: rendered prompt + attached screenshots -> raw text
 * plus the agent that actually made the call (for truthful provenance). */
export interface PairwiseCallResult {
  text: string;
  agent?: { harness: string; model: string; variant: string | null };
}
export type PairwiseCall = (prompt: string, files: string[]) => Promise<PairwiseCallResult>;

export interface PairwiseJudgeOptions {
  call: PairwiseCall;
  /** Provenance stamped into the verdict record. */
  harness: string;
  model: string | null;
  variant: string | null;
  protocol: string;
  promptsDir: string;
  seed: number;
  /** Extra entropy for the blind A/B flip (e.g. the iteration id). */
  flipSalt?: string;
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
  /** Neutral attached filename -> real artifact path (traceability lives here, not in the prompt). */
  screenshot_sources: Record<string, string>;
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

function describeScreenshots(neutralNames: string[], side: string): string {
  if (!neutralNames.length) return `(no screenshots captured for Candidate ${side})`;
  return neutralNames.map((name, idx) => `- Candidate ${side}, frame ${idx + 1} (attached as ${name})`).join("\n");
}

/** Scrub bundle paths from evidence text so the prompt cannot de-anonymize a side. */
function sanitizeEvidenceText(text: string, redactions: Array<[string, string]>): string {
  let out = text;
  for (const [needle, token] of redactions) {
    if (needle) out = out.split(needle).join(token);
  }
  return out;
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
export async function judgePairwise(
  scenario: Record<string, any>,
  baselineBundle: { path: string },
  candidateBundle: { path: string },
  options: PairwiseJudgeOptions,
): Promise<JudgeVerdict> {
  const promptPath = path.join(options.promptsDir, `${options.protocol}.txt`);
  if (!fs.existsSync(promptPath)) throw new Error(`Prompt template not found: ${promptPath}`);
  const template = fs.readFileSync(promptPath, "utf-8");

  // Blind A/B assignment: deterministic per (seed, scenario, salt) so the
  // arrangement varies across scenarios instead of being frozen per seed.
  const flip = mulberry32(hashSeed(options.seed, String(scenario.id ?? ""), options.flipSalt ?? ""))() < 0.5;
  const [bundleA, bundleB] = flip ? [baselineBundle, candidateBundle] : [candidateBundle, baselineBundle];
  const labelMapping: JudgeVerdict["label_mapping"] = flip
    ? { A: "BASELINE", B: "CANDIDATE" }
    : { A: "CANDIDATE", B: "BASELINE" };

  const evidenceA = loadEvidence(bundleA.path);
  const evidenceB = loadEvidence(bundleB.path);

  // Stage screenshots under neutral filenames so neither the prompt text nor
  // the attached files can reveal which side is the baseline.
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-eval-judge-"));
  const screenshotSources: Record<string, string> = {};
  const stageSide = (sources: string[], side: "a" | "b"): string[] =>
    sources.map((source, index) => {
      const neutralName = `candidate-${side}-frame-${index + 1}.png`;
      const staged = path.join(stagingDir, neutralName);
      fs.copyFileSync(source, staged);
      screenshotSources[neutralName] = source;
      return staged;
    });

  try {
    const stagedA = stageSide(evidenceA.screenshots, "a");
    const stagedB = stageSide(evidenceB.screenshots, "b");
    const screenshotFiles = [...stagedA, ...stagedB];

    const redactions: Array<[string, string]> = [
      [path.resolve(bundleA.path), "<candidate-a-evidence>"],
      [path.dirname(path.resolve(bundleA.path)), "<candidate-a-runs>"],
      [path.resolve(bundleB.path), "<candidate-b-evidence>"],
      [path.dirname(path.resolve(bundleB.path)), "<candidate-b-runs>"],
    ];
    const scrub = (text: string) => sanitizeEvidenceText(text, redactions);

    const prompt = renderTemplate(template, {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      scenario_description: scenario.description,
      scenario_prompt: scenario.prompt,
      expected_behaviors: (scenario.expected_behaviors ?? []).map((behavior: string) => `- ${behavior}`).join("\n"),
      visual_expectations: scenario.visual_expectations ?? "N/A",
      screenshots_a: describeScreenshots(stagedA.map((p) => path.basename(p)), "A"),
      console_a: scrub(formatConsole(evidenceA.console)),
      checks_a: scrub(formatChecks(evidenceA.checks)),
      scene_state_a: scrub(JSON.stringify(evidenceA.scene_state, null, 2)),
      screenshots_b: describeScreenshots(stagedB.map((p) => path.basename(p)), "B"),
      console_b: scrub(formatConsole(evidenceB.console)),
      checks_b: scrub(formatChecks(evidenceB.checks)),
      scene_state_b: scrub(JSON.stringify(evidenceB.scene_state, null, 2)),
    });

    const response = await options.call(prompt, screenshotFiles);
    const parsed = parseVerdict(response.text);
    const finalVerdict: Verdict = parsed.verdict === "TIE" ? "TIE" : labelMapping[parsed.verdict];

    // Provenance: prefer what the invocation reports it actually used over the
    // configured judge agent.
    const actual = response.agent;
    return {
      verdict: finalVerdict,
      rationale: parsed.rationale,
      harness: actual?.harness ?? options.harness,
      model_id: actual?.model ?? options.model ?? `${options.harness}-default`,
      model_variant: actual?.variant ?? options.variant,
      screenshot_input_mode: "attached_image_files",
      screenshots_attached: screenshotFiles.length,
      protocol_version: options.protocol,
      label_mapping: labelMapping,
      seed: options.seed,
      screenshot_sources: screenshotSources,
    };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
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

/** Invoke one judge per seed (concurrently) and compute the majority verdict. */
export async function judgePanel(
  scenario: Record<string, any>,
  baselineBundle: { path: string },
  candidateBundle: { path: string },
  options: PanelOptions,
): Promise<PanelResult> {
  const seeds = options.seeds;
  if (new Set(seeds).size !== seeds.length) {
    throw new Error(`panel seeds must all be different, got ${JSON.stringify(seeds)}`);
  }

  const individual: Array<Record<string, any>> = await Promise.all(
    seeds.map(async (seed, index) => {
      try {
        const verdict = await judgePairwise(scenario, baselineBundle, candidateBundle, { ...options, seed });
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
        screenshot_sources: verdict.screenshot_sources,
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
    }),
  );

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
    // Ambiguous split between BASELINE and CANDIDATE (e.g. 2-2 on an even
    // panel): never let map insertion order pick a winner — resolve to TIE.
    const topCount = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, count]) => count === topCount).map(([verdict]) => verdict);
    if (leaders.length > 1 && leaders.some((verdict) => verdict !== "TIE")) {
      majorityVerdict = "TIE";
      majorityCount = topCount;
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
