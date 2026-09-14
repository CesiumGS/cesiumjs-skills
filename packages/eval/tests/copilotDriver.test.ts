import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import "../src/harness/drivers.js";
import { driverFor } from "../src/harness/driver.js";

const originalArgsPath = process.env.COPILOT_TEST_ARGS_PATH;

afterEach(() => {
  if (originalArgsPath === undefined) delete process.env.COPILOT_TEST_ARGS_PATH;
  else process.env.COPILOT_TEST_ARGS_PATH = originalArgsPath;
});

describe("Copilot driver confinement", () => {
  it("pins noninteractive behavior and exposes only the requested tools", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-driver-"));
    const binary = path.join(dir, "copilot");
    const argsPath = path.join(dir, "args.json");
    fs.writeFileSync(
      binary,
      [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        'fs.writeFileSync(process.env.COPILOT_TEST_ARGS_PATH, JSON.stringify(process.argv.slice(2)));',
        'process.stdin.resume();',
        'process.stdin.on("end", () => process.stdout.write("OK\\n"));',
      ].join("\n"),
      { mode: 0o700 },
    );
    process.env.COPILOT_TEST_ARGS_PATH = argsPath;

    try {
      const context = loadContext({ loadDotEnv: false });
      const spec = { ...context.harness("copilot"), binary_candidates: [binary] };
      const result = await driverFor(spec).invoke(spec, {
        prompt: "test",
        model: "gpt-5.6-sol",
        variant: "low",
        allowedTools: ["Read", "Grep", "Glob"],
        cwd: dir,
        timeoutSeconds: 10,
      });
      const args = JSON.parse(fs.readFileSync(argsPath, "utf-8")) as string[];

      expect(result).toBe("OK");
      expect(args).toContain("--no-auto-update");
      expect(args).toContain("--disallow-temp-dir");
      expect(args).toContain("--available-tools=view,rg,glob");
      expect(args).not.toContain("--allow-all");
      expect(args).not.toContain("--allow-all-paths");

      const noToolResult = await driverFor(spec).invoke(spec, {
        prompt: "candidate skill codegen",
        model: "gpt-5.6-sol",
        variant: "low",
        disableTools: true,
        cwd: dir,
        timeoutSeconds: 10,
      });
      const noToolArgs = JSON.parse(fs.readFileSync(argsPath, "utf-8")) as string[];
      expect(noToolResult).toBe("OK");
      expect(noToolArgs).toContain("--available-tools=");
      expect(noToolArgs).not.toContain("--available-tools=view,rg,glob");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
