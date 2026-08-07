/**
 * `cesium-eval check skills` — the skill contract: deterministic checks that
 * read `skills/<id>/SKILL.md` itself.
 *
 * Why this command exists at all. Before it, NOTHING in the blocking gate read
 * a single byte of a skill. `score` graded pre-recorded fixture evidence,
 * `validate` graded case and scenario manifests, and `check canonical-surface`
 * graded the repository layout. A pull request that rewrote every word of every
 * skill was therefore indistinguishable, to CI, from a pull request that
 * changed nothing: the gate went green because the gate was never looking.
 *
 * The live lane (skill-eval.yml) closes the semantic half of that hole by
 * re-generating code from the edited skill and scoring what the browser
 * actually did. It cannot close the whole hole, because it costs money, needs
 * credentials a fork does not get, and has a language model in the loop. This
 * command is the half that is free, hermetic, fork-safe and repeatable: the
 * properties of a skill that can be decided by reading it.
 *
 * The rules, and the wording change each one catches:
 *
 *   frontmatter            a broken or unterminated YAML block; the skill stops
 *                          loading entirely
 *   frontmatter-keys       a key added or dropped; skill loaders read exactly
 *                          `name` and `description`
 *   name-matches-directory a rename applied in one place only
 *   description            an empty, multi-line, or over-long description
 *   activation-clause      the "Use when ..." clause deleted; skills activate by
 *                          description match, so a description that no longer
 *                          says when to use it silently stops triggering
 *   title                  the H1 removed
 *   code-fence-syntax      a code sample edited into something that no longer
 *                          parses as JavaScript
 *   code-fence-unterminated
 *                          a closing ``` deleted, which swallows the rest of the
 *                          skill into one code block
 *   unknown-symbol         a CesiumJS API that does not exist (typo, rename, or
 *                          invention), measured against the ownership map
 *   owned-symbol-coverage  a domain skill gutted until it documents none of the
 *                          symbols it owns
 *   scenario-coverage      a skill renamed out from under its live scenarios,
 *                          which would silently drop it from the live lane
 *
 * The symbol registry is `wiki/Domain-Mapping.md`, which the repository already
 * calls the definitive owner of every public CesiumJS class, function and enum.
 * Reusing it keeps one source of truth: adding an API means adding it there,
 * which is a reviewable diff under CODEOWNERS.
 *
 * Exit codes:
 *   0  every selected skill satisfies the contract
 *   1  a contract violation (the failure this gate exists to catch)
 *   2  usage error, or the checker could not run honestly (missing skills root,
 *      missing/implausible symbol registry, no JavaScript parser)
 *
 * Exit 2 is never collapsed into exit 1. A checker that cannot load its own
 * registry has not found zero violations, it has found nothing, and a gate that
 * reports "OK" in that state is precisely the always-pass theater the rest of
 * this pipeline is built to prevent.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fromRepoRoot, listDirs, repoRelative } from "../lib/paths.js";

/** One failed rule against one skill. */
export interface SkillViolation {
  skill: string;
  file: string;
  rule: string;
  detail: string;
}

/** A parsed skill file: frontmatter plus the body that follows it. */
export interface ParsedSkill {
  /** Frontmatter keys in source order. */
  keys: string[];
  values: Record<string, string>;
  body: string;
  /** Non-null when the frontmatter block itself is unusable. */
  error: string | null;
}

/** The keys a skill loader reads. Exactly these, no more, no fewer. */
export const REQUIRED_FRONTMATTER_KEYS = ["name", "description"] as const;

/**
 * Upper bound on a description. Skill descriptions are matched wholesale for
 * passive activation, so an essay dilutes the match as surely as an empty
 * string breaks it.
 */
export const MAX_DESCRIPTION_CHARS = 1024;

/**
 * A registry this small means the parser stopped understanding the map, not
 * that CesiumJS shrank. The document declares ~551 assigned symbols; 400 is a
 * floor well below the real count and far above anything a broken parse yields.
 */
export const MIN_REGISTRY_SYMBOLS = 400;

/** Raised when the checker cannot run honestly. Always exit 2, never exit 1. */
export class SkillCheckSetupError extends Error {}

/**
 * Parse the leading `---` block.
 *
 * Deliberately a strict subset of YAML — `key: value` on one line, with an
 * optional matching pair of surrounding quotes — rather than a real YAML
 * dependency. Skills are authored to this shape, the shape is what loaders
 * read, and a permissive parser here would accept frontmatter that a stricter
 * loader downstream rejects, which is the failure this rule exists to prevent.
 */
