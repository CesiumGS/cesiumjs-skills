# ADR-0006: Commit Public-Safe Evidence Only

## Status

Accepted

## Context

Evaluation traces can include generated HTML, access tokens, local paths, prompts, console output, screenshots, and model metadata. Some of these artifacts are useful for debugging but unsafe to commit publicly without review.

The framework should be open and inspectable without leaking credentials or private context.

## Decision

Commit public-safe artifacts and ignore raw sensitive traces by default.

Committed artifacts may include scenario manifests, coverage reports, programmatic check summaries, judge verdict summaries, decision records, curated screenshots, and public-safe reports.

Raw generated traces should remain local or CI artifacts unless explicitly reviewed and sanitized.

## Consequences

- The public repository stays safer and easier to review.
- Maintainers may need to regenerate raw traces locally for deep debugging.
- Secret scanning remains mandatory before publication.
- Reports should use relative paths and avoid private environment details.
