#!/usr/bin/env node
/**
 * Materialize candidate skill documents from a pull request as DATA.
 *
 * This script runs from the repository's trusted default-branch checkout in a
 * workflow_run workflow. It never checks out or executes the pull-request
 * revision. Only bounded UTF-8 files under changed skills/<id>/ directories
 * are copied into the candidate artifact; scenario definitions and evaluator
 * code always come from the trusted checkout.
 */
import fs from "node:fs";
import path from "node:path";

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT_EXTENSIONS = new Set([".css", ".frag", ".glsl", ".html", ".js", ".json", ".md", ".txt", ".vert"]);
const MAX_FILES = 64;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 512 * 1024;
const MAX_SHARED_BYTES = 1024 * 1024;
const MAX_SHARED_FILES = 128;

export function changedSkillIds(files) {
  const ids = new Set();
  for (const file of files) {
    const match = /^skills\/([^/]+)\//.exec(String(file.filename ?? file));
    if (match && SKILL_ID.test(match[1])) ids.add(match[1]);
  }
  return [...ids].sort();
}

export function candidateEntries(tree, skill) {
  const prefix = `skills/${skill}/`;
  const entries = tree
    .filter((entry) => entry.path.startsWith(prefix) && entry.type === "blob")
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!entries.some((entry) => entry.path === `${prefix}SKILL.md`)) {
    throw new Error(`candidate revision has no ${prefix}SKILL.md`);
  }
  if (entries.length > MAX_FILES + 1) throw new Error(`${skill} has too many files (${entries.length}; maximum ${MAX_FILES + 1})`);
  let total = 0;
  for (const entry of entries) {
    const relative = entry.path.slice(prefix.length);
    if (entry.mode !== "100644") throw new Error(`${entry.path} is not a regular non-executable file (mode ${entry.mode})`);
    if (!TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
      throw new Error(`${entry.path} is not an approved text file type`);
    }
    const size = Number(entry.size ?? 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) {
      throw new Error(`${entry.path} exceeds the ${MAX_FILE_BYTES}-byte per-file limit`);
    }
    total += size;
  }
  if (total > MAX_BUNDLE_BYTES) throw new Error(`${skill} bundle exceeds the ${MAX_BUNDLE_BYTES}-byte limit`);
  return entries;
}

/** Supporting files from sibling skills may be explicitly linked by the
 * candidate SKILL.md. Materialize the bounded text-only support surface so the
 * evaluator can follow those links without any file/network tool. */
export function sharedSupportingEntries(tree) {
  const entries = tree
    .filter((entry) => /^skills\/[^/]+\/.+/.test(entry.path) && !entry.path.endsWith("/SKILL.md") && entry.type === "blob")
    .sort((a, b) => a.path.localeCompare(b.path));
  if (entries.length > MAX_SHARED_FILES) {
    throw new Error(`shared skill support surface has ${entries.length} files; maximum is ${MAX_SHARED_FILES}`);
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.mode !== "100644") throw new Error(`${entry.path} is not a regular non-executable file (mode ${entry.mode})`);
    if (!TEXT_EXTENSIONS.has(path.posix.extname(entry.path).toLowerCase())) throw new Error(`${entry.path} is not an approved text file type`);
    const size = Number(entry.size ?? 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) {
      throw new Error(`${entry.path} exceeds the ${MAX_FILE_BYTES}-byte per-file limit`);
    }
    total += size;
  }
  if (total > MAX_SHARED_BYTES) throw new Error(`shared skill support surface exceeds ${MAX_SHARED_BYTES} bytes`);
  return entries;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function githubJson(apiPath, token, allowAnonymousFallback = true) {
  const request = async (credential) => {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (credential) headers.Authorization = `Bearer ${credential}`;
    return fetch(`https://api.github.com${apiPath}`, { headers, signal: AbortSignal.timeout(30_000) });
  };
  let response = await request(token);
  if (allowAnonymousFallback && token && (response.status === 403 || response.status === 404)) response = await request("");
  if (!response.ok) throw new Error(`GitHub API ${apiPath} returned HTTP ${response.status}`);
  return response.json();
}

