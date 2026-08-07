#!/usr/bin/env bash
# The deterministic evaluation gate: the complete blocking check surface.
#
# Runs identically locally (`npm run gate`) and in CI. Every command here is
# hermetic: no network, no browser, no LLM, no secrets. Total measured compute
# is roughly 3 seconds; the wall clock is dominated by `npm ci`, which is the
# caller's job, not this script's.
#
# Exit codes are the CLI's three-state contract and are never collapsed:
#   0 = pass
#   1 = evaluation regression
#   2 = usage error, malformed input, or schema violation (a pipeline bug)
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

CESIUM_EVAL=(node packages/eval/bin/cesium-eval.js)
SCORECARD_DIR="${SCORECARD_DIR:-$repo_root/evaluation/artifacts/scorecards/gate}"

# GitHub workflow commands only when GitHub is listening; plain text locally.
annotate() { # annotate <level> <title> <message>
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    printf '::%s title=%s::%s\n' "$1" "$2" "$3"
  else
    printf '[gate] %s: %s: %s\n' "$1" "$2" "$3"
  fi
}

fail() { annotate error "$1" "$2"; exit "${3:-1}"; }

step() { printf '\n[gate] === %s ===\n' "$1"; }

# --- build ------------------------------------------------------------------
# bin/cesium-eval.js dispatches to dist/cli/main.js, and dist/ is gitignored, so
# the build is a hard prerequisite of every cesium-eval invocation below.
step "build eval CLI"
npm run build --workspace @cesiumjs-skills/eval \
  || fail "Build failed" "The eval CLI did not compile." 1
[ -f packages/eval/dist/cli/main.js ] \
  || fail "Missing CLI entrypoint" "packages/eval/dist/cli/main.js was not emitted." 1

# --- manifests --------------------------------------------------------------
# Two separate invocations rather than --suite all, so a failure names its lane.
step "validate evaluation manifests"
"${CESIUM_EVAL[@]}" validate --suite evaluation || fail \
  "Evaluation manifest validation failed" \
  "A case or fixture under evaluation/ violates its schema, naming convention, or the probe contract. See the log above." 1

step "validate optimization scenario manifests"
"${CESIUM_EVAL[@]}" validate --suite optimization || fail \
  "Scenario manifest drift" \
  "A tracked scenario manifest changed without rebaselining, or optimization/results/public-status.json counts disagree with the manifests. The validator printed the exact remediation command above; run it locally and commit the result. Never run it in CI." 1

# --- unit tests -------------------------------------------------------------
step "unit tests (eval CLI)"
npm test --workspace @cesiumjs-skills/eval \
  || fail "Unit tests failed" "See the vitest output above." 1

# --- scorecard, positive lane ----------------------------------------------
step "score deterministic fixtures (positive lane)"
"${CESIUM_EVAL[@]}" score --fixture-expectation pass --output-dir "$SCORECARD_DIR"
score_code=$?
case "$score_code" in
  0) annotate notice "Scorecard" "deterministic scorecard passed" ;;
  1) fail "Evaluation regression" \
       "The deterministic scorecard is below threshold or has critical failures. Download the 'scorecard' artifact and read scorecard.md." 1 ;;
  2) fail "Pipeline bug, not an eval regression" \
       "score exited 2 (usage error, malformed --visual-review, or a scorecard that failed its own schema). score writes the scorecard before validating it, so the artifact exists and explains the failure." 2 ;;
  *) fail "Unexpected exit $score_code" "outside the documented 0/1/2 contract" "$score_code" ;;
esac

# --- scorecard, expectation assertion ---------------------------------------
# The step that makes the gate two-directional. Without it, a matcher that
# degrades to always-pass ships green: the positive lane stays at 100% and
# validate stays green.
#
# Deliberately unconditional rather than probed at runtime: a gate that silently
# skips a check when its command is missing is the same class of theater this
# gate exists to remove, and `cesium-eval <unknown> --help` exits 0 anyway, so a
# --help probe cannot detect absence.
step "verify fixture expectations (both polarities)"
"${CESIUM_EVAL[@]}" verify-fixtures --output "$SCORECARD_DIR/fixture-verification.json"
vf_code=$?
case "$vf_code" in
  0) ;;
  1) fail "Evaluator regression" \
       "At least one fixture did not produce its declared expected_result. A matcher has stopped detecting the defect its negative fixture encodes." 1 ;;
  *) fail "Fixture verification could not run" \
       "verify-fixtures exited $vf_code (usage error, an orphan fixture, or a result that failed result.schema.json)." 2 ;;
esac

# --- repository hygiene -----------------------------------------------------
step "check canonical eval surface"
"${CESIUM_EVAL[@]}" check canonical-surface || fail \
  "Canonical surface violation" "See the per-failure list above." 1

step "scan tracked public surface"
"${CESIUM_EVAL[@]}" check public-artifacts || fail \
  "Public-artifact scan matched" "A tracked file under a scanned root contains a private or unsafe reference." 1

# --- structural guarantee ---------------------------------------------------
# Six cesium-eval optimize subcommands write tracked files. None may ever appear
# in this lane. This is the cheap mechanical proof that no gate step graded
# itself, and the backstop if workflow-safety.sh is ever bypassed. Skipped
# locally, where a dirty working tree is normal and expected.
if [ "${CI:-}" = "true" ]; then
  step "assert working tree unchanged"
  if [ -n "$(git status --porcelain)" ]; then
    git status --porcelain
    git --no-pager diff
    fail "CI mutated the working tree" \
      "A gate step wrote to a tracked or untracked path. The deterministic lane is read-only by contract." 1
  fi
fi

printf '\n[gate] OK: all deterministic checks passed.\n'
