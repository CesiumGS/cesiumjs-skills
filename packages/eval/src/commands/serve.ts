/**
 * `cesium-eval serve` — the Skill Evaluation Console server: serves the built
 * console SPA plus the JSON API over the scorecard/optimization artifacts.
 * Artifacts stay the immutable source of truth; this server only reads them
 * and writes the human review state (review-decisions/focus/handoff).
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { URL } from "node:url";
import { readJson, readJsonOrNull, stableStringify, writeJsonAtomic } from "../lib/json.js";
import { fromRepoRoot, globFiles, isUnder, listDirs, repoRelative } from "../lib/paths.js";
import { evidenceSource as classifyEvidenceSource, resolveCodegenProvenance } from "../evaluation/scorecard.js";
import { buildFocus } from "../optimization/scorecardFocus.js";
import * as optimizationData from "../console/optimizationData.js";
import * as insightsData from "../console/insightsData.js";
import * as liveData from "../console/liveData.js";
import * as harnessData from "../console/harnessData.js";
import type { EvalContext } from "../config/types.js";

const scenariosRootDir = () => fromRepoRoot("optimization", "scenarios");
const distRoot = () => fromRepoRoot("apps", "evaluation-console", "dist");

function knownScenarioSkills(): Set<string> {
  const root = scenariosRootDir();
  return new Set(listDirs(root).filter((name) => globFiles(path.join(root, name), "eval-", ".json").length));
}

// ---------------------------------------------------------------------------
// viewer context (focused run + review-state paths)
// ---------------------------------------------------------------------------
class ViewerState {
  scorecardPath: string;
  scorecard: Record<string, any>;
  runId: string;
  harness: string;
  source: string;
  harnessJudge: string;
  stateDir!: string;
  reviewDecisionsPath!: string;
  optimizationHandoffPath!: string;
  focusPath!: string;

  constructor(
    private ctx: EvalContext,
    scorecardPath: string,
    stateDir?: string,
  ) {
    this.scorecardPath = path.resolve(scorecardPath);
    this.scorecard = ViewerState.loadScorecard(this.scorecardPath);
    this.runId = String(this.scorecard.run_id ?? path.basename(this.scorecardPath, ".json"));
    this.harness = resolveHarness(this.ctx, this.scorecard, this.scorecardPath);
    this.source = resolveSource(this.scorecard);
    const artifacts = this.scorecard.artifacts ?? {};
    const judge = typeof artifacts.harness_judge === "string" ? artifacts.harness_judge.trim() : "";
    this.harnessJudge = judge;
    this.setStateDir(stateDir ?? path.dirname(this.scorecardPath));
  }

  setStateDir(stateDir: string): void {
    this.stateDir = path.resolve(stateDir);
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.reviewDecisionsPath = path.join(this.stateDir, "review-decisions.json");
    this.optimizationHandoffPath = path.join(this.stateDir, "optimization-handoff.json");
    this.focusPath = path.join(this.stateDir, "focus.json");
  }

  static loadScorecard(scorecardPath: string): Record<string, any> {
    if (!fs.existsSync(scorecardPath)) throw new Error(`scorecard does not exist: ${scorecardPath}`);
    const value = readJson(scorecardPath);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`scorecard must be a JSON object: ${scorecardPath}`);
    }
    if (!Array.isArray(value.cases)) throw new Error(`scorecard is missing a cases array: ${scorecardPath}`);
    return value;
  }

  config(): Record<string, string> {
    return {
      repo_root: this.ctx.repoRoot,
      scorecard_path: this.scorecardPath,
      review_decisions_path: this.reviewDecisionsPath,
      optimization_handoff_path: this.optimizationHandoffPath,
      focus_path: this.focusPath,
      run_id: this.runId,
      harness: this.harness,
      source: this.source,
      harness_judge: this.harnessJudge,
    };
  }
}

/**
 * Resolve the codegen harness a scorecard was produced with. Order: stamped
 * top-level field; legacy directory-name token (matched against registry ids);
 * meta-sidecar provenance; the first-class "unknown" bucket. Never guessed.
 */