export function parseSkillFile(text: string): ParsedSkill {
  const empty: ParsedSkill = { keys: [], values: {}, body: "", error: null };
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { ...empty, error: "file does not open with a '---' frontmatter fence" };
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing === -1) {
    return { ...empty, error: "frontmatter block is never closed by a '---' fence" };
  }

  const keys: string[] = [];
  const values: Record<string, string> = {};
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (!match) {
      return { ...empty, error: `frontmatter line ${index + 1} is not 'key: value': ${JSON.stringify(line)}` };
    }
    const [, key, rawValue] = match;
    if (keys.includes(key)) {
      return { ...empty, error: `duplicate frontmatter key '${key}'` };
    }
    keys.push(key);
    values[key] = unquote(rawValue.trim());
  }
  return { keys, values, body: lines.slice(closing + 1).join("\n"), error: null };
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && last === first) return value.slice(1, -1);
  }
  return value;
}

/** One fenced ```js / ```javascript block and where it starts. */
export interface JavaScriptFence {
  code: string;
  /** 1-based line, within the body, of the opening fence. */
  line: number;
  /** False when the block ran to end-of-file without a closing fence. */
  terminated: boolean;
}

/**
 * Fenced ```js / ```javascript blocks.
 *
 * An unterminated block is RETURNED, flagged, rather than dropped. Dropping it
 * is what a naive scanner does, and it inverts the whole check: a skill that
 * forgets a closing fence swallows every heading, warning and example after it
 * into one code block, which is exactly when the file most needs flagging, and
 * exactly when a scanner that only reports closed fences reports nothing at all.
 */
export function javascriptFences(body: string): JavaScriptFence[] {
  const out: JavaScriptFence[] = [];
  const lines = body.split("\n");
  let open: { line: number; code: string[] } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open === null) {
      if (/^\s*```(?:js|javascript)\s*$/i.test(line)) open = { line: index + 1, code: [] };
      continue;
    }
    if (/^\s*```\s*$/.test(line)) {
      out.push({ code: open.code.join("\n"), line: open.line, terminated: true });
      open = null;
      continue;
    }
    open.code.push(line);
  }
  if (open !== null) out.push({ code: open.code.join("\n"), line: open.line, terminated: false });
  return out;
}

/**
 * Every CesiumJS symbol a skill references, from both documented styles: the
 * ES-module import (`import { Cartesian3 } from "cesium";`) and the UMD global
 * (`Cesium.Cartesian3`). Member access below the top-level symbol is out of
 * scope — the map assigns top-level symbols, so that is what can be decided.
 */
export function referencedSymbols(text: string): Set<string> {
  const symbols = new Set<string>();
  const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']cesium["']/g)) {
    for (const clause of match[1].split(",")) {
      const name = clause.trim().split(/\s+as\s+/)[0].trim();
      if (IDENTIFIER.test(name)) symbols.add(name);
    }
  }
  for (const match of text.matchAll(/\bCesium\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    symbols.add(match[1]);
  }
  return symbols;
}

/**
 * symbol -> owning skill id, parsed from `wiki/Domain-Mapping.md`.
 *
 * The map writes a bullet in several shapes, all of which are the same claim:
 *   `- Cartesian3`
 *   `- Cesium3DTileColorBlendMode (enum)`
 *   `- BoxGeometry / BoxOutlineGeometry`
 * so a trailing parenthetical is dropped and `/` separates aliases. Bullets
 * that are prose rather than a symbol ("Terrain position picking (lon/lat...)")
 * survive as multi-word strings and fail the identifier test.
 *
 * First writer wins: a symbol cross-referenced by a second domain keeps the
 * owner the document assigned it, which is what `owned-symbol-coverage` reads.
 */
export function loadSymbolRegistry(mapPath: string): Map<string, string> {
  let text: string;
  try {
    text = fs.readFileSync(mapPath, "utf-8");
  } catch {
    throw new SkillCheckSetupError(
      `symbol registry not readable: ${repoRelative(mapPath)}. The skill contract cannot decide whether an API exists without it.`,
    );
  }
  const owners = new Map<string, string>();
  let domain: string | null = null;
  for (const line of text.split("\n")) {
    const heading = /^##\s+Domain\s+\d+:\s+(\S+)/.exec(line);
    if (heading) {
      domain = heading[1];
      continue;
    }
    const bullet = /^-\s+(.+?)\s*$/.exec(line);
    if (!bullet || domain === null) continue;
    const body = bullet[1].replace(/\s*\([^)]*\)\s*$/, "");
    for (const token of body.split("/")) {
      const name = token.trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !owners.has(name)) owners.set(name, domain);
    }
  }
  if (owners.size < MIN_REGISTRY_SYMBOLS) {
    throw new SkillCheckSetupError(
      `symbol registry parsed to only ${owners.size} symbols from ${repoRelative(mapPath)} (floor is ${MIN_REGISTRY_SYMBOLS}). ` +
        "Either the document changed shape or the parser broke; an under-parsed registry would silently pass every skill.",
    );
  }
  return owners;
}