async function pagedPullFiles(repository, number, token) {
  const files = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubJson(`/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, token, false);
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  throw new Error("pull request exceeds the 3000-file API limit");
}

function appendOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

async function main() {
  const repository = required("GITHUB_REPOSITORY");
  const token = required("GITHUB_TOKEN");
  const prNumber = required("PR_NUMBER");
  const headRepository = required("HEAD_REPOSITORY");
  const headSha = required("HEAD_SHA");
  const baseRef = required("BASE_REF");
  const defaultBranch = required("DEFAULT_BRANCH");
  const upstreamConclusion = required("UPSTREAM_CONCLUSION");
  const outputRoot = path.resolve(required("CANDIDATE_ROOT"));

  const baseValues = { pr_number: prNumber, head_sha: headSha };
  if (upstreamConclusion !== "success") {
    appendOutput({ ...baseValues, eligible: "false", count: "0", skills: "", contract_only: "", reason: `PR Gate concluded ${upstreamConclusion}` });
    return;
  }
  if (baseRef !== defaultBranch) {
    appendOutput({ ...baseValues, eligible: "false", count: "0", skills: "", contract_only: "", reason: `PR targets ${baseRef}, not ${defaultBranch}` });
    return;
  }

  const files = await pagedPullFiles(repository, prNumber, token);
  const changed = changedSkillIds(files);
  if (!changed.length) {
    appendOutput({ ...baseValues, eligible: "true", count: "0", skills: "", contract_only: "", reason: "no skill files changed" });
    return;
  }

  const tree = await githubJson(`/repos/${headRepository}/git/trees/${encodeURIComponent(headSha)}?recursive=1`, token);
  if (tree.truncated) throw new Error("candidate git tree is truncated; refusing a partial skill bundle");

  const evaluated = [];
  const contractOnly = [];
  const manifestFiles = [];
  const selectedEntries = new Map();
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const skill of changed) {
    const scenarioDir = path.join(process.cwd(), "optimization", "scenarios", skill);
    const scenarios = fs.existsSync(scenarioDir)
      ? fs.readdirSync(scenarioDir).filter((name) => name.startsWith("eval-") && name.endsWith(".json"))
      : [];
    if (!scenarios.length) {
      contractOnly.push(skill);
      continue;
    }
    const entries = candidateEntries(tree.tree, skill);
    for (const entry of entries) selectedEntries.set(entry.path, entry);
    evaluated.push(skill);
  }

  if (evaluated.length) {
    for (const entry of sharedSupportingEntries(tree.tree)) selectedEntries.set(entry.path, entry);
  }
  for (const entry of [...selectedEntries.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const blob = await githubJson(`/repos/${headRepository}/git/blobs/${entry.sha}`, token);
    if (blob.encoding !== "base64") throw new Error(`${entry.path} blob was not returned as base64`);
    const bytes = Buffer.from(String(blob.content).replace(/\s/g, ""), "base64");
    if (bytes.length !== Number(entry.size)) throw new Error(`${entry.path} size changed during retrieval`);
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${entry.path} is not valid UTF-8 text`);
    }
    const destination = path.join(outputRoot, entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { mode: 0o600 });
    manifestFiles.push({ path: entry.path, sha: entry.sha, size: entry.size });
  }

  const manifest = {
    schema_version: "1.0",
    repository,
    pull_request: Number(prNumber),
    head_repository: headRepository,
    head_sha: headSha,
    base_ref: baseRef,
    evaluated_skills: evaluated,
    contract_only_skills: contractOnly,
    files: manifestFiles,
  };
  fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  appendOutput({
    ...baseValues,
    eligible: "true",
    count: String(evaluated.length),
    skills: evaluated.join(","),
    contract_only: contractOnly.join(","),
    reason: evaluated.length ? "candidate skill bundle prepared" : "changed skills have no trusted live scenarios",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`prepare-pr-skill-eval: ${error.message}`);
    process.exitCode = 1;
  });
}
