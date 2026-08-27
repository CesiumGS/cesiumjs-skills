# Getting Started

<img src="../assets/ty-book.png" alt="Ty reading the CesiumJS documentation" class="doc-illustration" />

Install the collection once, then let your coding agent discover the relevant CesiumJS
guidance as each task changes.

## Choose an installation path

| Environment | Best path | Result |
| --- | --- | --- |
| **Claude Code** | Add the repository as a plugin marketplace | Skills and browser-verification integration are available as a plugin |
| **Agent Skills-compatible tools** | Copy or symlink `skills/` into the tool's skills directory | The open-standard skill packages are discovered automatically |
| **Repository development** | Clone this repository | Skills, evaluation cases, optimization scenarios, and validation tooling are available locally |

## Claude Code

Add the marketplace from your terminal:

```bash
claude plugin marketplace add CesiumGS/cesiumjs-skills
```

Then open `/plugin`, install **cesiumjs-skills**, and run `/reload-plugins` in any
existing session.

## Any Agent Skills-compatible tool

Clone the repository and copy or symlink its `skills/` directory into the location your
tool scans for skills:

```bash
git clone https://github.com/CesiumGS/cesiumjs-skills.git
cd cesiumjs-skills
```

Each package follows the [Agent Skills](https://agentskills.io/) convention:

```text
skills/
└── cesiumjs-camera/
    └── SKILL.md
```

Consult your tool's documentation for its discovery directory. Do not flatten the skill
folders; the directory name and `SKILL.md` frontmatter are part of the package identity.

## Try a task

Ask for the outcome you want and include the constraints an experienced CesiumJS
developer would need. For example:

```text
Create a request-render-mode CesiumJS viewer, add a public imagery layer,
and fly to a bounding sphere without depending on Cesium ion.
```

That request spans viewer setup, imagery, and camera behavior. The orientation skill
routes it to those domains while the individual skills provide implementation details.

## Confirm skill discovery

A compatible agent should be able to identify `using-cesiumjs-skills` for initial routing
and then activate one or more `cesiumjs-*` domain skills. If it cannot:

1. Confirm the complete `skills/<skill-name>/SKILL.md` layout is present.
2. Restart or reload the agent so it refreshes skill metadata.
3. Check that copied files preserve the YAML frontmatter at the start of each `SKILL.md`.
4. Ask the agent to list its available CesiumJS skills.

## Next steps

- Use the [Skills Catalog](skills-catalog.md) to choose a domain directly.
- Read [System Overview](architecture.md) to understand routing and progressive disclosure.
- Follow [Evaluation & Optimization](evaluation-optimization.md) before changing skill guidance.