/** Skill ids that the ownership map names as domains. */
export function mappedDomains(registry: Map<string, string>): Set<string> {
  return new Set(registry.values());
}

/**
 * A JavaScript syntax checker, or null when no parser is available.
 *
 * TypeScript's parser is used in JS mode purely as a syntax oracle: it is
 * already the compiler this workspace builds with, so the check adds no new
 * dependency and no new version to keep in step.
 */
export type SyntaxChecker = (code: string) => string | null;

export async function loadSyntaxChecker(): Promise<SyntaxChecker> {
  let ts: any;
  try {
    const mod: any = await import("typescript");
    ts = mod.default ?? mod;
  } catch {
    throw new SkillCheckSetupError(
      "the TypeScript parser is not installed, so code fences cannot be syntax-checked. Run 'npm ci' at the repository root.",
    );
  }
  const diagnose = (code: string): string | null => {
    const source = ts.createSourceFile("skill-fence.js", code, ts.ScriptTarget.ESNext, false, ts.ScriptKind.JS);
    const diagnostics = source.parseDiagnostics ?? [];
    if (!diagnostics.length) return null;
    const first = diagnostics[0];
    const message = ts.flattenDiagnosticMessageText(first.messageText, " ");
    const { line } = source.getLineAndCharacterOfPosition(first.start ?? 0);
    return `${message} (fence line ${line + 1})`;
  };
  // Skills legitimately document fragments, not only whole programs: an
  // options bag lifted out of its call site, or the two or three properties of
  // one that are actually being explained. Those are still checkable — they
  // just have to be checked in the shape they were written in. A fence is
  // broken only when it parses as none of the three.
  return (code: string): string | null => {
    const asProgram = diagnose(code);
    if (asProgram === null) return null;
    if (diagnose(`(${code})`) === null) return null; // an expression on its own
    if (diagnose(`({${code}})`) === null) return null; // a property list
    return asProgram;
  };
}

export interface SkillContractOptions {
  registry: Map<string, string>;
  syntax: SyntaxChecker;
}

/** Apply every rule to one skill. Pure: the caller does the I/O and reporting. */
export function skillViolations(skill: string, text: string, options: SkillContractOptions): SkillViolation[] {
  const file = `skills/${skill}/SKILL.md`;
  const out: SkillViolation[] = [];
  const add = (rule: string, detail: string) => out.push({ skill, file, rule, detail });

  const parsed = parseSkillFile(text);
  if (parsed.error !== null) {
    add("frontmatter", parsed.error);
    // Everything downstream reads the body this parse failed to establish.
    return out;
  }

  const expected: string[] = [...REQUIRED_FRONTMATTER_KEYS];
  const missing = expected.filter((key) => !parsed.keys.includes(key));
  const extra = parsed.keys.filter((key) => !expected.includes(key));
  if (missing.length) add("frontmatter-keys", `missing required key(s): ${missing.join(", ")}`);
  if (extra.length) {
    add("frontmatter-keys", `unrecognized key(s): ${extra.join(", ")} (loaders read exactly ${expected.join(", ")})`);
  }

  const name = parsed.values.name ?? "";
  if (name && name !== skill) {
    add("name-matches-directory", `frontmatter name '${name}' does not match directory 'skills/${skill}'`);
  }

  const description = parsed.values.description ?? "";
  if (!description.trim()) {
    add("description", "description is empty; a skill with no description never activates");
  } else {
    if (description.length > MAX_DESCRIPTION_CHARS) {
      add("description", `description is ${description.length} chars (limit ${MAX_DESCRIPTION_CHARS})`);
    }
    if (!/use when/i.test(description)) {
      add(
        "activation-clause",
        "description has no 'Use when ...' clause; skills are selected by description match, so the trigger conditions must be in it",
      );
    }
  }

  if (!/^#\s+\S/m.test(parsed.body)) {
    add("title", "no level-1 heading ('# Title') in the body");
  }

  for (const fence of javascriptFences(parsed.body)) {
    if (!fence.terminated) {
      // Reported instead of parsed, not as well as: the block's contents are
      // every line to end-of-file, so its syntax error would be a confusing
      // consequence of the missing fence rather than the defect itself.
      add(
        "code-fence-unterminated",
        `js fence opened at body line ${fence.line} is never closed, so the rest of the file is inside it`,
      );
      continue;
    }
    if (!fence.code.trim()) continue;
    const error = options.syntax(fence.code);
    if (error !== null) {
      add("code-fence-syntax", `js fence starting at body line ${fence.line} does not parse: ${error}`);
    }
  }

  const referenced = referencedSymbols(text);
  for (const symbol of [...referenced].sort()) {
    if (!options.registry.has(symbol)) {
      add(
        "unknown-symbol",
        `'${symbol}' is not a CesiumJS public symbol in wiki/Domain-Mapping.md. ` +
          "If the API is real and newly added, add it to the map in the same change.",
      );
    }
  }

  // Only a skill the map names as a domain can be measured for coverage; the
  // orientation skill owns no symbols by design and is exempt automatically,
  // with no allowlist to fall out of date.
  if (mappedDomains(options.registry).has(skill)) {
    const owned = [...referenced].filter((symbol) => options.registry.get(symbol) === skill);
    if (!owned.length) {
      add(
        "owned-symbol-coverage",
        `documents none of the symbols wiki/Domain-Mapping.md assigns to '${skill}'`,
      );
    }
  }

  return out;
}

