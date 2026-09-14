/**
 * `.env` is a local convenience, never an authority.
 *
 * CI supplies CESIUM_ION_TOKEN (and harness auth) as real environment
 * variables from GitHub secrets/variables. If a checked-out or leftover `.env`
 * could override those, a stale local token would silently win over the one CI
 * was configured with — the failure would look like a bad secret, not a bad
 * precedence rule. So: already-set variables win, and a missing file is a no-op.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/config/load.js";

const NAMES = ["EVAL_DOTENV_TEST_A", "EVAL_DOTENV_TEST_B", "EVAL_DOTENV_TEST_QUOTED"];

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dotenv-"));
  for (const name of NAMES) delete process.env[name];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const name of NAMES) delete process.env[name];
});

describe("loadDotEnv", () => {
  it("fills unset variables and ignores comments and blank lines", () => {
    fs.writeFileSync(
      path.join(root, ".env"),
      ["# a comment", "", "EVAL_DOTENV_TEST_A=from-file", "EVAL_DOTENV_TEST_QUOTED=\"quoted value\"", ""].join("\n"),
    );
    loadDotEnv(root);
    expect(process.env.EVAL_DOTENV_TEST_A).toBe("from-file");
    expect(process.env.EVAL_DOTENV_TEST_QUOTED).toBe("quoted value");
  });

  it("never overrides a variable the environment already set (the CI secret wins)", () => {
    process.env.EVAL_DOTENV_TEST_A = "from-ci-secret";
    fs.writeFileSync(path.join(root, ".env"), "EVAL_DOTENV_TEST_A=stale-local-token\nEVAL_DOTENV_TEST_B=from-file\n");
    loadDotEnv(root);
    expect(process.env.EVAL_DOTENV_TEST_A).toBe("from-ci-secret");
    expect(process.env.EVAL_DOTENV_TEST_B).toBe("from-file");
  });

  it("is a no-op when no .env exists (the CI case)", () => {
    expect(() => loadDotEnv(root)).not.toThrow();
    expect(process.env.EVAL_DOTENV_TEST_A).toBeUndefined();
  });
});
