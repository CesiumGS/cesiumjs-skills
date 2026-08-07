/**
 * Contract tests for `cesium-eval check skills`.
 *
 * Two obligations, and both directions of each:
 *
 *   1. the tracked skills satisfy the contract (no rule red-lines the repo as
 *      it stands), and
 *   2. every rule still REJECTS the wording change it was written to catch.
 *
 * (2) is the half that decays silently. A rule that stops firing keeps the
 * suite green and keeps `check skills` green, so the only thing that notices is
 * a negative case that fails when the rule does.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fromRepoRoot, listDirs } from "../src/lib/paths.js";
import {
  MIN_REGISTRY_SYMBOLS,
  SkillCheckSetupError,
  type SkillContractOptions,
  type SyntaxChecker,
  javascriptFences,
  loadSymbolRegistry,
  loadSyntaxChecker,
  parseSkillFile,
  referencedSymbols,
  resolveSkillSelection,
  skillViolations,
} from "../src/commands/checkSkills.js";

const MAP_PATH = fromRepoRoot("wiki", "Domain-Mapping.md");

let registry: Map<string, string>;
let syntax: SyntaxChecker;
let contract: SkillContractOptions;

beforeAll(async () => {
  registry = loadSymbolRegistry(MAP_PATH);
  syntax = await loadSyntaxChecker();
  contract = { registry, syntax };
});

/** A minimal skill that satisfies every rule, for negative cases to break. */
function goodSkill(overrides: { name?: string; description?: string; body?: string } = {}): string {
  const name = overrides.name ?? "cesiumjs-camera";
  const description = overrides.description ?? "CesiumJS camera control. Use when positioning the camera.";
  const body =
    overrides.body ??
    ['# CesiumJS Camera', '', '```js', 'import { Camera } from "cesium";', 'viewer.camera.flyTo({});', '```'].join("\n");
  return `---\nname: ${name}\ndescription: "${description}"\n---\n${body}`;
}

const rules = (text: string, skill = "cesiumjs-camera") => skillViolations(skill, text, contract).map((v) => v.rule);

describe("symbol registry", () => {
  it("parses the ownership map into a plausible public surface", () => {
    expect(registry.size).toBeGreaterThanOrEqual(MIN_REGISTRY_SYMBOLS);
    // Spot-check each bullet shape the map uses, so a parser that silently
    // stops understanding one of them is caught here rather than by a skill
    // being red-lined for referencing a real API.
    expect(registry.get("Cartesian3")).toBe("cesiumjs-spatial-math"); // plain
    expect(registry.get("Cesium3DTileColorBlendMode")).toBe("cesiumjs-3d-tiles"); // trailing (enum)
    expect(registry.get("BoxGeometry")).toBe("cesiumjs-primitives"); // 'A / B' alias pair
    expect(registry.get("BoxOutlineGeometry")).toBe("cesiumjs-primitives");
    // Prose bullets are not symbols.
    expect(registry.has("Terrain position picking")).toBe(false);
  });

  it("refuses an under-parsed registry instead of passing everything", () => {
    const tiny = path.join(
      fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? "/tmp", "skill-registry-")),
      "Domain-Mapping.md",
    );
    fs.writeFileSync(tiny, "## Domain 1: cesiumjs-camera\n- Camera\n");
    expect(() => loadSymbolRegistry(tiny)).toThrow(SkillCheckSetupError);
  });

  it("refuses a registry it cannot read", () => {
    expect(() => loadSymbolRegistry(fromRepoRoot("wiki", "does-not-exist.md"))).toThrow(SkillCheckSetupError);
  });
});

