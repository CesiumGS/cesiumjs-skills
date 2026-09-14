/**
 * Contract tests for the deterministic CI gate.
 *
 * These assert properties of the gate itself rather than of any one matcher.
 * Each corresponds to a way the gate could silently stop meaning anything.
 */
import { describe, expect, it } from "vitest";
// Imported for its side effects: matchers register themselves at module load,
// so registeredTypes() is empty until this module has been evaluated.
import "../src/evaluation/checks/index.js";
import { registeredTypes } from "../src/evaluation/registry.js";
import { runCase } from "../src/evaluation/runner.js";
import { fromRepoRoot, globAcrossDirs } from "../src/lib/paths.js";
import { readJson } from "../src/lib/json.js";
import { loadCases, caseKey } from "../src/commands/score.js";

/** Recompute the per-matcher pass/fail tallies that `verify-fixtures` reports. */
function matcherTallies(): Record<string, { pass: number; fail: number }> {
  const cases = loadCases(fromRepoRoot("evaluation", "cases"));
  const tallies: Record<string, { pass: number; fail: number }> = {};
  // Seed from the registry so ABSENCE is representable. Keying only on the check
  // types the fixtures happen to emit makes deletion invisible: removing the one
  // case and the fixtures that drive camera_target_view (the most intricate
  // matcher here) would drop it out of the map entirely, leave `observed`
  // byte-identical, and pass, which is the exact regression this test promises
  // to catch.
  for (const type of registeredTypes()) tallies[type] = { pass: 0, fail: 0 };
  for (const fixturePath of globAcrossDirs(fromRepoRoot("evaluation", "fixtures"), "", ".evidence.json")) {
    const evidence = readJson(fixturePath);
    const entry = cases.get(caseKey(evidence.skill, evidence.case_id));
    if (!entry) continue;
    for (const check of runCase(entry.data, evidence).checks ?? []) {
      const type = String((check as any).type ?? "unknown");
      tallies[type] ??= { pass: 0, fail: 0 };
      if (String((check as any).result) === "pass") tallies[type].pass += 1;
      else tallies[type].fail += 1;
    }
  }
  return tallies;
}

describe("gate contract", () => {
  it("keeps the matcher registry and check.schema.json in agreement", () => {
    // A matcher registered but absent from the schema cannot be used by a case
    // (validate rejects it). A type in the schema with no matcher dispatches to
    // the "no matcher registered" fail path, which reads as an evaluation
    // failure rather than the configuration bug it is. Either direction is a
    // silent hole, so both are asserted.
    // Each oneOf branch is a {"$ref": "#/definitions/<matcher type>"}, so the
    // matcher name is the last path segment of the pointer.
    const schema = readJson(fromRepoRoot("evaluation", "schemas", "check.schema.json"));
    const schemaTypes = new Set<string>(
      (schema.oneOf ?? [])
        .map((branch: any) => branch?.$ref)
        .filter((ref: unknown): ref is string => typeof ref === "string")
        .map((ref: string) => ref.split("/").pop() as string),
    );
    expect(schemaTypes.size).toBeGreaterThan(0);
    expect([...schemaTypes].sort()).toEqual([...new Set(registeredTypes())].sort());
  });

  it("holds the pass threshold at or above 0.95", () => {
    // The threshold lives in eval.config.json and nowhere else;
    // .github/scripts/workflow-safety.sh rule 6 forbids --threshold in any
    // workflow. Lowering it therefore requires editing this test in the same
    // pull request, which makes it visible in review and impossible by accident.
    const config = readJson(fromRepoRoot("eval.config.json"));
    expect(config.threshold).toBeGreaterThanOrEqual(0.95);
  });

  it("declares which matchers no fixture drives to fail, so the gap cannot grow silently", () => {
    // `verify-fixtures` can only detect a matcher that degrades to always-pass
    // if some fixture drives that matcher to FAIL. These matchers are exercised
    // by the tracked fixtures only in the passing direction, so a degradation in
    // one of them is invisible to the fixture lane and is caught by unit tests
    // alone.
    //
    // Verified empirically: stubbing entity_exists to always return "pass"
    // leaves `score --fixture-expectation pass`, `validate`, AND
    // `verify-fixtures` all green, and only the unit tests catch it. Applying
    // the same degradation to entity_translation_delta (which does have a
    // failing fixture) turns `verify-fixtures` red while score and validate stay
    // green.
    //
    // This list is an inventory of a known limitation, not an endorsement of it.
    // To shrink it, author a negative fixture and delete the entry. Growing it
    // is a coverage regression and must be deliberate.
    // Exercised by the tracked fixtures only in the PASSING direction.
    const knownNoFailingFixture = ["code_runs", "collection_count", "entity_exists", "no_runtime_errors"];
    // No fixture of EITHER polarity: these read evidence.generated_code and are
    // used by the optimization lane rather than by any evaluation case. Their
    // failing direction is asserted in checks.test.ts instead.
    const knownNoFixtureAtAll = ["pattern_absent", "pattern_present"];
    const expected = [...knownNoFailingFixture, ...knownNoFixtureAtAll].sort();

    const tallies = matcherTallies();
    expect(Object.keys(tallies).length).toBeGreaterThan(0);

    const observed = Object.entries(tallies)
      .filter(([, counts]) => counts.fail === 0)
      .map(([type]) => type)
      .sort();
    expect(observed).toEqual(expected);

    const registered = new Set(registeredTypes());
    for (const type of expected) expect(registered.has(type)).toBe(true);
  });
});
