/**
 * cesium-eval — unified CLI for the CesiumJS skill evaluation and
 * self-optimization lifecycle.
 *
 * Configuration precedence: built-in defaults < eval.config.json < environment
 * variables < command-line flags. Harnesses and models are declared in
 * config/harness-registry.json — data, not code.
 *
 * Exit codes: 0 = pass/success, 1 = failure (evaluation failure or runtime
 * error), 2 = command-line usage error.
 */
import { createRequire } from "node:module";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { loadContext } from "../config/load.js";
import type { EvalContext } from "../config/types.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

const program = new Command();

let cachedContext: EvalContext | null = null;
function ctx(): EvalContext {
  cachedContext ??= loadContext({ configPath: program.opts().config });
  return cachedContext;
}

async function run(action: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await action();
  } catch (exc: any) {
    console.error(`error: ${exc?.message ?? exc}`);
    process.exitCode = 1;
  }
}

function parseFloatArg(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`'${value}' is not a number.`);
  return parsed;
}

function parseIntArg(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`'${value}' is not an integer.`);
  return parsed;
}

program
  .name("cesium-eval")
  .description("Evaluation and self-optimization platform for CesiumJS agent skills.")
  .option("--config <path>", "path to eval.config.json (default: <repo>/eval.config.json)")
  .version(version)
  // Usage errors (unknown flags, missing args, bad choices) exit 2; --help and
  // --version exit 0. Runtime failures inside actions exit 1 via run(). Must be
  // set before subcommands are created so they inherit the override.
  .exitOverride();

// ---------------------------------------------------------------------------
// evaluation lane
// ---------------------------------------------------------------------------
program
  .command("score")
  .description("Run the deterministic evaluation scorecard over fixtures or captured evidence.")
  .option("--cases-root <dir>", "evaluation case manifests root")
  .option("--fixtures-root <dir>", "synthetic fixture evidence root")
  .addOption(new Option("--fixture-expectation <kind>", "which fixtures to run when --evidence is omitted").choices(["pass", "fail", "all"]).default("pass"))
  .option("--evidence <path...>", "evidence JSON file(s) to score")
  .option("--visual-review <path>", "qualitative visual review JSON to attach")
  .option("--require-visual-review", "fail cases without a recorded visual review")
  .option("--harness <id>", "codegen harness that produced the scored evidence")
  .option("--model <id>", "codegen model id (stamped under artifacts.model)")
  .option("--model-variant <id>", "codegen reasoning effort / variant")
  .option("--threshold <number>", "pass threshold", parseFloatArg)
  .option("--output-dir <dir>", "scorecard output directory")
  .action((options) =>
    run(async () => {
      const { scoreCommand } = await import("../commands/score.js");
      return scoreCommand(ctx(), options);
    }),
  );

program
  .command("case")
  .description("Run one evaluation case against one evidence bundle.")
  .argument("<case>", "path to evaluation case JSON")
  .requiredOption("--evidence <path>", "path to captured evidence JSON")
  .option("--output <path>", "write the result JSON here instead of stdout")
  .action((casePath, options) =>
    run(async () => {
      const { caseCommand } = await import("../commands/score.js");
      return caseCommand(casePath, options.evidence, options.output);
    }),
  );

program
  .command("verify-fixtures")
  .description("Assert every tracked fixture produces its declared expected_result, in both polarities.")
  .option("--cases-root <dir>", "evaluation case manifests root")
  .option("--fixtures-root <dir>", "synthetic fixture evidence root")
  .option("--output <path>", "write the verification report JSON here")
  .action((options) =>
    run(async () => {
      const { verifyFixturesCommand } = await import("../commands/verifyFixtures.js");
      ctx(); // resolve repo root early for clear errors
      return verifyFixturesCommand(options);
    }),
  );

