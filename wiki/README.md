# Contributing to the CesiumJS Skills Wiki

The CesiumJS Skills wiki is maintained in the `/wiki/` directory of the source repository. The GitHub wiki is generated from these files by GitHub Actions.

## Guidelines

1. Propose changes through pull requests to the source repository.
2. Use one Markdown file per wiki page.
3. Use hyphenated file names because GitHub wiki page names are derived from file names.
4. Keep public-facing content free of private tokens, private customer data, confidential planning links, local machine paths, and internal-only procedures.
5. Store reusable images under `/.assets/` if assets are needed. Reference them with `/.assets/<file>` in source Markdown; the workflow rewrites those paths for wiki rendering.
6. Update `_Sidebar.md` when adding or renaming pages.
7. Keep evaluation workflow pages aligned with the public `evals/` directory, not private planning material or local raw traces.

## Review Expectations

- Architecture documents should be reviewed for technical accuracy and public readability.
- ADRs should state context, decision, and consequences.
- Public wiki pages should avoid relying on private issue trackers or internal documents for comprehension.
