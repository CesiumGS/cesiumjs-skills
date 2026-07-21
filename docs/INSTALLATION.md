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

### First Public Publish

The first public publish requires an npm account with publish access to the
`@cesium` organization and either two-factor authentication (2FA) or a granular
access token that can publish with 2FA bypass. Run the release only after this
package support has been merged, and publish from a clean checkout of the
current `main` branch.

Clone or update the repository and confirm the checkout exactly matches the
remote `main` branch:

```bash
git clone https://github.com/CesiumGS/cesiumjs-skills.git
cd cesiumjs-skills

git fetch origin
git switch main
git pull --ff-only origin main

test -z "$(git status --porcelain)" || {
  git status --short
  echo "Working tree is not clean; stopping."
  exit 1
}

test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || {
  echo "Local main does not match origin/main; stopping."
  exit 1
}
```

Confirm Node.js, npm, the public registry, and the package metadata:

```bash
node --version
npm --version
npm config get registry
npm pkg get name version publishConfig
```

`node --version` must report Node.js 18 or newer. The package metadata should
identify `@cesium/cesiumjs-skills`, version `0.3.0`, with public access. The
registry should be `https://registry.npmjs.org/`.

Authenticate if necessary, then verify which npm account will publish:

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

Check that this exact version has not already been published:

```bash
npm view @cesium/cesiumjs-skills@0.3.0 version \
  --registry=https://registry.npmjs.org/
```

For the first release, npm should return `E404 Not Found`. If it prints
`0.3.0`, stop: npm package versions are immutable, so that version cannot be
published again.

Run the complete validation and inspect the package contents without publishing
anything:

```bash
npm test
npm run skills:list
npm run pack:check
npm publish --dry-run \
  --access public \
  --registry=https://registry.npmjs.org/
```

If every check passes and the dry run shows
`@cesium/cesiumjs-skills@0.3.0`, perform the first public publish:

```bash
npm publish \
  --access public \
  --registry=https://registry.npmjs.org/
```

npm should prompt for a 2FA code when the account requires one. If npm instead
returns an `EOTP` error, rerun the publish with the current authenticator code:

```bash
npm publish \
  --access public \
  --registry=https://registry.npmjs.org/ \
  --otp="<six-digit-code>"
```

Verify the registry metadata after the publish completes:

```bash
npm view @cesium/cesiumjs-skills@0.3.0 \
  name version dist-tags.latest dist.tarball \
  --json \
  --registry=https://registry.npmjs.org/
```

Finally, test the published artifact from a temporary consumer project rather
than installing the package into this repository:

```bash
CESIUMJS_SKILLS_SMOKE_DIR="$(mktemp -d)"
cd "$CESIUMJS_SKILLS_SMOKE_DIR"

npm init --yes
npm install --save-dev @cesium/cesiumjs-skills@0.3.0
npx --yes skills@1.5.10 experimental_sync --agent codex -y
```

The `publishConfig.access` field in `package.json` keeps this scoped package
public by default for future releases, but the explicit `--access public` flag
is retained above to make the first-release intent unambiguous.

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
