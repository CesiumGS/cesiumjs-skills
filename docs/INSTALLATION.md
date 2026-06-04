# Installation

CesiumJS Agent Skills can be consumed three ways:

1. Directly from this GitHub repository with the `skills` CLI.
2. As an npm dependency that is synced from `node_modules`.
3. As a Claude Code plugin marketplace entry.

## Requirements

- Node.js 18 or newer.
- npm/npx.
- Git access for `npx skills add CesiumGS/cesiumjs-skills` and `npm install github:CesiumGS/cesiumjs-skills`.
- A skills-compatible agent target. Common targets include `claude-code`, `codex`, `cursor`, and `github-copilot`.
- Review skills before use. Installed skills are local instruction files that run with the permissions of the host agent.

The upstream `skills` CLI is distributed on npm as `skills` and provides the
`skills` binary through `npx skills`. The package declares Node `>=18`.

## Direct GitHub Install

Use this path when you want the shortest install command and do not need to
track the skills as an npm dependency.

```bash
npx skills add CesiumGS/cesiumjs-skills
```

Useful variants:

```bash
# Inspect the repository without installing.
npx skills add CesiumGS/cesiumjs-skills --list

# Install only selected skills.
npx skills add CesiumGS/cesiumjs-skills --skill cesiumjs-camera --skill cesiumjs-entities

# Install all skills to all detected/supported agents without prompts.
npx skills add CesiumGS/cesiumjs-skills --all

# Install globally for one agent.
npx skills add CesiumGS/cesiumjs-skills --global --agent claude-code -y
```

The repository layout is intentionally compatible with the CLI discovery rules:
each skill lives at `skills/<skill-name>/SKILL.md`.

## NPM Dependency Sync

Use this path when a project wants CesiumJS skills to be a normal development
dependency.

Until `@cesium/cesiumjs-skills` is published to npm, install from GitHub:

```bash
npm install --save-dev github:CesiumGS/cesiumjs-skills
npx skills experimental_sync --agent claude-code -y
```

After maintainers publish the npm package:

```bash
npm install --save-dev @cesium/cesiumjs-skills
npx skills experimental_sync --agent claude-code -y
```

`experimental_sync` scans installed packages under `node_modules` for:

- `SKILL.md`
- `skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md`

This package ships the canonical `skills/<name>/SKILL.md` layout, so the sync
command discovers the full CesiumJS skill set.

## NPM Registry And Publishing

No repository-level `.npmrc` is needed for public npm registry installs. If
CesiumGS decides to publish to a private registry instead, add the required
scope registry configuration in the consuming project or organization tooling,
not in this public repository.

The first public publish of the scoped package requires npm access to the
`@cesium` organization and should use:

```bash
npm publish --access public
```

The `publishConfig.access` field in `package.json` keeps future publishes public
by default for this scoped package.

## Claude Code Plugin

Claude Code users can install the plugin marketplace entry:

```bash
claude plugin marketplace add CesiumGS/cesiumjs-skills
```

Then run `/plugin`, install `cesiumjs-skills`, and run `/reload-plugins` in the
current Claude Code session.

The npm package does not move Claude Code plugin files. The Claude Code plugin
layout stays rooted in this repository:

- `skills/`
- `hooks/`
- `.mcp.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

## Local Verification

Maintainers should run these checks before changing install behavior:

```bash
claude plugin validate .
npm test
npm run skills:list
npm run pack:check
```

`npm test` validates package metadata and runs an end-to-end npm sync smoke test
by packing this repository, installing the tarball into temporary projects,
running `npx skills@1.5.10 experimental_sync` for Codex and Claude Code, and
verifying every CesiumJS skill appears in the generated project skill directory
with node_modules-backed entries in `skills-lock.json`.

To inspect the temporary smoke-test project after a failure or for debugging:

```bash
KEEP_SKILLS_SMOKE_TMP=1 npm run test:npm-sync
```
