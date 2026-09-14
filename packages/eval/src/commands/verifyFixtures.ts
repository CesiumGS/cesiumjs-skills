/**
 * `cesium-eval verify-fixtures` — assert that every tracked fixture produces the
 * result it declares, in BOTH polarities.
 *
 * Why this is a separate command from `score`:
 *
 * `score` filters fixtures by `expected_result` and then scores whichever set it
 * selected against the same pass threshold. There is no inversion anywhere, so
 * `--fixture-expectation fail` reports a failing scorecard (78%) and
 * `--fixture-expectation all` reports 89%. Neither polarity can be a green gate,
 * which means nothing in CI verified that the evaluator still REJECTS bad
 * evidence. A matcher that degraded to returning `pass` unconditionally would
 * keep `score --fixture-expectation pass` at 100% and keep `validate` green.
 *
 * This command closes that hole: it runs every fixture, of either polarity, and
 * asserts the observed result equals the declared one. It is a framework
 * self-test, not a product document, which is also why it does not fold into the
 * scorecard: mixing polarities makes `overall_score` meaningless.
 *
 * Do not express this as an inverted exit code in YAML (`! cesium-eval score
 * --fixture-expectation fail`). A crash also exits 1, so a segfault would read
 * as "the negative fixtures correctly failed".
 *
 * Exit codes:
 *   0  every fixture reconciles and every result validates
 *   1  a fixture's result differs from its declared expected_result
 *   2  usage error, an orphan fixture, or a result that fails result.schema.json
 *
 * An orphan fixture is exit 2 rather than exit 1 deliberately: it is a manifest
 * bug, not an evaluator regression, and conflating them is how a pipeline bug
 * gets misdiagnosed as a scoring failure.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, stableStringify } from "../lib/json.js";
import { fromRepoRoot, globAcrossDirs, repoRelative } from "../lib/paths.js";
import { runCase } from "../evaluation/runner.js";
import { loadResultValidator } from "../evaluation/schema.js";
import { caseKey, loadCases } from "./score.js";

export interface VerifyFixturesOptions {
  casesRoot?: string;
  fixturesRoot?: string;
  output?: string;
}

interface Mismatch {
  fixture: string;
  skill: string;
  case_id: string;
  expected: string;
  actual: string;
}

export interface FixtureVerification {
  schema_version: string;
  total: number;
  matched: number;
  mismatched: Mismatch[];
  by_matcher: Record<string, { fixture_pass: number; fixture_fail: number }>;
}

export async function verifyFixturesCommand(options: VerifyFixturesOptions): Promise<number> {
  const cases = loadCases(options.casesRoot ?? fromRepoRoot("evaluation", "cases"));
  const fixturesRoot = options.fixturesRoot ?? fromRepoRoot("evaluation", "fixtures");
  const fixturePaths = globAcrossDirs(fixturesRoot, "", ".evidence.json");

  if (!fixturePaths.length) {
    console.error(`[verify-fixtures] no fixtures found under ${repoRelative(fixturesRoot)}`);
    return 2;
  }

  const resultValidator = loadResultValidator();
  const mismatched: Mismatch[] = [];
  const byMatcher: Record<string, { fixture_pass: number; fixture_fail: number }> = {};
  let matched = 0;
  let schemaViolations = 0;
  let orphans = 0;
  let evaluatorFaults = 0;

  for (const fixturePath of fixturePaths) {
    const rel = repoRelative(fixturePath);
    const evidence = readJson(fixturePath);
    const key = caseKey(evidence.skill, evidence.case_id);
    const entry = cases.get(key);

    if (!entry) {
      console.error(`[verify-fixtures] ${rel}: references unknown case ${key}`);
      orphans += 1;
      continue;
    }

    const caseResult = runCase(entry.data, evidence);

    // `runCase` catches any matcher exception into `error` and forces
    // result: "fail". On a NEGATIVE fixture that produces exactly the declared
    // result, so a matcher that has started throwing instead of evaluating
    // reads as a correct rejection and this command stays green. Comparing only
    // the result string would let a crashing evaluator look like a working one.
    if (caseResult.error !== null && caseResult.error !== undefined) {
      evaluatorFaults += 1;
      console.error(`[verify-fixtures] ${rel}: evaluator threw while running ${key}: ${caseResult.error}`);
    }

    const schemaErrors = resultValidator.errors(caseResult);
    if (schemaErrors.length) {
      schemaViolations += 1;
      for (const error of schemaErrors) {
        console.error(`[verify-fixtures] ${rel}: result schema error at ${error.location}: ${error.message}`);
      }
    }

    const expected = String(evidence.expected_result ?? "pass");
    const actual = String(caseResult.result);

    // Attribute every check to its matcher type so the report shows which
    // matchers are actually driven to fail by a fixture, rather than only which
    // are registered. A matcher with zero fixture_fail entries is untested in
    // the direction that matters.
    for (const check of caseResult.checks ?? []) {
      const type = String((check as any).type ?? "unknown");
      byMatcher[type] ??= { fixture_pass: 0, fixture_fail: 0 };
      if (String((check as any).result) === "pass") byMatcher[type].fixture_pass += 1;
      else byMatcher[type].fixture_fail += 1;
    }

    if (actual === expected) {
      matched += 1;
    } else {
      mismatched.push({ fixture: rel, skill: entry.data.skill, case_id: entry.data.id, expected, actual });
      console.error(`[verify-fixtures] ${entry.data.skill}/${entry.data.id} ${rel}: expected ${expected}, got ${actual}`);
    }
  }

  const report: FixtureVerification = {
    schema_version: "1.0",
    total: fixturePaths.length,
    matched,
    mismatched,
    by_matcher: Object.fromEntries(Object.entries(byMatcher).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };

  if (options.output) {
    const outPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${stableStringify(report)}\n`);
    console.log(`[verify-fixtures] wrote ${repoRelative(outPath)}`);
  }

  // Pipeline bugs outrank evaluator regressions: an orphan fixture, a result
  // that does not satisfy result.schema.json, or a matcher that threw means the
  // harness is broken, and reporting that as a scoring failure would send the
  // reader to the wrong file.
  if (orphans || schemaViolations || evaluatorFaults) {
    console.error(
      `[verify-fixtures] FAIL: ${orphans} orphan fixture(s), ` +
        `${schemaViolations} result(s) violating result.schema.json, ` +
        `${evaluatorFaults} evaluator exception(s)`,
    );
    return 2;
  }

  if (mismatched.length) {
    console.error(
      `[verify-fixtures] FAIL: ${mismatched.length}/${report.total} fixture(s) did not produce their declared expected_result. ` +
        "A matcher has stopped detecting the defect its negative fixture encodes.",
    );
    return 1;
  }

  console.log(`[verify-fixtures] OK: ${matched}/${report.total} fixtures produced their declared expected_result.`);
  return 0;
}