program
  .command("audit")
  .description("Run deterministic + visual-judge lanes over rendered baselines into one combined scorecard.")
  .option("--skills <list>", "'all' or comma-separated skill ids", "all")
  .option("--judge-model <id>", "judge model id (default: config/discovery)")
  .option("--judge-provider <id>", "canonical provider serving the judge model (registry providers[]; harness default when omitted)")
  .option("--judge-variant <id>", "judge reasoning effort / variant (default: config/harness default)")
  .option("--n-judges <n>", "panel size", parseIntArg)
  .option("--concurrency <n>", "cases judged in parallel, 1-8 (default 4)", parseIntArg)
  .option("--no-judge", "skip the qualitative lane entirely")
  .option("--visual-review <path>", "pre-judged visual-review JSON to inject")
  .option("--emit-cases <path>", "write the audit work list and exit")
  .option("--emit-visual-review <path>", "also write the assembled visual-review doc")
  .option("--judge-harness <id>", "judge harness: a registry harness id or 'fake'")
  .option("--codegen-harness <id>", "codegen harness stamped into the scorecard")
  .option("--codegen-model <id>", "codegen model id stamped into the scorecard (overrides meta recovery)")
  .option("--codegen-provider <id>", "canonical provider stamped as having served the codegen model")
  .option("--codegen-variant <id>", "codegen reasoning effort / variant stamped into the scorecard")
  .option("--bundle-root <dir>", "root containing recaptured rendered bundles")
  .option("--threshold <number>", "pass threshold", parseFloatArg)
  .option("--output-dir <dir>", "scorecard output directory")
  .option("--journal <path>", "JSONL progress-journal path (streamed by the console)")
  .action((options) =>
    run(async () => {
      const { auditCommand } = await import("../commands/audit.js");
      return auditCommand(ctx(), { ...options, noJudge: options.judge === false });
    }),
  );

program
  .command("probe")
  .description("Verify (harness, model, variant) bindings end-to-end: capability (real tool use) + observed attribution.")
  .option("--harness <id>", "registry harness id, comma list, or 'all'", "all")
  .option("--model <id>", "model override for a single-harness probe")
  .option("--variant <id>", "reasoning effort / variant override for a single-harness probe")
  .option("--adapter <target>", "route a single-harness probe through the protocol adapter to this target name")
  .option("--json", "emit machine-readable results")
  .action((options) =>
    run(async () => {
      const { probeCommand } = await import("../commands/probe.js");
      return probeCommand(ctx(), options);
    }),
  );

program
  .command("render-baselines")
  .description("Blank run: generate and render current scenario baselines into complete audit evidence bundles.")
  .option("--skills <list>", "'all' or comma-separated skill ids", "all")
  .option("--out <dir>", "output root (repo-relative)", "optimization/runs")
  .option("--only <list>", "comma-separated case ids to render")
  .option("--force", "re-render even if a complete bundle already exists")
  .option("--regenerate", "re-generate the baseline source too (implies --force)")
  .option("--skip-codegen", "never invoke the codegen agent; report missing source instead")
  .option("--codegen-harness <id>", "codegen harness (registry id)")
  .option("--codegen-provider <id>", "canonical provider serving the codegen model")
  .option("--codegen-model <id>", "codegen model id")
  .option("--codegen-variant <id>", "codegen reasoning effort / variant")
  .action((options) =>
    run(async () => {
      const { renderBaselinesCommand } = await import("../commands/renderBaselines.js");
      return renderBaselinesCommand(ctx(), options);
    }),
  );

program
  .command("adapter <action>")
  .description("Protocol adapter (LiteLLM) lifecycle: init | start | stop | status. Ships orchestration, not the binary — runs pinned via uvx.")
  .action((action) =>
    run(async () => {
      const { adapterCommand } = await import("../commands/adapter.js");
      return adapterCommand(ctx(), action);
    }),
  );

program
  .command("judge")
  .description("Run the static visual judge panel over one rendered bundle.")
  .requiredOption("--bundle <dir>", "bundle directory with screenshot.png etc.")
  .requiredOption("--case <path>", "path to the case JSON (scenario metadata)")
  .option("--model <id>", "judge model id")
  .option("--variant <id>", "judge reasoning effort / variant")
  .option("--n-judges <n>", "panel size", parseIntArg)
  .option("--harness <id>", "judge harness: a registry harness id or 'fake'")
  .option("--emit-item <path>", "write the emitted item JSON to this path")
  .action((options) =>
    run(async () => {
      const { judgeCommand } = await import("../commands/audit.js");
      return judgeCommand(ctx(), options);
    }),
  );

program
  .command("capture")
  .description("Capture before/after Cesium scene-state evidence for a case in a headless browser.")
  .argument("<case>", "path to evaluation case JSON")
  .requiredOption("--candidate-js <path>", "path to candidate JavaScript")
  .option("--output <path>", "path to write evidence JSON")
  .option("--run-checks", "run deterministic checks after capture")
  .option("--no-headless", "show the browser window")
  .action((casePath, options) =>
    run(async () => {
      const { captureCommand } = await import("../commands/capture.js");
      return captureCommand(ctx(), { ...options, case: casePath, noHeadless: options.headless === false });
    }),
  );

