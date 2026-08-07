# ADR-0007: Evaluate Skill Changes Across Three Trust Tiers

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

Evaluate a skill change in three tiers, with different properties on purpose.

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

**Tier 2 — base-controlled pre-merge live evaluation.** For a changed skill
that has trusted scenarios, `pr-skill-eval-gate.yml` runs after PR Gate via
`workflow_run`. GitHub therefore loads the workflow and evaluator from the
default branch, not the pull request. The candidate SKILL.md and bounded text
support files are fetched as data. A protected GitHub-hosted job gives that data
to Copilot with tools disabled and writes generated JavaScript; it does not
execute the result. A second GitHub-hosted job receives no secrets, executes
the generated code in Chromium, and applies `audit --no-judge`. A Check Run
named `Skill Eval Gate` is written to the pull-request head.

This split is load-bearing. Candidate prompt text can influence model output,
so the process holding `COPILOT_GITHUB_TOKEN` must not give the model filesystem
or shell tools and must not execute the output. Conversely, the browser job may
execute hostile generated JavaScript only because it is ephemeral and receives
no Copilot, Ion, repository, or OIDC credential.

**Tier 3 — post-merge live evidence.** `skill-eval.yml` repeats the live path
after code reaches `main`, or through explicit main-branch dispatch. It is
advisory drift detection, not the merge decision.

## Consequences

- Every skill edit gets an immediate, free, deterministic answer, and fork
  contributors get real feedback rather than a lane that cannot run for them.
- The expensive pre-merge tier runs only for changed skills with trusted
  scenarios and requires an approved Environment release.
- Supporting/reference files ship in the candidate prompt bundle, so a change
  outside SKILL.md cannot inherit a false green from the old entrypoint text.
- A skill without trusted scenarios remains contract-only. New scenarios must
  first become trusted evaluator data; a pull request cannot weaken or invent
  the checks used to grade itself.
- The ruleset, not workflow prose, makes `Skill Eval Gate` merge-blocking.
- Tier 2 does not catch every bad wording change. A strong codegen model follows
  the scenario prompt and often ignores a subtly wrong aside; what it reliably
  catches is wording that genuinely misdirects an agent — a wrong deprecation
  notice, a removed constraint, guidance contradicting the task. Tier 1 exists
  because its answers do not depend on a model's judgement.
- This extends rather than replaces [ADR-0005](ADR-0005-CI-Trigger-Policy): the
  cost-aware tiering stands, with the skill-change diff added as a trigger.