function resolveHarness(
  ctx: EvalContext,
  scorecard: Record<string, any>,
  scorecardPath: string,
  provenance?: Record<string, string>,
): string {
  const field = scorecard.harness;
  if (typeof field === "string" && field.trim()) return field.trim();
  const dirName = path.basename(path.dirname(scorecardPath)).toLowerCase();
  for (const harness of ctx.registry.harnesses) {
    if (dirName.includes(harness.id)) return harness.id;
  }
  const recovered = (provenance ?? resolveCodegenProvenance(scorecard, ctx.repoRoot)).harness;
  if (typeof recovered === "string" && recovered.trim()) return recovered.trim();
  return "unknown";
}

/** Classify the run's evidence source: agent | fixtures | mixed (derived, never guessed). */
function resolveSource(scorecard: Record<string, any>): string {
  const artifacts = scorecard.artifacts;
  if (artifacts !== null && typeof artifacts === "object" && !Array.isArray(artifacts)) {
    const stamped = artifacts.evidence_source;
    if (typeof stamped === "string" && ["agent", "fixtures", "mixed"].includes(stamped)) return stamped;
  }
  return classifyEvidenceSource(scorecard.cases ?? []);
}

// ---------------------------------------------------------------------------
// run discovery + summaries
// ---------------------------------------------------------------------------
function runSummary(ctx: EvalContext, scorecardPath: string): Record<string, any> | null {
  let sc: any;
  try {
    sc = readJson(scorecardPath);
  } catch {
    return null;
  }
  if (sc === null || typeof sc !== "object" || !Array.isArray(sc.cases)) return null;
  const vs = sc.visual_summary ?? {};
  const artifacts = sc.artifacts !== null && typeof sc.artifacts === "object" ? sc.artifacts : {};
  const cases = sc.cases ?? [];
  const detFail = cases.filter((c: any) => c.result === "fail").length;

  const model = typeof artifacts.model === "string" ? artifacts.model : null;
  const modelVariant = typeof artifacts.model_variant === "string" ? artifacts.model_variant : null;
  const harnessStamped = typeof sc.harness === "string" && Boolean(sc.harness.trim());
  const provenance = model === null || !harnessStamped ? resolveCodegenProvenance(sc, ctx.repoRoot) : {};

  return {
    run_id: String(sc.run_id ?? path.basename(scorecardPath, ".json")),
    scorecard_path: path.resolve(scorecardPath),
    timestamp_utc: String(sc.timestamp_utc ?? ""),
    overall_result: String(sc.overall_result ?? ""),
    git_commit: String(sc.git_commit ?? ""),
    harness: resolveHarness(ctx, sc, scorecardPath, provenance),
    source: resolveSource(sc),
    model: model ?? provenance.model ?? null,
    model_variant: modelVariant ?? provenance.model_variant ?? null,
    harness_judge: typeof artifacts.harness_judge === "string" ? artifacts.harness_judge : null,
    overall_score: typeof sc.overall_score === "number" ? sc.overall_score : null,
    threshold: typeof sc.threshold === "number" ? sc.threshold : null,
    det_pass_count: cases.length - detFail,
    det_fail_count: detFail,
    visual_review_supplied: Boolean(vs.visual_review_supplied ?? false),
    pass_count: Number(vs.pass_count ?? 0),
    fail_count: Number(vs.fail_count ?? 0),
    needs_review_count: Number(vs.needs_review_count ?? 0),
    not_reviewed_count: Number(vs.not_reviewed_count ?? 0),
    total_cases: Number(vs.total_cases ?? cases.length),
  };
}