program
  .command("validate")
  .description("Validate evaluation cases/fixtures and optimization scenario manifests.")
  .addOption(new Option("--suite <suite>", "which validation suite to run").choices(["evaluation", "optimization", "all"]).default("all"))
  .action((options) =>
    run(async () => {
      const { validateCommand } = await import("../commands/validate.js");
      ctx(); // resolve repo root early for clear errors
      return validateCommand(options.suite);
    }),
  );

program
  .command("backfill")
  .description("Backfill codegen provenance (harness/model/effort) into historical scorecards.")
  .option("--dry-run", "report changes without writing")
  .option("--check", "exit non-zero if any scorecard is missing recoverable provenance (CI gate)")
  .action((options) =>
    run(async () => {
      const { backfillCommand } = await import("../commands/backfill.js");
      ctx();
      return backfillCommand(options);
    }),
  );

program
  .command("serve")
  .description("Serve the Skill Evaluation Console (SPA + JSON API) over the artifacts.")
  .argument("[scorecard]", "path to the focused run's scorecard.json (defaults to newest run; optional for a blank repo)")
  .option("--state-dir <dir>", "directory for review-decisions.json / focus.json")
  .option("--host <host>", "bind host (the console is loopback-only; non-loopback clients are rejected)")
  .option("--port <port>", "bind port (0 for ephemeral)", parseIntArg)
  .option("--open", "open the system browser after start")
  .action((scorecard, options) =>
    run(async () => {
      const { serveCommand } = await import("../commands/serve.js");
      return serveCommand(ctx(), { ...options, scorecard });
    }),
  );

// ---------------------------------------------------------------------------
// optimization lane
// ---------------------------------------------------------------------------
const optimize = program.command("optimize").description("Self-optimization loop and its individual phases.");

const agentSelectionOptions = (command: Command, roles: string[]): Command => {
  for (const role of roles) {
    command
      .option(`--${role}-harness <id>`, `${role} harness (registry id)`)
      .option(`--${role}-model <id>`, `${role} model id`)
      .option(`--${role}-variant <id>`, `${role} reasoning effort / variant`);
  }
  return command;
};

const pickAgent = (options: Record<string, any>, role: string) => ({
  harness: options[`${role}Harness`],
  model: options[`${role}Model`],
  variant: options[`${role}Variant`],
});

agentSelectionOptions(
  optimize
    .command("loop")
    .description("Autonomous propose -> codegen -> render -> judge -> decide loop for one skill.")
    .argument("<skill>", "skill id, e.g. cesiumjs-camera")
    .option("--max-iterations <n>", "maximum iterations", parseIntArg)
    .addOption(new Option("--stop-on <condition>", "stopping condition").choices(["plateau", "regression", "max"]))
    .option("--plateau-n <n>", "consecutive ties to trigger plateau stop", parseIntArg)
    .option("--promote", "apply KEEP candidates to skills/<skill>/SKILL.md (default: stage for human review and stop)")
    .option("--proposer-history <n>", "iterations of history for the proposer", parseIntArg)
    .option("--proposer-temperature <t>", "proposer temperature (metadata only)", parseFloatArg)
    .option("--proposer-decision-path <path>", "decision record to seed the proposer"),
  ["proposer", "codegen", "judge"],
).action((skill, options) =>
  run(async () => {
    const { loopCommand } = await import("../commands/optimize.js");
    return loopCommand(ctx(), {
      skill,
      maxIterations: options.maxIterations,
      stopOn: options.stopOn,
      plateauN: options.plateauN,
      promote: options.promote,
      proposerHistory: options.proposerHistory,
      proposerTemperature: options.proposerTemperature,
      proposerDecisionPath: options.proposerDecisionPath,
      proposer: pickAgent(options, "proposer"),
      codegen: pickAgent(options, "codegen"),
      judge: pickAgent(options, "judge"),
    });
  }),
);

agentSelectionOptions(
  optimize
    .command("all")
    .description("Run the loop across every (or selected) skill, optionally scorecard-seeded.")
    .option("--skills <list>", "'all' or comma-separated skill ids")
    .option("--from-scorecard <path>", "derive focus from an evaluation scorecard")
    .option("--from-focus <path>", "seed proposers from a scorecard-focus JSON")
    .option("--max-iterations <n>", "maximum iterations per skill", parseIntArg)
    .addOption(new Option("--stop-on <condition>", "stopping condition").choices(["plateau", "regression", "max"]))
    .option("--plateau-n <n>", "consecutive ties to trigger plateau stop", parseIntArg)
    .option("--promote", "apply KEEP candidates to skills/<skill>/SKILL.md (default: stage for human review and stop)")
    .option("--continue-on-failure", "continue remaining skills after one fails")
    .option("--concurrency <n>", "independent skill loops to run in parallel (1-8)", parseIntArg, 1)
    .option("--dry-run", "print planned runs without executing"),
  ["proposer", "codegen", "judge"],
).action((options) =>
  run(async () => {
    const { optimizeAllCommand } = await import("../commands/optimize.js");
    return optimizeAllCommand(ctx(), {
      ...options,
      proposer: pickAgent(options, "proposer"),
      codegen: pickAgent(options, "codegen"),
      judge: pickAgent(options, "judge"),
    });
  }),
);

