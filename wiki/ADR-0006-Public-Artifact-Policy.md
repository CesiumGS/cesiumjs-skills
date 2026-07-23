# ADR-0006: Commit Public-Safe Evidence Only

## Context

Evaluation traces can include generated HTML, access tokens, local paths, prompts, console output, screenshots, and model metadata. Some of these artifacts are useful for debugging but unsafe to commit publicly without review.

The framework should be open and inspectable without leaking credentials or private context.

## Decision

Commit public-safe artifacts and ignore raw sensitive traces by default.

Committed artifacts may include scenario manifests, aggregate coverage reports, public status summaries, architecture docs, and other compact public-safe reports.

Generated traces and iteration artifacts should remain local or CI artifacts unless explicitly reviewed and sanitized. This includes generated candidate skill snapshots (`optimization/candidates/`), generated dashboard HTML (`optimization/dashboard/`), per-skill iteration output (`optimization/results/<skill>/<iteration>/`), and the `optimization/history/` archive. If a published dashboard or full iteration record is wanted, build or upload it as a CI artifact rather than committing it.

## Consequences

- The public repository stays safer and easier to review.
- Maintainers may need to regenerate raw traces locally for deep debugging.
- Secret scanning remains mandatory before publication.
- Reports should use relative paths and avoid private environment details.
