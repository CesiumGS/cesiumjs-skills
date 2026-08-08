#!/usr/bin/env node
/** Render the deterministic gate's machine-readable artifacts as GitHub Markdown. */
import * as fs from "node:fs";
import * as path from "node:path";

const STAGES = [
  ["build", "Build eval CLI"],
  ["validate-evaluation", "Validate evaluation manifests"],
  ["validate-optimization", "Validate optimization scenarios"],
  ["skill-contract", "Check skill contract"],
  ["unit-tests", "Eval CLI unit tests"],
  ["score", "Score positive fixtures"],
  ["verify-fixtures", "Verify both fixture polarities"],
  ["canonical-surface", "Check canonical eval surface"],
  ["public-artifacts", "Scan tracked public surface"],
  ["working-tree", "Assert CI working tree unchanged"],
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`expected --name value arguments, got ${JSON.stringify(argv.slice(index))}`);
    }
    args[flag.slice(2)] = argv[index + 1];
  }
  for (const required of ["status", "output", "exit-code"]) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readStages(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const rows = new Map();
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line) continue;
    const [id, status, duration, detail = ""] = line.split("\t");
    rows.set(id, { status, duration: Number(duration), detail });
  }
  return rows;
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ");
}

function pct(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
}

function duration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function progress(value) {
  const score = Math.max(0, Math.min(1, Number(value)));
  const filled = Math.round(score * 10);
  return `\`${"█".repeat(filled)}${"░".repeat(10 - filled)}\``;
}

function stageLabel(status) {
  if (status === "pass") return "✅ Passed";
  if (status === "fail") return "❌ Failed";
  if (status === "error") return "⚠️ Error";
  if (status === "skipped") return "➖ Skipped";
  return "⏭️ Not run";
}