agentSelectionOptions(
  optimize
    .command("propose")
    .description("Propose a revised skill from evaluation history and coverage analysis.")
    .argument("<skill>", "skill id")
    .option("--iteration <id>", "iteration id (default: next)")
    .option("--skill-path <path>", "current best skill file")
    .option("--decision-path <path>", "last decision record")
    .option("--coverage-path <path>", "coverage report path")
    .option("--output-dir <dir>", "candidate output directory")
    .option("--max-history <n>", "historical iterations in proposer context", parseIntArg)
    .option("--temperature <t>", "temperature (metadata only)", parseFloatArg)
    .option("--prompt-version <id>", "prompt template version"),
  ["proposer"],
).action((skill, options) =>
  run(async () => {
    const { proposeCommand } = await import("../commands/optimize.js");
    return proposeCommand(ctx(), { ...options, skill, ...pickAgent(options, "proposer") });
  }),
);

optimize
  .command("promote")
  .description("Apply a staged KEEP candidate to skills/<skill>/SKILL.md (the human promotion gate).")
  .argument("<skill>", "skill id")
  .argument("<iteration>", "iteration id, e.g. 001")
  .action((skill, iteration) =>
    run(async () => {
      const { promoteCommand } = await import("../commands/optimize.js");
      ctx();
      return promoteCommand({ skill, iteration });
    }),
  );

optimize
  .command("render")
  .description("Render generated snippets in a headless browser into evidence bundles.")
  .argument("<skill>", "skill id")
  .option("--iteration <id>", "generated-code iteration", "candidate")
  .option("--generated-dir <dir>", "directory containing generated JS (overrides iteration layout)")
  .option("--output-dir <dir>", "run output directory (overrides iteration layout)")
  .option("--only <list>", "comma-separated scenario ids to run")
  .option("--timeout-ms <n>", "page navigation timeout", parseIntArg)
  .action((skill, options) =>
    run(async () => {
      const { renderCommand } = await import("../commands/optimize.js");
      return renderCommand(ctx(), { ...options, skill });
    }),
  );

agentSelectionOptions(
  optimize
    .command("generate-baselines")
    .description("Generate baseline JS for all scenarios against the current best skills.")
    .option("--skill <id>", "only generate for this skill")
    .option("--skill-root <dir>", "candidate skill root (defaults to tracked skills/)")
    .option("--iteration <id>", "output iteration label", "baseline")
    .option("--force", "re-generate even if the .js exists")
    .option("--only <list>", "comma-separated scenario ids"),
  ["codegen"],
).action((options) =>
  run(async () => {
    const { generateBaselinesCommand } = await import("../commands/optimize.js");
    return generateBaselinesCommand(ctx(), { ...options, ...pickAgent(options, "codegen") });
  }),
);

agentSelectionOptions(
  optimize
    .command("rejudge")
    .description("Re-run judges + decision for an existing iteration without re-rendering.")
    .argument("<skill>", "skill id")
    .option("--baseline-iter <id>", "baseline iteration", "000")
    .option("--candidate-iter <id>", "candidate iteration", "001")
    .option("--output-iter <id>", "where to write decision.json (default: candidate iter)"),
  ["judge"],
).action((skill, options) =>
  run(async () => {
    const { rejudgeCommand } = await import("../commands/optimize.js");
    const judge = pickAgent(options, "judge");
    return rejudgeCommand(ctx(), {
      skill,
      baselineIter: options.baselineIter,
      candidateIter: options.candidateIter,
      outputIter: options.outputIter,
      judgeHarness: judge.harness,
      judgeModel: judge.model,
      judgeVariant: judge.variant,
    });
  }),
);

