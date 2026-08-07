# Configure the Required Skill Eval Gate

The workflow files define the check, but GitHub repository settings decide
whether it can receive a credential and whether a red result blocks merge.
Complete these steps with repository Admin access, in order.

## 1. Land the trusted workflow

Merge `pr-skill-eval-gate.yml` into the default branch before making its Check
Run required. A `workflow_run` workflow is loaded only from the default branch,
so it cannot evaluate the pull request that introduces itself.

## 2. Protect the Environment

Create the repository Environment `copilot-inference` with:

- deployment branch: `main` only;
- at least one required reviewer;
- administrator bypass disabled where the repository plan supports it;
- `prevent_self_review` chosen deliberately (leave it off if the sole operator
  must approve their own explicitly dispatched evaluation).

Do not let a workflow auto-create the Environment. An implicitly created
Environment has no reviewers, branch policy, or secrets.

## 3. Install the least-privilege secret

Add `COPILOT_GITHUB_TOKEN` as an Environment secret. It should be a fine-grained
GitHub token with only the read-only `Copilot Requests` account permission and
read-only public-repository access. GitHub does not reveal a secret again after
it is saved.

After the Environment protections and secret have both been verified, create
the repository Actions variable:

```text
COPILOT_INFERENCE_READY=true
```

Credentialed jobs remain skipped until this exact readiness flag is present.
That guard prevents the workflow from auto-creating an unprotected Environment.

## 4. Require the checks on `main`

Create a branch ruleset for the default branch and require these status checks:

- `gate`
- `secret-scan`
- `Skill Eval Gate`

Enable strict status checks so a branch must be current with `main`. Requiring
`Skill Eval Gate` is what converts the explicit Check Run written to the pull
request head into a merge gate. For a non-skill pull request it completes
successfully without spending a model request; for a scenario-backed skill
change it completes only after protected codegen, secret-free rendering, and a
passing deterministic scorecard.

## 5. Verify with both polarities

Open one harmless skill pull request and confirm all three required checks pass.
Then use a disposable branch to introduce a known deterministic failure and
confirm `Skill Eval Gate` turns red and GitHub refuses the merge. Remove the
disposable branch after recording the proof.
