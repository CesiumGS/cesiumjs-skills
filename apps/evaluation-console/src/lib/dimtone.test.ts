import { describe, expect, it } from "vitest";
import { visualScoreTone } from "./dimtone";

describe("visualScoreTone", () => {
  it("uses the numeric score rather than a dimension-specific status", () => {
    expect(visualScoreTone(3)).toBe("fail");
    expect(visualScoreTone(4)).toBe("fail");
  });

  it("matches the qualitative audit score bands", () => {
    expect(visualScoreTone(5)).toBe("warn");
    expect(visualScoreTone(6.9)).toBe("warn");
    expect(visualScoreTone(7)).toBe("pass");
    expect(visualScoreTone(10)).toBe("pass");
  });

  it("keeps missing or invalid scores unknown", () => {
    expect(visualScoreTone(null)).toBe("unknown");
    expect(visualScoreTone(undefined)).toBe("unknown");
    expect(visualScoreTone(Number.NaN)).toBe("unknown");
  });
});
