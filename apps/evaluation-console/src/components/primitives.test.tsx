import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Score01, Score10, score01Percent } from "./primitives";

describe("Score01", () => {
  it("fills the deterministic bar completely for a 1.00 score", () => {
    expect(score01Percent(1)).toBe(100);

    const markup = renderToStaticMarkup(<Score01 value={1} />);
    expect(markup).toContain('class="score-bar-fill"');
    expect(markup).toContain('style="width:100%"');
    expect(markup).toContain('aria-valuenow="1"');
    expect(markup).toContain("1.00");
  });

  it("clamps out-of-range deterministic values", () => {
    expect(score01Percent(-1)).toBe(0);
    expect(score01Percent(2)).toBe(100);
  });
});

describe("Score10", () => {
  it("applies the same severity tone as the displayed visual score", () => {
    expect(renderToStaticMarkup(<Score10 value={3} />)).toContain("score score-eye fail");
    expect(renderToStaticMarkup(<Score10 value={6} />)).toContain("score score-eye warn");
    expect(renderToStaticMarkup(<Score10 value={8} />)).toContain("score score-eye pass");
  });
});