function listRuns(ctx: EvalContext): Array<Record<string, any>> {
  // Canonical eval scorecards first: audit pipelines copy a scorecard (same
  // run_id) into audits/, and showing both would render as a confusing
  // duplicate row. First writer wins per run_id, so scorecards/ shadows
  // audits/, and each run carries which kind of artifact it is.
  const bases: Array<{ dir: string; kind: "eval" | "audit" }> = [
    { dir: fromRepoRoot("evaluation", "artifacts", "scorecards"), kind: "eval" },
    { dir: fromRepoRoot("evaluation", "artifacts", "audits"), kind: "audit" },
  ];
  const runs: Array<Record<string, any>> = [];
  const seenIds = new Set<string>();
  for (const { dir, kind } of bases) {
    if (!fs.existsSync(dir)) continue;
    for (const name of listDirs(dir)) {
      const scPath = path.join(dir, name, "scorecard.json");
      if (!fs.existsSync(scPath)) continue;
      const summary = runSummary(ctx, scPath);
      if (!summary || seenIds.has(summary.run_id)) continue;
      seenIds.add(summary.run_id);
      summary.kind = kind;
      runs.push(summary);
    }
  }
  runs.sort((a, b) => (a.timestamp_utc < b.timestamp_utc ? 1 : a.timestamp_utc > b.timestamp_utc ? -1 : 0));
  return runs;
}

function findRunScorecard(ctx: EvalContext, runId: string): string | null {
  return listRuns(ctx).find((run) => run.run_id === runId)?.scorecard_path ?? null;
}

function runCases(ctx: EvalContext, runId: string): Record<string, any> {
  const scorecardPath = findRunScorecard(ctx, runId);
  if (scorecardPath === null || !fs.existsSync(scorecardPath)) throw new NotFoundError(`run not found: ${runId}`);
  const sc = readJson(scorecardPath);
  const rows = (sc.cases ?? []).map((caseRow: any) => {
    const vr = caseRow.visual_review !== null && typeof caseRow.visual_review === "object" ? caseRow.visual_review : {};
    return {
      key: `${caseRow.skill ?? ""}/${caseRow.case_id ?? ""}`,
      result: caseRow.result ?? null,
      score: caseRow.score ?? null,
      visual_status: vr.status ?? "not_reviewed",
      visual_score: vr.overall_score ?? vr.score ?? null,
    };
  });
  return { run_id: runId, cases: rows };
}

function withProvenance(summary: Record<string, any>, skill: string): Record<string, any> {
  summary.provenance = insightsData.iterationProvenance(skill, String(summary.iteration ?? ""));
  return summary;
}

function skillsWithProvenance(ctx: EvalContext): Array<Record<string, any>> {
  const skills = optimizationData.listSkills(ctx.config.liveness.runningMaxAgeSeconds);
  for (const overview of skills) {
    for (const summary of overview.history) withProvenance(summary, overview.skill);
    if (overview.latest) withProvenance(overview.latest, overview.skill);
  }
  return skills;
}

// ---------------------------------------------------------------------------
// focus bridge + handoff
// ---------------------------------------------------------------------------
const caseKeyOf = (caseRow: Record<string, any>): string => `${caseRow.skill ?? ""}/${caseRow.case_id ?? ""}`;

function restrictedScorecard(scorecard: Record<string, any>, confirmedKeys: Set<string>): Record<string, any> {
  const cases: Array<Record<string, any>> = [];
  for (const original of scorecard.cases ?? []) {
    if (!confirmedKeys.has(caseKeyOf(original))) continue;
    const caseRow = structuredClone(original);
    const vr = caseRow.visual_review;
    const vrIsObject = vr !== null && typeof vr === "object" && !Array.isArray(vr);
    if (vrIsObject) {
      vr.required = true;
      if (String(vr.reviewer ?? "unassigned") === "unassigned") vr.reviewer = "human-review";
    }
    const detFail = (caseRow.checks ?? []).some((c: any) => c.result === "fail");
    const visStatus = String((vrIsObject ? vr : {}).status ?? "not_reviewed");
    const visFail = vrIsObject && !["pass", "not_required", "not_applicable"].includes(visStatus);
    if (!(detFail || visFail)) {
      (caseRow.checks ??= []).push({
        check_id: "human_flagged",
        type: "human_review",
        category: "human_review",
        critical: false,
        result: "fail",
        weight: 1.0,
        tolerance: null,
        actual: "flagged",
        expected: "pass",
        detail: "Flagged during human review.",
        metadata: {},
      });
    }
    cases.push(caseRow);
  }
  return {
    schema_version: scorecard.schema_version ?? "1.0",
    run_id: scorecard.run_id ?? "",
    git_commit: scorecard.git_commit ?? "",
    overall_result: scorecard.overall_result ?? "",
    overall_score: scorecard.overall_score ?? 0.0,
    threshold: scorecard.threshold ?? 0.95,
    category_scores: scorecard.category_scores ?? {},
    visual_summary: scorecard.visual_summary ?? {},
    cases,
    critical_failures: (scorecard.critical_failures ?? []).filter((f: any) => confirmedKeys.has(`${f.skill ?? ""}/${f.case_id ?? ""}`)),
  };
}

