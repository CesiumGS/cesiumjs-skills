import { describe, expect, it } from "vitest";
import { candidateEntries, changedSkillIds, sharedSupportingEntries } from "../../../.github/scripts/prepare-pr-skill-eval.mjs";

describe("pre-merge candidate skill preparation", () => {
  it("selects unique skill directories and ignores similarly named paths", () => {
    expect(
      changedSkillIds([
        { filename: "skills/cesiumjs-camera/SKILL.md" },
        { filename: "skills/cesiumjs-camera/REFERENCE.md" },
        { filename: "skills/cesiumjs-3d-tiles/examples/a.js" },
        { filename: "skill/cesiumjs-imagery/SKILL.md" },
      ]),
    ).toEqual(["cesiumjs-3d-tiles", "cesiumjs-camera"]);
  });

  it("accepts bounded regular text files and requires SKILL.md", () => {
    const tree = [
      { path: "skills/cesiumjs-camera/SKILL.md", type: "blob", mode: "100644", size: 10, sha: "a" },
      { path: "skills/cesiumjs-camera/REFERENCE.md", type: "blob", mode: "100644", size: 20, sha: "b" },
      { path: "skills/other/SKILL.md", type: "blob", mode: "100644", size: 10, sha: "c" },
    ];
    expect(candidateEntries(tree, "cesiumjs-camera").map((entry) => entry.path)).toEqual([
      "skills/cesiumjs-camera/REFERENCE.md",
      "skills/cesiumjs-camera/SKILL.md",
    ]);
    expect(() => candidateEntries(tree, "cesiumjs-imagery")).toThrow(/no .*SKILL\.md/);
  });

  it("rejects symlinks, executable files, and unsupported binary types", () => {
    const primary = { path: "skills/cesiumjs-camera/SKILL.md", type: "blob", mode: "100644", size: 10, sha: "a" };
    expect(() =>
      candidateEntries([primary, { path: "skills/cesiumjs-camera/REFERENCE.md", type: "blob", mode: "120000", size: 10, sha: "b" }], "cesiumjs-camera"),
    ).toThrow(/not a regular/);
    expect(() =>
      candidateEntries([primary, { path: "skills/cesiumjs-camera/run.js", type: "blob", mode: "100755", size: 10, sha: "b" }], "cesiumjs-camera"),
    ).toThrow(/not a regular/);
    expect(() =>
      candidateEntries([primary, { path: "skills/cesiumjs-camera/image.png", type: "blob", mode: "100644", size: 10, sha: "b" }], "cesiumjs-camera"),
    ).toThrow(/approved text/);
  });

  it("makes sibling supporting files available without importing sibling entrypoints", () => {
    const tree = [
      { path: "skills/a/SKILL.md", type: "blob", mode: "100644", size: 10, sha: "a" },
      { path: "skills/a/REFERENCE.md", type: "blob", mode: "100644", size: 20, sha: "b" },
      { path: "skills/b/SKILL.md", type: "blob", mode: "100644", size: 30, sha: "c" },
      { path: "skills/b/examples/sample.js", type: "blob", mode: "100644", size: 40, sha: "d" },
    ];
    expect(sharedSupportingEntries(tree).map((entry) => entry.path)).toEqual([
      "skills/a/REFERENCE.md",
      "skills/b/examples/sample.js",
    ]);
  });
});