optimize
  .command("decide")
  .description("Run the keep/reject decision engine over aggregated results.")
  .argument("<skill>", "skill id")
  .argument("<iteration>", "iteration id")
  .requiredOption("--check-results <path>", "aggregated check results JSON")
  .requiredOption("--judge-results <path>", "aggregated judge results JSON")
  .requiredOption("--scenario-meta <path>", "scenario metadata JSON")
  .option("--baselines <path>", "baselines.json path")
  .option("--output <path>", "decision.json output path")
  .option("--override <rationale>", "manual override rationale")
  .addOption(new Option("--override-decision <decision>", "decision when overriding").choices(["KEEP", "REJECT"]))
  .action((skill, iteration, options) =>
    run(async () => {
      const { decideCommand } = await import("../commands/optimize.js");
      ctx();
      return decideCommand({ ...options, skill, iteration });
    }),
  );

optimize
  .command("report")
  .description("Generate the sanitized per-iteration summary and public status rollup.")
  .argument("<skill>", "skill id")
  .argument("<iteration>", "iteration id")
  .requiredOption("--decision <path>", "decision.json path")
  .requiredOption("--check-results <path>", "check results JSON")
  .requiredOption("--judge-results <path>", "judge results JSON")
  .requiredOption("--scenarios <dir>", "scenarios directory")
  .option("--public-status <path>", "public-status.json path")
  .option("--output-dir <dir>", "summary output directory")
  .action((skill, iteration, options) =>
    run(async () => {
      const { reportCommand } = await import("../commands/optimize.js");
      return reportCommand(ctx().repoRoot, { ...options, skill, iteration });
    }),
  );

optimize
  .command("focus")
  .description("Summarize deterministic scorecard failures for optimization focus.")
  .argument("<scorecard>", "path to evaluation scorecard JSON")
  .addOption(new Option("--format <format>", "output format").choices(["json", "markdown", "decision"]).default("json"))
  .option("--skill <id>", "restrict decision output to one skill")
  .option("--output <path>", "write the focus summary here")
  .action((scorecard, options) =>
    run(async () => {
      const { focusCommand } = await import("../commands/optimize.js");
      ctx();
      return focusCommand({ ...options, scorecard });
    }),
  );

optimize
  .command("rebaseline")
  .description("Record a scenario's current content hash as the new baseline.")
  .argument("<skill>", "skill id")
  .argument("<eval-id>", "scenario id (eval-NNN)")
  .option("--dry-run", "report without writing baselines.json")
  .action((skill, evalId, options) =>
    run(async () => {
      const { rebaselineCommand } = await import("../commands/optimize.js");
      ctx();
      return rebaselineCommand({ skill, evalId, dryRun: options.dryRun });
    }),
  );

optimize
  .command("coverage")
  .description("Map skill sections/APIs to the scenarios that exercise them.")
  .action(() =>
    run(async () => {
      const { coverageCommand } = await import("../commands/optimize.js");
      ctx();
      return coverageCommand();
    }),
  );

// ---------------------------------------------------------------------------
// repo checks
// ---------------------------------------------------------------------------
const check = program.command("check").description("Repository safety and hygiene gates.");

check
  .command("public-artifacts")
  .description("Scan public docs and eval artifacts for private or unsafe references.")
  .argument("[paths...]", "specific files/dirs to scan (default: tracked scan roots)")
  .action((paths) =>
    run(async () => {
      const { checkPublicArtifactsCommand } = await import("../commands/check.js");
      return checkPublicArtifactsCommand(ctx().repoRoot, paths ?? []);
    }),
  );

check
  .command("skills")
  .description("Enforce the skill contract over skills/<id>/SKILL.md (frontmatter, code fences, CesiumJS symbols).")
  .option("--skills <list>", "'all' or comma-separated skill ids", "all")
  .option("--output <path>", "write a machine-readable skill-contract report")
  .action((options) =>
    run(async () => {
      const { checkSkillsCommand } = await import("../commands/checkSkills.js");
      ctx(); // resolve repo root early for clear errors
      return checkSkillsCommand(options);
    }),
  );

check
  .command("canonical-surface")
  .description("Ensure active eval work stays under optimization/ and evaluation/.")
  .action(() =>
    run(async () => {
      const { checkCanonicalSurfaceCommand } = await import("../commands/check.js");
      return checkCanonicalSurfaceCommand(ctx().repoRoot);
    }),
  );

program.parseAsync().catch((exc) => {
  if (exc instanceof CommanderError) {
    // commander already printed the message; help/version are success paths.
    process.exitCode = exc.exitCode === 0 ? 0 : 2;
    return;
  }
  console.error(`error: ${exc?.message ?? exc}`);
  process.exitCode = 1;
});