function buildFocusPayload(state: ViewerState, confirmedCaseKeys: string[]): Record<string, any> {
  const keys = new Set(confirmedCaseKeys.map(String));
  const focus = buildFocus(restrictedScorecard(state.scorecard, keys));
  const surviving = new Set((focus.cases ?? []).map((c: any) => `${c.skill ?? ""}/${c.case_id ?? ""}`));
  const dropped = [...keys].filter((key) => !surviving.has(key)).sort();
  const known = knownScenarioSkills();
  const rawSkills: string[] = (focus.skills ?? []).map((item: any) => String(item.skill)).filter(Boolean);
  const skills = known.size ? rawSkills.filter((skill) => known.has(skill)) : rawSkills;
  const focusRel = repoRelative(state.focusPath);
  const command = skills.length
    ? `cesium-eval optimize all \\\n  --from-focus ${focusRel} \\\n  --skills ${skills.join(",")}`
    : "# No confirmed flags selected for optimization.";
  return {
    focus,
    command,
    skills,
    dropped,
    case_count: (focus.cases ?? []).length,
    focus_path: state.focusPath,
  };
}

function buildHandoffDoc(state: ViewerState, focusPayload: Record<string, any>, selectionMode: string): Record<string, any> {
  const focus = focusPayload.focus;
  const byKey = new Map((state.scorecard.cases ?? []).map((c: any) => [caseKeyOf(c), c]));

  const verdicts = (caseRow: Record<string, any>): [string, string] => {
    const src: Record<string, any> = byKey.get(`${caseRow.skill ?? ""}/${caseRow.case_id ?? ""}`) ?? {};
    let det = String(src.result ?? "fail");
    if (!["pass", "fail"].includes(det)) det = "fail";
    const vis = String((src.visual_review ?? {}).status ?? "not_reviewed");
    return [det, vis];
  };

  const caseDocs: Array<Record<string, any>> = [];
  const skillCaseCounts = new Map<string, number>();
  const skillCategories = new Map<string, Set<string>>();
  for (const caseRow of focus.cases ?? []) {
    const failedChecks = caseRow.failed_checks ?? [];
    const firstCheck = failedChecks[0] ?? {};
    const skill = String(caseRow.skill ?? "");
    const category = String(firstCheck.category ?? "uncategorized");
    skillCaseCounts.set(skill, (skillCaseCounts.get(skill) ?? 0) + 1);
    if (!skillCategories.has(skill)) skillCategories.set(skill, new Set());
    skillCategories.get(skill)!.add(category);
    const [deterministicResult, visualStatus] = verdicts(caseRow);
    caseDocs.push({
      skill,
      case_id: String(caseRow.case_id ?? ""),
      case_name: String(caseRow.case_name ?? ""),
      category,
      deterministic_result: deterministicResult,
      visual_status: visualStatus,
      priority: 0,
      summary: String(firstCheck.detail ?? caseRow.task ?? ""),
      evidence_path: String(caseRow.evidence_path ?? ""),
      selection_reason: selectionMode,
    });
  }

  const skillDocs = (focus.skills ?? [])
    .map((item: any) => String(item.skill ?? ""))
    .filter(Boolean)
    .map((skill: string) => ({
      skill,
      failed_cases: skillCaseCounts.get(skill) ?? 0,
      categories: [...(skillCategories.get(skill) ?? new Set<string>())].sort(),
      priority: 0,
    }));

  return {
    schema_version: "1.0",
    run_id: state.runId,
    scorecard_path: state.scorecardPath,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    selection_mode: selectionMode,
    focus_path: state.focusPath,
    command: focusPayload.command,
    skills: skillDocs,
    cases: caseDocs,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
class NotFoundError extends Error {}
class ForbiddenError extends Error {}
class PayloadTooLargeError extends Error {}
class ConflictError extends Error {}

function resolveRepoArtifact(ctx: EvalContext, pathText: string): string {
  const resolved = path.isAbsolute(pathText) ? path.resolve(pathText) : path.resolve(ctx.repoRoot, pathText);
  if (!isUnder(resolved, ctx.repoRoot)) throw new ForbiddenError(`artifact path escapes repository root: ${pathText}`);
  return resolved;
}

function screenshotFallback(target: string): string | null {
  if (!path.basename(target).startsWith("screenshot")) return null;
  const dir = path.dirname(target);
  const candidates = [
    ...[0, 1, 2, 3].map((i) => path.join(dir, `screenshot-${i}.png`)),
    ...globFiles(dir, "screenshot", ".png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  const data = Buffer.from(stableStringify(value) + "\n");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

function sendError(res: http.ServerResponse, exc: unknown): void {
  let status = 500;
  if (exc instanceof NotFoundError) status = 404;
  else if (exc instanceof ForbiddenError) status = 403;
  else if (exc instanceof PayloadTooLargeError) status = 413;
  else if (exc instanceof ConflictError) status = 409;
  else if (exc instanceof SyntaxError) status = 400;
  const error = exc instanceof Error ? exc : new Error(String(exc));
  sendJson(res, { error: error.message, type: error.constructor.name }, status);
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "no-cache",
  });
  res.end(data);
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — review decisions and focus payloads are small

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new PayloadTooLargeError(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

// ---------------------------------------------------------------------------
// serve command
// ---------------------------------------------------------------------------
export interface ServeOptions {
  scorecard?: string;
  stateDir?: string;
  host?: string;
  port?: number;
  open?: boolean;
}

export async function serveCommand(ctx: EvalContext, options: ServeOptions): Promise<number> {
  const stateDirOverride = options.stateDir ? path.resolve(options.stateDir) : null;
  const initialScorecard =
    options.scorecard !== undefined
      ? path.resolve(options.scorecard)
      : (listRuns(ctx)[0]?.scorecard_path as string | undefined);
  let state: ViewerState | null = initialScorecard
    ? new ViewerState(ctx, initialScorecard, stateDirOverride ?? undefined)
    : null;
  const requireFocusedState = (): ViewerState => {
    if (state === null) {
      throw new ConflictError("no evaluation run is loaded; create or select a run first");
    }
    return state;
  };
  const config = (): Record<string, unknown> =>
    state?.config() ?? {
      repo_root: ctx.repoRoot,
      scorecard_path: null,
      review_decisions_path: null,
      optimization_handoff_path: null,
      focus_path: null,
      run_id: null,
      harness: null,
      source: null,
      harness_judge: null,
    };

  const host = options.host ?? ctx.config.server.host;
  const port = options.port ?? ctx.config.server.port;

  // Browsers can reach loopback servers from any webpage (simple cross-origin
  // POSTs need no CORS preflight, and DNS rebinding defeats the bind-address
  // assumption), so validate Host on every request and Origin on mutations.
  const allowedHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]", host]);
  const hostnameOf = (hostHeader: string): string => {
    try {
      return new URL(`http://${hostHeader}`).hostname;
    } catch {
      return "";
    }
  };
  const rejectUntrusted = (req: http.IncomingMessage, method: string): void => {
    const hostHeader = req.headers.host ?? "";
    if (!allowedHostnames.has(hostnameOf(hostHeader))) {
      throw new ForbiddenError(`untrusted Host header: '${hostHeader}'`);
    }
    const claimedRoot = req.headers["x-cesium-skills-root"];
    if (typeof claimedRoot === "string" && path.resolve(claimedRoot) !== path.resolve(ctx.repoRoot)) {
      throw new ConflictError(
        `checkout mismatch: client belongs to '${path.resolve(claimedRoot)}', server belongs to '${ctx.repoRoot}'`,
      );
    }
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = "";
        try {
          originHost = new URL(origin).hostname;
        } catch {
          // fall through to rejection
        }
        if (!allowedHostnames.has(originHost)) {
          throw new ForbiddenError(`cross-origin request rejected: '${origin}'`);
        }
      }
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = url.pathname;
      const method = req.method ?? "GET";
      console.error(`[eval-console] ${req.socket.remoteAddress} - ${method} ${route}`);
      rejectUntrusted(req, method);

      if (method === "GET") {
        if (route === "/api/config") return sendJson(res, config());
        if (route === "/api/scorecard") return sendJson(res, state?.scorecard ?? null);
        if (route === "/api/review-decisions") {
          return sendJson(
            res,
            state !== null && fs.existsSync(state.reviewDecisionsPath) ? readJson(state.reviewDecisionsPath) : null,
          );
        }
        if (route === "/api/runs") return sendJson(res, listRuns(ctx));
        if (route === "/api/run-cases") return sendJson(res, runCases(ctx, url.searchParams.get("run_id") ?? ""));
        if (route === "/api/registry") return sendJson(res, insightsData.registry(ctx));
        if (route === "/api/harnesses") return sendJson(res, harnessData.harnessHealth(ctx));
        if (route === "/api/insights") return sendJson(res, insightsData.insights(ctx, listRuns(ctx)));
        if (route === "/api/artifact") {
          const pathValue = url.searchParams.get("path") ?? "";
          if (!pathValue) throw new NotFoundError("missing artifact path");
          let target = resolveRepoArtifact(ctx, pathValue);
          if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
            const fallback = screenshotFallback(target);
            if (fallback === null) throw new NotFoundError(`artifact does not exist: ${pathValue}`);
            target = fallback;
          }
          return sendFile(res, target);
        }
        if (route === "/api/optimization/skills") return sendJson(res, skillsWithProvenance(ctx));
        if (route === "/api/optimization/skill") {
          return sendJson(
            res,
            optimizationData.skillOverview(url.searchParams.get("skill") ?? "", ctx.config.liveness.runningMaxAgeSeconds),
          );
        }
        if (route === "/api/optimization/iteration") {
          const skill = url.searchParams.get("skill") ?? "";
          const detail = optimizationData.iterationDetail(
            skill,
            url.searchParams.get("iteration") ?? "",
            ctx.config.liveness.runningMaxAgeSeconds,
          );
          return sendJson(res, withProvenance(detail, skill));
        }
        if (route === "/api/optimization/active") return sendJson(res, optimizationData.activeRuns());
        if (route === "/api/live") return sendJson(res, liveData.liveStatus(ctx));
        if (route === "/api/live/skills") return sendJson(res, { skills: liveData.availableSkills() });

        // static SPA
        let staticPath: string;
        if (route === "" || route === "/") staticPath = path.join(distRoot(), "index.html");
        else {
          staticPath = path.resolve(distRoot(), decodeURIComponent(route.replace(/^\//, "")));
          if (!isUnder(staticPath, distRoot()) || !fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
            staticPath = path.join(distRoot(), "index.html");
          }
        }
        if (!fs.existsSync(staticPath)) {
          throw new NotFoundError(
            `viewer build not found at ${distRoot()}; run \`npm run build\` in apps/evaluation-console`,
          );
        }
        return sendFile(res, staticPath);
      }

      if (method === "PUT" || method === "POST") {
        const payload = await readBody(req);
        if (route === "/api/review-decisions") {
          const focused = requireFocusedState();
          writeJsonAtomic(focused.reviewDecisionsPath, payload);
          return sendJson(res, payload);
        }
        if (route === "/api/focus-preview") {
          return sendJson(res, buildFocusPayload(requireFocusedState(), [...(payload.confirmed_case_keys ?? [])]));
        }
        if (route === "/api/optimization-handoff") {
          const focused = requireFocusedState();
          const keys = [...(payload.confirmed_case_keys ?? [])];
          const selectionMode = String(payload.selection_mode ?? "confirmed_flags");
          const result = buildFocusPayload(focused, keys);
          writeJsonAtomic(focused.focusPath, result.focus);
          writeJsonAtomic(focused.optimizationHandoffPath, buildHandoffDoc(focused, result, selectionMode));
          return sendJson(res, {
            handoff_path: focused.optimizationHandoffPath,
            focus_path: focused.focusPath,
            command: result.command,
            focus_preview: result,
          });
        }
        if (route === "/api/select-run") {
          const runId = String(payload.run_id ?? "");
          const target = findRunScorecard(ctx, runId);
          if (target === null || !fs.existsSync(target)) throw new NotFoundError(`run not found: ${runId}`);
          const next = new ViewerState(ctx, target);
          if (stateDirOverride !== null) next.setStateDir(path.join(stateDirOverride, next.runId));
          state = next;
          return sendJson(res, config());
        }
        if (route === "/api/live/launch") return sendJson(res, liveData.launchRun(ctx, payload));
        if (route === "/api/probe") {
          // Synchronous by design: the response IS the probe result (2-40s
          // per registry latencies; the UI shows per-row progress). Probes
          // serialize globally — a second concurrent request gets a 409.
          try {
            return sendJson(res, await harnessData.probeHarness(ctx, payload));
          } catch (exc) {
            if (exc instanceof harnessData.ProbeBusyError) throw new ConflictError(exc.message);
            throw exc;
          }
        }
        if (route === "/api/live/cancel") return sendJson(res, liveData.cancelRun(payload));
        if (route === "/api/optimization/promote") {
          // The human promotion gate: only a candidate the loop explicitly
          // staged (PROMOTED-PENDING.md) can be applied, and the approval is
          // persisted (promotion.json) alongside the SKILL.md backup.
          const skill = String(payload.skill ?? "");
          const iteration = String(payload.iteration ?? "");
          if (!/^[a-z0-9-]+$/.test(skill) || !/^\d{3}$/.test(iteration)) {
            throw new Error("promote requires a skill id and a NNN iteration id");
          }
          const pending = fromRepoRoot("optimization", "candidates", skill, iteration, "PROMOTED-PENDING.md");
          if (!fs.existsSync(pending)) {
            throw new NotFoundError(`no staged candidate for ${skill}/${iteration} — nothing awaits promotion`);
          }
          const { promoteCommand } = await import("./optimize.js");
          const code = await promoteCommand({ skill, iteration, via: "console" });
          if (code !== 0) throw new Error(`promotion failed for ${skill}/${iteration}`);
          return sendJson(res, { ok: true, skill, iteration, promotion: "promoted" });
        }
        res.writeHead(404);
        return res.end();
      }

      res.writeHead(405);
      res.end();
    } catch (exc) {
      sendError(res, exc);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const boundPort = (server.address() as { port: number }).port;
  const url = `http://${host}:${boundPort}/`;
  if (state) {
    console.log(`Skill Evaluation Console serving ${state.scorecardPath}`);
    console.log(`Review grades:      ${state.reviewDecisionsPath}`);
    console.log(`Optimization focus: ${state.focusPath}`);
  } else {
    console.log(`Skill Evaluation Console serving ${ctx.repoRoot} (no runs on disk)`);
  }
  console.log(url);
  if (options.open) {
    const { exec } = await import("node:child_process");
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${opener} ${url}`);
  }

  // Serve until interrupted.
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      console.log("\nStopping Skill Evaluation Console.");
      server.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return 0;
}