describe("frontmatter parsing", () => {
  it("reads the shape every tracked skill is authored in", () => {
    const parsed = parseSkillFile(goodSkill());
    expect(parsed.error).toBeNull();
    expect(parsed.keys).toEqual(["name", "description"]);
    expect(parsed.values.name).toBe("cesiumjs-camera");
    expect(parsed.values.description).toContain("Use when");
    expect(parsed.body).toContain("# CesiumJS Camera");
  });

  it("accepts an unquoted description", () => {
    const parsed = parseSkillFile("---\nname: a\ndescription: Use when x\n---\n# T\n");
    expect(parsed.error).toBeNull();
    expect(parsed.values.description).toBe("Use when x");
  });

  it.each([
    ["no opening fence", "name: cesiumjs-camera\n---\n# T\n"],
    ["unclosed block", "---\nname: cesiumjs-camera\n# T\n"],
    ["not key: value", "---\nname cesiumjs-camera\n---\n# T\n"],
    ["duplicate key", "---\nname: a\nname: b\n---\n# T\n"],
  ])("rejects %s", (_label, text) => {
    expect(parseSkillFile(text).error).not.toBeNull();
    expect(rules(text)).toContain("frontmatter");
  });

  it("reports only the frontmatter rule when the block is unusable", () => {
    // Body rules read a body this parse never established; reporting them too
    // would bury the one failure that has to be fixed first.
    expect(rules("---\nname: cesiumjs-camera\n")).toEqual(["frontmatter"]);
  });
});

describe("skill contract rules", () => {
  it("passes a well-formed skill", () => {
    expect(skillViolations("cesiumjs-camera", goodSkill(), contract)).toEqual([]);
  });

  it("catches a rename applied in one place only", () => {
    expect(rules(goodSkill({ name: "cesiumjs-kamera" }))).toContain("name-matches-directory");
  });

  it("catches an added or dropped frontmatter key", () => {
    const extra = goodSkill().replace("---\nname:", "---\nversion: 3\nname:");
    expect(rules(extra)).toContain("frontmatter-keys");
    const dropped = "---\nname: cesiumjs-camera\n---\n# T\n\n```js\nimport { Camera } from \"cesium\";\n```";
    expect(rules(dropped)).toContain("frontmatter-keys");
  });

  it("catches a description that would stop the skill activating", () => {
    expect(rules(goodSkill({ description: "" }))).toContain("description");
    expect(rules(goodSkill({ description: "x".repeat(1100) + " Use when y" }))).toContain("description");
    // The exact wording change this rule is named for: the trigger clause cut.
    expect(rules(goodSkill({ description: "CesiumJS camera control and flight animation." }))).toContain(
      "activation-clause",
    );
  });

  it("catches a removed title", () => {
    expect(rules(goodSkill({ body: "Some prose with no heading.\n" }))).toContain("title");
  });

  it("catches a code sample edited into something that does not parse", () => {
    const broken = goodSkill({ body: '# T\n\n```js\nviewer.camera.flyTo({ destination: );\n```' });
    expect(rules(broken)).toContain("code-fence-syntax");
  });

  it("catches a fence whose closing ``` was deleted", () => {
    // The dangerous direction: everything after the opening fence is now inside
    // the code block, so a scanner that only reports CLOSED fences reports
    // nothing at all and the gate passes a mangled file.
    const swallowed = goodSkill({
      body: '# T\n\n```js\nviewer.camera.flyTo({});\n\n## Next Section\n\nMore prose that is now code.\n',
    });
    const found = rules(swallowed);
    expect(found).toContain("code-fence-unterminated");
    // The missing fence is the defect; a syntax error from the prose it
    // swallowed would be noise pointing at the wrong line.
    expect(found).not.toContain("code-fence-syntax");
  });

  it("accepts the fragment shapes skills legitimately document", () => {
    const propertyList = goodSkill({
      body: '# T\n\n```js\nstartColor: Cesium.Color.WHITE,\nendColor: Cesium.Color.WHITE,\n```',
    });
    expect(rules(propertyList)).not.toContain("code-fence-syntax");
    const objectLiteral = goodSkill({ body: '# T\n\n```js\n{ image: "x.png", scale: 2 }\n```' });
    expect(rules(objectLiteral)).not.toContain("code-fence-syntax");
  });

  it("catches a CesiumJS API that does not exist", () => {
    const invented = goodSkill({ body: '# T\n\n```js\nimport { Camera, FlyToHelper } from "cesium";\n```' });
    expect(rules(invented)).toContain("unknown-symbol");
    const typoOnTheGlobal = goodSkill({ body: "# T\n\nUse `Cesium.Cartesain3` here.\n" });
    expect(rules(typoOnTheGlobal)).toContain("unknown-symbol");
  });

  it("catches a domain skill gutted of the symbols it owns", () => {
    // Real symbols, all owned by other domains: the file still looks like a
    // skill, and every other rule is satisfied.
    const hollow = goodSkill({ body: '# T\n\n```js\nimport { Cartesian3 } from "cesium";\n```' });
    expect(rules(hollow)).toContain("owned-symbol-coverage");
  });

  it("exempts a skill the ownership map does not name as a domain", () => {
    // The orientation skill owns nothing by design; it must not need an
    // allowlist entry to stay green.
    const orientation = `---\nname: using-cesiumjs-skills\ndescription: Use when starting a CesiumJS conversation.\n---\n# Orientation\n`;
    expect(skillViolations("using-cesiumjs-skills", orientation, contract)).toEqual([]);
  });
});

