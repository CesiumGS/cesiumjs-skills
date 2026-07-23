/**
 * `cesium-eval backfill` — backfill codegen provenance (harness, model,
 * effort) into historical scorecards. Port of backfill-scorecard-provenance.py.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { stableStringify } from "../lib/json.js";
import { fromRepoRoot, listDirs, repoRelative, repoRoot, walkFiles } from "../lib/paths.js";
import { evidenceSource, resolveCodegenProvenance } from "../evaluation/scorecard.js";

function discoverScorecards(): string[] {
  const roots = [fromRepoRoot("evaluation", "artifacts", "audits"), fromRepoRoot("evaluation", "artifacts", "scorecards")];
  const seen = new Set<string>();
  const found: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const filePath of walkFiles(root)) {
      const name = path.basename(filePath);
      if (!name.startsWith("scorecard") || !name.endsWith(".json")) continue;
      const resolved = path.resolve(filePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      found.push(filePath);
    }
  }
  return found;
}

function planStamps(scorecard: Record<string, any>, root: string): Record<string, string> {
  const provenance = resolveCodegenProvenance(scorecard, root);
  let artifacts = scorecard.artifacts;
  if (artifacts === null || typeof artifacts !== "object" || Array.isArray(artifacts)) artifacts = {};
  const stamps: Record<string, string> = {};

  const harnessField = scorecard.harness;
  if (!(typeof harnessField === "string" && harnessField.trim()) && provenance.harness) {
    stamps.harness = provenance.harness;
  }
  if (!(typeof artifacts.model === "string" && artifacts.model.trim()) && provenance.model) {
    stamps["artifacts.model"] = provenance.model;
  }
  if (!(typeof artifacts.model_variant === "string" && artifacts.model_variant.trim()) && provenance.model_variant) {
    stamps["artifacts.model_variant"] = provenance.model_variant;
  }
  if (!(typeof artifacts.evidence_source === "string" && artifacts.evidence_source.trim())) {
    const cases = scorecard.cases;
    if (Array.isArray(cases) && cases.length) {
      stamps["artifacts.evidence_source"] = evidenceSource(cases);
    }
  }
  return stamps;
}

function applyStamps(scorecard: Record<string, any>, stamps: Record<string, string>): void {
  let artifacts = scorecard.artifacts;
  if (artifacts === null || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    artifacts = {};
    scorecard.artifacts = artifacts;
  }
  for (const [label, value] of Object.entries(stamps)) {
    if (label === "harness") scorecard.harness = value;
    else if (label.startsWith("artifacts.")) artifacts[label.split(".").slice(1).join(".")] = value;
  }
}

export interface BackfillOptions {
  dryRun?: boolean;
  check?: boolean;
}

export async function backfillCommand(options: BackfillOptions): Promise<number> {
  const root = repoRoot();
  const scorecards = discoverScorecards();
  if (!scorecards.length) {
    console.log("[backfill] no scorecards found under evaluation/artifacts.");
    return 0;
  }

  let changed = 0;
  let unrecoverable = 0;
  for (const scorecardPath of scorecards) {
    let scorecard: any;
    try {
      scorecard = JSON.parse(fs.readFileSync(scorecardPath, "utf-8"));
    } catch (exc: any) {
      console.error(`[backfill] skip ${repoRelative(scorecardPath)}: ${exc.message}`);
      continue;
    }
    if (scorecard === null || typeof scorecard !== "object" || !Array.isArray(scorecard.cases)) continue;

    const stamps = planStamps(scorecard, root);
    const rel = repoRelative(scorecardPath);
    if (!Object.keys(stamps).length) {
      const hasModel = typeof (scorecard.artifacts ?? {}).model === "string";
      const hasHarness = typeof scorecard.harness === "string";
      if (!(hasModel && hasHarness)) unrecoverable += 1;
      continue;
    }

    const summary = Object.entries(stamps)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const verb = options.dryRun || options.check ? "would stamp" : "stamped";
    console.log(`[backfill] ${verb} ${rel}: ${summary}`);
    changed += 1;
    if (options.dryRun || options.check) continue;
    applyStamps(scorecard, stamps);
    fs.writeFileSync(scorecardPath, stableStringify(scorecard) + "\n");
  }

  console.log(
    `[backfill] ${scorecards.length} scorecard(s) scanned, ` +
      `${changed} ${options.dryRun || options.check ? "need" : "received"} stamps, ` +
      `${unrecoverable} with no recoverable provenance.`,
  );
  if (options.check && changed) return 1;
  return 0;
}