function runLink() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function render(args) {
  const exitCode = Number(args["exit-code"]);
  const stages = readStages(args.status);
  const skillReport = readJson(args.skills);
  const scorecard = readJson(args.scorecard);
  const fixtures = readJson(args.fixtures);
  const completed = [...stages.values()];
  const totalDuration = completed.reduce((sum, row) => sum + (Number.isFinite(row.duration) ? row.duration : 0), 0);
  const hasPipelineError = completed.some((row) => row.status === "error") || skillReport?.result === "error";
  const passed = exitCode === 0;
  const title = passed
    ? "✅ Deterministic Gate Passed"
    : hasPipelineError
      ? "⚠️ Deterministic Gate Error"
      : "❌ Deterministic Gate Failed";
  const result = passed ? "✅ PASS" : hasPipelineError ? "⚠️ ERROR" : "❌ FAIL";
  const issueCount = Number(skillReport?.violation_count ?? scorecard?.critical_failures?.length ?? 0);
  const affectedCount = Number(skillReport?.affected_skills?.length ?? 0);
  const skillsChecked = skillReport?.checked_skill_count ?? "—";
  const fixtureResult = fixtures ? `${fixtures.matched}/${fixtures.total}` : "—";

  let headline = "All deterministic stages completed successfully.";
  if (!passed && skillReport?.setup_error) {
    headline = `The skill checker could not run: ${escapeCell(skillReport.setup_error)}`;
  } else if (!passed && skillReport?.violation_count) {
    headline = `${issueCount} contract violation${issueCount === 1 ? "" : "s"} across ${affectedCount} affected skill${affectedCount === 1 ? "" : "s"} stopped the gate.`;
  } else if (!passed) {
    const failed = STAGES.map(([id, label]) => [label, stages.get(id)]).find(([, row]) =>
      ["fail", "error"].includes(row?.status),
    );
    headline = failed ? `${failed[0]} did not pass. Later stages were not run.` : `The gate exited with code ${exitCode}.`;
  }

  const lines = [
    `# ${title}`,
    "",
    `> ${headline}`,
    "",
    "| Result | Deterministic score | Skills checked | Skill issues | Fixtures reconciled | Duration |",
    "| :---: | :---: | :---: | :---: | :---: | :---: |",
    `| **${result}** | **${scorecard ? pct(scorecard.overall_score) : "—"}** | **${skillsChecked}** | **${issueCount}** | **${fixtureResult}** | **${duration(totalDuration)}** |`,
    "",
    "## Gate stages",
    "",
    "| Stage | Result | Time | Detail |",
    "| --- | :---: | ---: | --- |",
  ];

  for (const [id, label] of STAGES) {
    const row = stages.get(id);
    lines.push(
      `| ${label} | ${stageLabel(row?.status)} | ${row ? duration(row.duration) : "—"} | ${escapeCell(row?.detail ?? "Stopped before this stage")} |`,
    );
  }

  if (skillReport) {
    lines.push("", "## Skill contract", "");
    if (skillReport.setup_error) {
      lines.push(`> ⚠️ ${escapeCell(skillReport.setup_error)}`);
    } else if (!skillReport.violation_count) {
      lines.push(
        `✅ All **${skillReport.checked_skill_count} skills** satisfy the contract against **${skillReport.registry_symbol_count} registered CesiumJS symbols**.`,
      );
    } else {
      lines.push(
        `**${skillReport.violation_count} findings** across **${skillReport.affected_skills.length} skills** and **${Object.keys(skillReport.violations_by_rule).length} rule families**.`,
        "",
        "| Rule | Findings |",
        "| --- | ---: |",
      );
      for (const [rule, count] of Object.entries(skillReport.violations_by_rule).sort(
        (a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]),
      )) {
        lines.push(`| \`${escapeCell(rule)}\` | ${count} |`);
      }

      lines.push(
        "",
        `<details${passed ? "" : " open"}><summary><strong>All skill findings</strong></summary>`,
        "",
        "| File | Rule | Finding |",
        "| --- | --- | --- |",
      );
      const shown = skillReport.violations.slice(0, 100);
      for (const violation of shown) {
        lines.push(
          `| \`${escapeCell(violation.file)}\` | \`${escapeCell(violation.rule)}\` | ${escapeCell(violation.detail)} |`,
        );
      }
      if (shown.length < skillReport.violations.length) {
        lines.push(`| … | … | ${skillReport.violations.length - shown.length} additional findings are in \`skill-contract.json\`. |`);
      }
      lines.push("", "</details>");
    }
  }

  if (scorecard) {
    lines.push(
      "",
      "## Deterministic score",
      "",
      `Overall **${pct(scorecard.overall_score)}** against a **${pct(scorecard.threshold)}** threshold.`,
      "",
      "| Category | Score | Progress | Passed | Total |",
      "| --- | ---: | :---: | ---: | ---: |",
    );
    for (const [category, data] of Object.entries(scorecard.category_scores ?? {})) {
      lines.push(
        `| ${escapeCell(category)} | **${pct(data.score)}** | ${progress(data.score)} | ${data.passed_checks} | ${data.total_checks} |`,
      );
    }
  }

  if (fixtures) {
    const fixtureIcon = fixtures.matched === fixtures.total ? "✅" : "❌";
    lines.push(
      "",
      "## Fixture expectations",
      "",
      `${fixtureIcon} **${fixtures.matched}/${fixtures.total} fixtures** produced their declared result across **${Object.keys(fixtures.by_matcher ?? {}).length} matcher types**.`,
    );
  }

  const url = runLink();
  const sha = process.env.GITHUB_SHA;
  lines.push("", "---", "");
  if (url) lines.push(`[Open workflow run](${url})${sha ? ` · Commit \`${escapeCell(sha.slice(0, 12))}\`` : ""}`);
  else if (sha) lines.push(`Commit \`${escapeCell(sha.slice(0, 12))}\``);
  lines.push("Deterministic and secret-free: no browser, network request, or language model is used by this gate.");
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const markdown = render(args);
fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
fs.writeFileSync(path.resolve(args.output), markdown);