export interface CheckSkillsOptions {
  /** 'all' or a comma-separated list of skill ids. */
  skills?: string;
}

/** Resolve `--skills`, rejecting an unknown id rather than checking nothing. */
export function resolveSkillSelection(spec: string | undefined, available: string[]): string[] {
  if (!spec || spec.trim().toLowerCase() === "all") return available;
  const requested = spec
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!requested.length) throw new SkillCheckSetupError("--skills was empty");
  const unknown = requested.filter((id) => !available.includes(id));
  if (unknown.length) {
    throw new SkillCheckSetupError(
      `unknown skill id(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`,
    );
  }
  return requested;
}

export async function checkSkillsCommand(options: CheckSkillsOptions): Promise<number> {
  const skillsRoot = fromRepoRoot("skills");
  let selected: string[];
  let registry: Map<string, string>;
  let syntax: SyntaxChecker;
  let scenarioSkills: Set<string>;
  try {
    const available = listDirs(skillsRoot).filter((id) => fs.existsSync(path.join(skillsRoot, id, "SKILL.md")));
    if (!available.length) {
      throw new SkillCheckSetupError(`no skills found under ${repoRelative(skillsRoot)}`);
    }
    selected = resolveSkillSelection(options.skills, available);
    registry = loadSymbolRegistry(fromRepoRoot("wiki", "Domain-Mapping.md"));
    syntax = await loadSyntaxChecker();
    scenarioSkills = new Set(listDirs(fromRepoRoot("optimization", "scenarios")));
  } catch (exc: any) {
    if (exc instanceof SkillCheckSetupError) {
      console.error(`[check skills] SETUP ERROR: ${exc.message}`);
      return 2;
    }
    throw exc;
  }

  const contract: SkillContractOptions = { registry, syntax };
  const violations: SkillViolation[] = [];
  for (const skill of selected) {
    const filePath = path.join(skillsRoot, skill, "SKILL.md");
    const text = fs.readFileSync(filePath, "utf-8");
    violations.push(...skillViolations(skill, text, contract));
  }

  // A scenario directory with no skill behind it is the rename this rule
  // exists for, and it cannot be attributed to any selected skill, so it is
  // reported against the scenario set itself.
  for (const skill of [...scenarioSkills].sort()) {
    if (!fs.existsSync(path.join(skillsRoot, skill, "SKILL.md"))) {
      violations.push({
        skill,
        file: `optimization/scenarios/${skill}`,
        rule: "scenario-coverage",
        detail: `live scenarios exist for '${skill}' but skills/${skill}/SKILL.md does not, so the live lane can never run them`,
      });
    }
  }

  if (violations.length) {
    console.error(`[check skills] FAIL: ${violations.length} contract violation(s) across ${selected.length} skill(s):`);
    for (const violation of violations) {
      console.error(`  ${violation.file}: [${violation.rule}] ${violation.detail}`);
      if (process.env.GITHUB_ACTIONS === "true") {
        console.error(`::error file=${violation.file},title=Skill contract: ${violation.rule}::${violation.detail}`);
      }
    }
    return 1;
  }

  console.log(
    `[check skills] OK: ${selected.length} skill(s) satisfy the contract (${registry.size} public symbols in the registry)`,
  );
  return 0;
}
