# ADR-0007: Evaluate Skill Changes in Two Tiers

## Context

A skill file is a prompt. Editing its wording changes program behaviour, but the
change is invisible to every check that reads code, manifests, or fixtures.

Before this decision, no blocking check read `skills/**/SKILL.md` at all. The
deterministic gate scored pre-recorded fixture evidence, validated case and
scenario manifests, and enforced repository layout. A pull request that rewrote
every word of every skill was therefore indistinguishable, to CI, from a pull
request that changed nothing.

The obvious fix — re-run the agent against the edited skill on every pull request
— cannot be the only fix. It costs a model call and a browser render per
scenario, it needs a credential a fork pull request cannot be given, and it has a
language model in the loop, so it is specific rather than sensitive.

## Decision

Evaluate a skill change in two tiers, with different properties on purpose.

**Tier 1 — the skill contract.** `cesium-eval check skills` decides what can be
decided by reading the file: frontmatter shape, `name` matching the directory, a
description that keeps its `Use when ...` activation clause and stays within the
length limit, a title, code fences that parse as JavaScript, and referenced
CesiumJS symbols that exist in the ownership map. It also fails when a domain
skill documents none of the symbols it owns, and when live scenarios outlive the
skill they belong to.

It runs inside the deterministic gate, so it is part of the required check on
every pull request including forks, consumes no secrets, and costs milliseconds.
Its symbol registry fails closed below a count floor, because an under-parsed
registry would pass every skill silently.

**Tier 2 — the live lane.** For each changed skill that has scenarios, the edited
`SKILL.md` goes into the codegen prompt, the returned code renders in headless
Chromium, and `audit --no-judge` scores the fresh bundles. The visual judge stays
out of it, so a red in this lane is always mechanical.

The live lane is scoped to changed skills, refuses to run on a fork, and reports
a loud skip rather than a false green when its credential is absent.

## Consequences

- Every skill edit gets an immediate, free, deterministic answer, and fork
  contributors get real feedback rather than a lane that cannot run for them.
- The expensive lane runs only where the diff says it is warranted.
- A skill change merged from a fork has not been evaluated live. The skip is
  announced in the job summary, and a maintainer is expected to dispatch the lane
  before merging.
- Tier 2 does not catch every bad wording change. A strong codegen model follows
  the scenario prompt and often ignores a subtly wrong aside; what it reliably
  catches is wording that genuinely misdirects an agent — a wrong deprecation
  notice, a removed constraint, guidance contradicting the task. Tier 1 exists
  because its answers do not depend on a model's judgement.
- This extends rather than replaces [ADR-0005](ADR-0005-CI-Trigger-Policy): the
  cost-aware tiering stands, with the skill-change diff added as a trigger.
