import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedDomainSkillCount = 14;
const expectedPackageName = "@cesium/cesiumjs-skills";
const expectedVersionBaseline = "v1.143";
const expectedPublicSymbolCount = "~551";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseFrontmatter(markdown, filePath) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${filePath} is missing YAML frontmatter`);

  const data = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return data;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function validatePackageMetadata() {
  const packageJson = await readJson("package.json");
  assert(packageJson.name === expectedPackageName, `package.json name must be ${expectedPackageName}`);
  assert(packageJson.license === "Apache-2.0", "package.json license must be Apache-2.0");
  assert(packageJson.engines?.node === ">=18", "package.json must document Node >=18 for the skills CLI");
  assert(packageJson.publishConfig?.access === "public", "package.json must publish scoped package publicly by default");
  assert(
    packageJson.description.includes(expectedVersionBaseline),
    `package.json description must reference CesiumJS ${expectedVersionBaseline}`,
  );

  const requiredFiles = [
    "skills/",
    "docs/",
    ".claude-plugin/",
    ".mcp.json",
    "hooks/",
    "scripts/",
    "README.md",
    "LICENSE",
  ];
  for (const requiredFile of requiredFiles) {
    assert(
      packageJson.files?.includes(requiredFile),
      `package.json files must include ${requiredFile}`,
    );
  }

  return packageJson;
}

async function validateClaudePluginMetadata(packageJson) {
  const pluginJson = await readJson(".claude-plugin/plugin.json");
  const marketplaceJson = await readJson(".claude-plugin/marketplace.json");
  const marketplacePlugin = marketplaceJson.plugins?.find((plugin) => plugin.name === pluginJson.name);

  assert(pluginJson.version === packageJson.version, ".claude-plugin/plugin.json version must match package.json");
  assert(marketplacePlugin, ".claude-plugin/marketplace.json must include this plugin");
  assert(
    marketplacePlugin.version === packageJson.version,
    ".claude-plugin/marketplace.json plugin version must match package.json",
  );
  assert(
    marketplaceJson.metadata?.description?.includes(expectedVersionBaseline),
    `.claude-plugin/marketplace.json metadata must reference CesiumJS ${expectedVersionBaseline}`,
  );
  assert(
    marketplaceJson.metadata?.description?.includes(expectedPublicSymbolCount),
    ".claude-plugin/marketplace.json metadata must stay aligned with README symbol count",
  );
}

async function validateSkills() {
  const skillRoot = path.join(root, "skills");
  const entries = await readdir(skillRoot, { withFileTypes: true });
  const skillDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  const domainSkills = skillDirs.filter((name) => name.startsWith("cesiumjs-"));
  assert(
    domainSkills.length === expectedDomainSkillCount,
    `expected ${expectedDomainSkillCount} CesiumJS domain skills, found ${domainSkills.length}`,
  );
  assert(skillDirs.includes("using-cesiumjs-skills"), "missing using-cesiumjs-skills orientation skill");

  for (const skillDir of skillDirs) {
    const skillPath = path.join(skillRoot, skillDir, "SKILL.md");
    const markdown = await readFile(skillPath, "utf8");
    const frontmatter = parseFrontmatter(markdown, path.relative(root, skillPath));
    assert(frontmatter.name === skillDir, `${skillDir} frontmatter name must match its directory`);
    assert(frontmatter.description, `${skillDir} must have a description`);
  }

  return skillDirs;
}

async function main() {
  const packageJson = await validatePackageMetadata();
  await validateClaudePluginMetadata(packageJson);
  const skillDirs = await validateSkills();

  console.log(`Validated ${skillDirs.length} skills for ${expectedPackageName}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
