/**
 * The single source of truth for baseline scenarios and where their rendered
 * bundles live.
 *
 * Three consumers need exactly the same answer: the audit (which judges a
 * bundle), the renderer (which writes one), and the console (which reports
 * coverage). They each used to carry their own copy of this layout logic and
 * drifted apart — the console reported coverage for a case set the audit no
 * longer audited. Keep the mapping here so that cannot recur.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson } from "../lib/json.js";
import { fromRepoRoot, globFiles, listDirs } from "../lib/paths.js";

const scenariosRoot = () => fromRepoRoot("optimization", "scenarios");
const runsRoot = () => fromRepoRoot("optimization", "runs");
const generatedRoot = () => fromRepoRoot("optimization", "generated");

/** A baseline scenario: the unit the audit scores and the renderer draws. */
export interface BaselineScenario {
  skill: string;
  id: string;
  name: string;
  scenarioPath: string;
  doc: Record<string, any>;
}

/** Skills that ship baseline scenarios. */
export function baselineSkills(): string[] {
  return listDirs(scenariosRoot()).filter((name) => !name.startsWith("."));
}

/** Every baseline scenario for a skill, in stable id order. */
export function baselineScenarios(skill: string): BaselineScenario[] {
  const scenarios: BaselineScenario[] = [];
  for (const scenarioPath of globFiles(path.join(scenariosRoot(), skill), "eval-", ".json")) {
    let doc: Record<string, any>;
    try {
      doc = readJson(scenarioPath);
    } catch {
      continue; // an unreadable scenario is not a silently-passing one; it just isn't a case
    }
    const id = String(doc.id ?? "");
    if (!id) continue;
    scenarios.push({ skill, id, name: String(doc.name ?? id), scenarioPath, doc });
  }
  return scenarios.sort((a, b) => a.id.localeCompare(b.id));
}

/** Where a scenario's bundle belongs under a root: `<base>/<id>-<name>`. */
export function bundleDirFor(scenario: BaselineScenario, bundleRoot: string | null): string {
  const base = bundleRoot !== null ? path.join(bundleRoot, scenario.skill, "baseline") : path.join(runsRoot(), scenario.skill, "baseline");
  return path.join(base, `${scenario.id}-${scenario.name}`);
}

/**
 * The scenario's existing rendered bundle, or null when nothing is rendered.
 * Prefers the exact `<id>-<name>` directory and falls back to any sibling with
 * the same id prefix, which is how a bundle rendered under an older scenario
 * name still resolves.
 */
export function resolveBundleDir(scenario: BaselineScenario, bundleRoot: string | null): string | null {
  const expected = bundleDirFor(scenario, bundleRoot);
  if (fs.existsSync(expected) && fs.statSync(expected).isDirectory()) return expected;
  const base = path.dirname(expected);
  for (const name of listDirs(base)) {
    if (name.startsWith(`${scenario.id}-`)) return path.join(base, name);
  }
  return null;
}

/**
 * Files the audit's deterministic lane reads out of a rendered bundle.
 * `screenshot.png` feeds the visual lane; the two JSON documents feed the
 * console-error and programmatic-check evidence.
 */
export const BUNDLE_EVIDENCE_FILES = ["screenshot.png", "console.json", "programmatic-checks.json"] as const;

/**
 * Whether a scenario's bundle holds everything an audit reads.
 *
 * Deliberately stricter than screenshot coverage: a bundle can carry a
 * screenshot (so the visual lane can judge it) while lacking console.json /
 * programmatic-checks.json (so the deterministic lane reports it as an
 * incomplete render). "Covered" and "auditable" are different questions —
 * this is the second one, and it lives here so every caller asks it the same
 * way.
 */
export function isBundleComplete(scenario: BaselineScenario, bundleRoot: string | null): boolean {
  const dir = resolveBundleDir(scenario, bundleRoot);
  if (dir === null) return false;
  return BUNDLE_EVIDENCE_FILES.every((file) => fs.existsSync(path.join(dir, file)));
}

/** Where the optimization loop writes a scenario's baseline source. */
export function generatedCodePath(scenario: BaselineScenario): string {
  return path.join(generatedRoot(), scenario.skill, "baseline", `${scenario.id}.js`);
}

/** The scenario's generated baseline source, or null when it has not been produced. */
export function readGeneratedCode(scenario: BaselineScenario): string | null {
  const codePath = generatedCodePath(scenario);
  if (!fs.existsSync(codePath)) return null;
  const code = fs.readFileSync(codePath, "utf-8");
  return code.trim() ? code : null;
}
