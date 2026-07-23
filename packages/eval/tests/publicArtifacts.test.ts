import { describe, expect, it } from "vitest";
import { repoRoot } from "../src/lib/paths.js";
import { scanPublicArtifacts } from "../src/optimization/publicArtifacts.js";

describe("scanPublicArtifacts", () => {
  it("accepts the tracked public repository surface", () => {
    expect(scanPublicArtifacts(repoRoot())).toEqual([]);
  });
});