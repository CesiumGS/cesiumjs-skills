import { describe, expect, it } from "vitest";
import { runCase } from "../src/evaluation/runner.js";
import { runDeterministicChecks } from "../src/evaluation/checks/index.js";
import { dispatch } from "../src/evaluation/registry.js";

const enuEvidence = (eastMeters: number) => {
  // Entity at lon=0/lat=0: ECEF x≈earth radius; +east = +y at (0,0).
  const base = [6378137, 0, 0];
  return {
    before: {
      entities: {
        marker: {
          position_ecef: base,
          position_cartographic: { longitude_deg: 0, latitude_deg: 0, altitude_m: 0 },
        },
      },
    },
    after: {
      entities: {
        marker: { position_ecef: [base[0], base[1] + eastMeters, base[2]] },
      },
    },
  };
};

describe("deterministic check matchers", () => {
  it("entity_exists passes when present in requested snapshots", () => {
    const spec = { id: "c1", type: "entity_exists", entity_id: "marker", snapshot: "both" };
    const result = dispatch(spec, enuEvidence(0));
    expect(result.result).toBe("pass");
  });

  it("entity_exists fails and reports missing snapshots", () => {
    const spec = { id: "c1", type: "entity_exists", entity_id: "ghost", snapshot: "both" };
    const result = dispatch(spec, enuEvidence(0));
    expect(result.result).toBe("fail");
    expect((result.actual as any).missing_snapshots).toEqual(["before", "after"]);
  });

  it("entity_translation_delta measures the ENU east axis", () => {
    const spec = {
      id: "c2",
      type: "entity_translation_delta",
      entity_id: "marker",
      axis: "east",
      operator: "==",
      value_meters: 6,
      tolerance_meters: 0.01,
    };
    const result = dispatch(spec, enuEvidence(6));
    expect(result.result).toBe("pass");
    expect(result.actual as number).toBeCloseTo(6, 6);
  });

  it("entity_translation_delta fails outside tolerance", () => {
    const spec = {
      id: "c2",
      type: "entity_translation_delta",
      entity_id: "marker",
      axis: "east",
      operator: "==",
      value_meters: 6,
      tolerance_meters: 0.01,
    };
    expect(dispatch(spec, enuEvidence(6.5)).result).toBe("fail");
  });

  it("json_value_equals resolves JSON pointers", () => {
    const evidence = { after: { values: { count: 3 } } };
    const spec = { id: "c3", type: "json_value_equals", path: "/after/values/count", expected: 3 };
    expect(dispatch(spec, evidence).result).toBe("pass");
    const missing = { id: "c4", type: "json_value_equals", path: "/after/values/missing", expected: 3 };
    expect(dispatch(missing, evidence).result).toBe("fail");
  });

  it("json_value_compare honors operators and tolerance", () => {
    const evidence = { after: { values: { altitude: 1000.4 } } };
    expect(
      dispatch(
        { id: "c", type: "json_value_compare", path: "/after/values/altitude", operator: "==", expected: 1000, tolerance: 0.5 },
        evidence,
      ).result,
    ).toBe("pass");
    expect(
      dispatch(
        { id: "c", type: "json_value_compare", path: "/after/values/altitude", operator: ">", expected: 1000 },
        evidence,
      ).result,
    ).toBe("pass");
    expect(
      dispatch(
        { id: "c", type: "json_value_compare", path: "/after/values/altitude", operator: "<", expected: 1000 },
        evidence,
      ).result,
    ).toBe("fail");
  });

  it("collection_count counts arrays, objects, and strings", () => {
    const evidence = { after: { entities: { a: {}, b: {} }, list: [1, 2, 3] } };
    expect(dispatch({ id: "c", type: "collection_count", path: "/after/entities", operator: "==", count: 2 }, evidence).result).toBe("pass");
    expect(dispatch({ id: "c", type: "collection_count", path: "/after/list", operator: ">=", count: 3 }, evidence).result).toBe("pass");
    expect(dispatch({ id: "c", type: "collection_count", path: "/after/list", operator: "<", count: 3 }, evidence).result).toBe("fail");
  });

  it("pattern checks search generated code with multiline semantics", () => {
    const evidence = { generated_code: "const v = new Cesium.Viewer('c');\nviewer.camera.flyTo({});" };
    expect(dispatch({ id: "c", type: "pattern_present", pattern: String.raw`camera\.flyTo` }, evidence).result).toBe("pass");
    expect(dispatch({ id: "c", type: "pattern_absent", pattern: "lookAt" }, evidence).result).toBe("pass");
    expect(dispatch({ id: "c", type: "pattern_absent", pattern: String.raw`camera\.flyTo` }, evidence).result).toBe("fail");
  });

  it("no_runtime_errors and code_runs read execution evidence", () => {
    expect(dispatch({ id: "c", type: "no_runtime_errors" }, { errors: [] }).result).toBe("pass");
    expect(dispatch({ id: "c", type: "no_runtime_errors" }, { errors: ["boom"] }).result).toBe("fail");
    expect(dispatch({ id: "c", type: "code_runs" }, { execution: { success: true } }).result).toBe("pass");
    expect(dispatch({ id: "c", type: "code_runs" }, { execution: {} }).result).toBe("fail");
  });

  it("artifact_text_absent flags disallowed strings anywhere in the doc", () => {
    const clean = { generated_code: "const x = 1;" };
    expect(dispatch({ id: "c", type: "artifact_text_absent" }, clean).result).toBe("pass");
    const dirty = { generated_code: "fetch('http://localhost:9999/x')" };
    expect(dispatch({ id: "c", type: "artifact_text_absent" }, dirty).result).toBe("fail");
    const userPath = { note: "/Users/someone/secret" };
    expect(dispatch({ id: "c", type: "artifact_text_absent" }, userPath).result).toBe("fail");
  });

  it("unknown check types fail with a registration message", () => {
    const result = dispatch({ id: "c", type: "not_a_matcher" }, {});
    expect(result.result).toBe("fail");
    expect(result.detail).toContain("no matcher registered");
  });
});

describe("runCase", () => {
  const caseDoc = {
    id: "eval-001",
    name: "move marker east",
    skill: "cesiumjs-entities",
    checks: [
      { id: "exists", type: "entity_exists", entity_id: "marker", snapshot: "both" },
      {
        id: "moved",
        type: "entity_translation_delta",
        entity_id: "marker",
        axis: "east",
        operator: "==",
        value_meters: 6,
      },
    ],
  };

  it("passes when all checks pass and enriches categories", () => {
    const result = runCase(caseDoc, enuEvidence(6));
    expect(result.result).toBe("pass");
    expect(result.checks[0].category).toBe("entity_state");
    expect(result.checks[1].category).toBe("semantic_scene_state");
    expect(result.checks[1].critical).toBe(true);
  });

  it("fails structured on malformed checks instead of throwing", () => {
    const bad = { ...caseDoc, checks: [{ id: "x", type: "entity_translation_delta" }] };
    const result = runCase(bad, enuEvidence(0));
    expect(result.result).toBe("fail");
    expect(result.error).toContain("entity_translation_delta");
  });

  it("fails when there are no checks", () => {
    expect(runCase({ ...caseDoc, checks: [] }, enuEvidence(0)).result).toBe("fail");
  });

  it("runDeterministicChecks preserves declaration order", () => {
    const results = runDeterministicChecks(caseDoc, enuEvidence(6));
    expect(results.map((r) => r.check_id)).toEqual(["exists", "moved"]);
  });
});
