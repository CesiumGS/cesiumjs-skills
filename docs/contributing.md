# Contributor Workflow

Changes should preserve three properties: focused skill context, exact domain ownership,
and evidence that the guidance works in a real CesiumJS environment.

## Before editing

1. Identify the owning domain in [Domain Mapping](domain-mapping.md).
2. Read the complete `SKILL.md` and any directly referenced files.
3. Search neighboring skills for related guidance and link across domains instead of
   duplicating ownership.
4. Decide whether the change needs a deterministic case, an optimization scenario, or a
   browser-backed visual check.

## Skill change workflow

<div class="workflow-strip">
  <div class="workflow-step"><strong>Scope</strong><span>Choose one owner and define the behavior being added or corrected.</span></div>
  <div class="workflow-step"><strong>Edit</strong><span>Keep critical guidance concise; move deep reference material beside the skill.</span></div>
  <div class="workflow-step"><strong>Exercise</strong><span>Add or update evidence that fails for the old behavior and passes for the new one.</span></div>
  <div class="workflow-step"><strong>Review</strong><span>Run public checks and inspect rendered output before requesting review.</span></div>
</div>

## Writing conventions

- Write descriptions around activation conditions: what task should cause the skill to load.
- Use imperative guidance and runnable examples rather than API inventories without context.
- Keep constructors, enums, and lifecycle rules in their owning domain.
- Call out performance tradeoffs, cleanup responsibilities, and asynchronous failure modes.
- Prefer progressive disclosure: compact `SKILL.md` guidance first, detailed references second.
- Do not include tokens, customer data, private URLs, local absolute paths, or private prompts.

## Required public checks

Run the repository's deterministic validation surface before opening a pull request:

```bash
pytest -q optimization/tests
pytest -q evaluation/tests
python3 evaluation/scripts/validate-evaluation.py
python3 optimization/scripts/validate-evals.py
python3 optimization/scripts/check-canonical-eval-surface.py
python3 optimization/scripts/check-public-artifacts.py
```

Scenario validation is read-only. If a reviewed scenario contract changes, rebaseline it
explicitly:

```bash
python3 optimization/scripts/rebaseline-scenario.py <skill> <eval-id>
```

## Documentation changes

The documentation site uses MkDocs Material and intentionally matches the CesiumJS AI
Starter App documentation. Preserve the shared Cesium palette, navigation behavior,
light/dark modes, favicon, illustration treatment, and concise page hierarchy.

Build docs in an isolated environment:

```bash
python3 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install \
  "mkdocs>=1.6,<2" \
  "mkdocs-material>=9.7,<10" \
  "mkdocs-include-markdown-plugin>=7,<8"
mkdocs build --strict
```

The generated `site/` directory is build output and should not be committed.

## Pull request checklist

- [ ] The owning skill and canonical domain map agree.
- [ ] Cross-domain references do not duplicate API ownership.
- [ ] Examples use supported CesiumJS patterns and clean up resources where appropriate.
- [ ] Evaluation or optimization evidence matches the behavioral risk.
- [ ] All public checks pass.
- [ ] Documentation links and a strict MkDocs build pass when docs changed.
- [ ] The diff contains no generated output, secrets, local paths, or unrelated changes.

Read the repository's
[architecture decisions](https://github.com/CesiumGS/cesiumjs-skills/tree/main/.architecture)
before changing evaluation boundaries or promotion policy.
