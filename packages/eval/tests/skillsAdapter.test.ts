import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillBundle } from "../src/optimization/skillsAdapter.js";

const roots: string[] = [];

function skillRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-bundle-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("skill codegen bundle", () => {
  it("includes supporting text files in stable path order", () => {
    const root = skillRoot();
    fs.mkdirSync(path.join(root, "examples"));
    fs.writeFileSync(path.join(root, "SKILL.md"), "# Candidate\n");
    fs.writeFileSync(path.join(root, "REFERENCE.md"), "reference text\n");
    fs.writeFileSync(path.join(root, "examples", "sample.js"), "const sample = true;\n");

    const bundle = loadSkillBundle(path.join(root, "SKILL.md"));
    expect(bundle.primaryContent).toBe("# Candidate\n");
    expect(bundle.supportingFiles).toEqual(["examples/sample.js", "REFERENCE.md"]);
    expect(bundle.content).toContain('<supporting_file path="examples/sample.js">');
    expect(bundle.content).toContain('<supporting_file path="REFERENCE.md">');
    expect(bundle.content.indexOf("examples/sample.js")).toBeLessThan(bundle.content.indexOf("REFERENCE.md"));
  });

  it("rejects symlinks instead of reading outside the skill directory", () => {
    const root = skillRoot();
    const outside = path.join(root, "..", `outside-${path.basename(root)}.md`);
    fs.writeFileSync(path.join(root, "SKILL.md"), "# Candidate\n");
    fs.writeFileSync(outside, "do not ingest\n");
    fs.symlinkSync(outside, path.join(root, "REFERENCE.md"));
    try {
      expect(() => loadSkillBundle(path.join(root, "SKILL.md"))).toThrow(/symbolic link/);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("follows explicit references into sibling skill directories", () => {
    const skills = skillRoot();
    const primary = path.join(skills, "primary");
    const sibling = path.join(skills, "sibling");
    fs.mkdirSync(primary);
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(primary, "SKILL.md"), "Read [the matrix](../sibling/REFERENCE.md).\n");
    fs.writeFileSync(path.join(sibling, "REFERENCE.md"), "shared reference\n");

    const bundle = loadSkillBundle(path.join(primary, "SKILL.md"));
    expect(bundle.supportingFiles).toEqual(["../sibling/REFERENCE.md"]);
    expect(bundle.content).toContain("shared reference");
  });
});