describe("helpers", () => {
  it("extracts symbols from both documented styles", () => {
    const found = referencedSymbols(
      'import { Cartesian3, Color as C } from "cesium";\nCesium.Viewer;\nviewer.camera.flyTo();',
    );
    expect([...found].sort()).toEqual(["Cartesian3", "Color", "Viewer"]);
  });

  it("extracts only js fences, in order", () => {
    const fences = javascriptFences('# T\n\n```js\na;\n```\n\n```bash\nnot-js\n```\n\n```javascript\nb;\n```\n');
    expect(fences.map((f) => f.code)).toEqual(["a;", "b;"]);
    expect(fences.every((f) => f.terminated)).toBe(true);
  });

  it("returns an unterminated fence flagged rather than dropping it", () => {
    const fences = javascriptFences('```js\na;\n```\n\n```js\nb;\nstill open');
    expect(fences.map((f) => [f.code, f.terminated])).toEqual([
      ["a;", true],
      ["b;\nstill open", false],
    ]);
  });

  it("rejects an unknown --skills id rather than checking nothing", () => {
    expect(resolveSkillSelection("cesiumjs-camera", ["cesiumjs-camera"])).toEqual(["cesiumjs-camera"]);
    expect(resolveSkillSelection("all", ["a", "b"])).toEqual(["a", "b"]);
    expect(() => resolveSkillSelection("cesiumjs-kamera", ["cesiumjs-camera"])).toThrow(SkillCheckSetupError);
    expect(() => resolveSkillSelection(" , ", ["a"])).toThrow(SkillCheckSetupError);
  });
});

describe("the tracked skills", () => {
  it("all satisfy the contract", () => {
    const skillsRoot = fromRepoRoot("skills");
    const ids = listDirs(skillsRoot).filter((id) => fs.existsSync(path.join(skillsRoot, id, "SKILL.md")));
    expect(ids.length).toBeGreaterThan(0);
    const found = ids.flatMap((id) =>
      skillViolations(id, fs.readFileSync(path.join(skillsRoot, id, "SKILL.md"), "utf-8"), contract),
    );
    expect(found.map((v) => `${v.file}: [${v.rule}] ${v.detail}`)).toEqual([]);
  });

  it("has a skill behind every live scenario directory", () => {
    // The live lane keys off skills/<id>/SKILL.md, so a scenario directory with
    // no skill is a set of cases nothing can ever run.
    const orphans = listDirs(fromRepoRoot("optimization", "scenarios")).filter(
      (id) => !fs.existsSync(fromRepoRoot("skills", id, "SKILL.md")),
    );
    expect(orphans).toEqual([]);
  });
});
