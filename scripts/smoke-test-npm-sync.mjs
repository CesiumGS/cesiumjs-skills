import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "@cesium/cesiumjs-skills";
const skillsCliVersion = process.env.SKILLS_CLI_VERSION ?? "1.5.10";
const expectedSkillNames = [
  "cesiumjs-3d-tiles",
  "cesiumjs-camera",
  "cesiumjs-core-utilities",
  "cesiumjs-custom-shader",
  "cesiumjs-entities",
  "cesiumjs-imagery",
  "cesiumjs-interaction",
  "cesiumjs-materials-shaders",
  "cesiumjs-models-particles",
  "cesiumjs-primitives",
  "cesiumjs-spatial-math",
  "cesiumjs-terrain-environment",
  "cesiumjs-time-properties",
  "cesiumjs-viewer-setup",
  "using-cesiumjs-skills",
];

const agentSkillRoots = {
  codex: [".agents", "skills"],
  "claude-code": [".agents", "skills"],
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: {
      ...process.env,
      DISABLE_TELEMETRY: "1",
      NO_COLOR: "1",
      npm_config_audit: "false",
      npm_config_fund: "false",
      ...options.env,
    },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result.stdout;
}

async function verifySyncedSkills(tempRoot, agent) {
  const skillRootParts = agentSkillRoots[agent];
  if (!skillRootParts) {
    throw new Error(`No expected skill root configured for ${agent}`);
  }

  const lockPath = path.join(tempRoot, "skills-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));

  for (const skillName of expectedSkillNames) {
    const skillPath = path.join(tempRoot, ...skillRootParts, skillName, "SKILL.md");
    if (!existsSync(skillPath)) {
      throw new Error(`expected ${agent} synced skill at ${path.relative(tempRoot, skillPath)}`);
    }

    const lockEntry = lock.skills?.[skillName];
    if (!lockEntry) {
      throw new Error(`skills-lock.json is missing ${skillName}`);
    }
    if (lockEntry.source !== packageName || lockEntry.sourceType !== "node_modules") {
      throw new Error(`${skillName} lock entry does not point to ${packageName} from node_modules`);
    }
  }
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cesiumjs-skills-npm-sync-"));

  try {
    const packOutput = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", tempRoot]);
    const [packed] = JSON.parse(packOutput);
    const tarballPath = path.join(tempRoot, packed.filename);

    for (const agent of Object.keys(agentSkillRoots)) {
      const projectRoot = path.join(tempRoot, `project-${agent}`);
      await mkdir(projectRoot);
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ private: true, name: `cesiumjs-skills-smoke-test-${agent}` }, null, 2),
      );
      await writeFile(
        path.join(projectRoot, "README.md"),
        "Temporary npm sync smoke test project.\n",
      );

      run("npm", ["install", "--package-lock=false", "--ignore-scripts", tarballPath], {
        cwd: projectRoot,
      });
      run("npx", ["--yes", `skills@${skillsCliVersion}`, "experimental_sync", "--agent", agent, "-y"], {
        cwd: projectRoot,
      });
      await verifySyncedSkills(projectRoot, agent);
    }

    console.log(
      `Synced ${expectedSkillNames.length} skills from ${packageName} for ${Object.keys(agentSkillRoots).join(", ")} in ${tempRoot}.`,
    );

    if (!process.env.KEEP_SKILLS_SMOKE_TMP) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(error.message);
    console.error(`Temporary test directory preserved at ${tempRoot}`);
    process.exit(1);
  }
}

main();
