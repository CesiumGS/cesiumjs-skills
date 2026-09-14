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
GATE_STATUS="$SCORECARD_DIR/gate-status.tsv"
GATE_SUMMARY="$SCORECARD_DIR/summary.md"
SKILL_REPORT="$SCORECARD_DIR/skill-contract.json"
mkdir -p "$SCORECARD_DIR"
: > "$GATE_STATUS"

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

record_stage() { # record_stage <id> <status> <seconds> <detail>
  local detail="$4"
  detail="${detail//$'\t'/ }"
  detail="${detail//$'\n'/ }"
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$detail" >> "$GATE_STATUS"
}

run_stage() { # run_stage <id> <label> <command...>
  local id="$1" label="$2" started finished code status
  shift 2
  step "$label"
  started="$(date +%s)"
  "$@"
  code=$?
  finished="$(date +%s)"
  case "$code" in
    0) status="pass" ;;
    1) status="fail" ;;
    *) status="error" ;;
  esac
  record_stage "$id" "$status" "$((finished - started))" "$([ "$code" -eq 0 ] && printf 'Completed' || printf 'Exited with code %s' "$code")"
  return "$code"
}

build_eval_cli() {
  npm run build --workspace @cesiumjs-skills/eval || return 1
  [ -f packages/eval/dist/cli/main.js ]
}

assert_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    git status --porcelain
    git --no-pager diff
    return 1
  fi
}

# Always produce the compact Markdown summary, including fail-fast paths that
# stop before the evaluation scorecard exists. A renderer defect turns an
# otherwise-green gate red; on an already-red gate the original exit code wins.
summarize_on_exit() {
  local gate_code=$? summary_code=0
  trap - EXIT
  node .github/scripts/render-gate-summary.mjs \
    --status "$GATE_STATUS" \
    --skills "$SKILL_REPORT" \
    --scorecard "$SCORECARD_DIR/scorecard.json" \
    --fixtures "$SCORECARD_DIR/fixture-verification.json" \
    --output "$GATE_SUMMARY" \
    --exit-code "$gate_code" || summary_code=$?
  if [ "$summary_code" -ne 0 ]; then
    annotate error "Scorecard summary failed" "render-gate-summary.mjs exited $summary_code"
    [ "$gate_code" -ne 0 ] || gate_code=1
  else
    printf '[gate] summary: %s\n' "$GATE_SUMMARY"
  fi
  exit "$gate_code"
}
trap summarize_on_exit EXIT

# --- build ------------------------------------------------------------------
# bin/cesium-eval.js dispatches to dist/cli/main.js, and dist/ is gitignored, so
# the build is a hard prerequisite of every cesium-eval invocation below.
run_stage "build" "build eval CLI" build_eval_cli
build_code=$?
[ "$build_code" -eq 0 ] || fail "Build failed" "The eval CLI did not compile or did not emit packages/eval/dist/cli/main.js." 1

# --- manifests --------------------------------------------------------------
# Two separate invocations rather than --suite all, so a failure names its lane.
run_stage "validate-evaluation" "validate evaluation manifests" "${CESIUM_EVAL[@]}" validate --suite evaluation
evaluation_code=$?
[ "$evaluation_code" -eq 0 ] || fail \
  "Evaluation manifest validation failed" \
  "A case or fixture under evaluation/ violates its schema, naming convention, or the probe contract. See the log above." 1

run_stage "validate-optimization" "validate optimization scenario manifests" "${CESIUM_EVAL[@]}" validate --suite optimization
optimization_code=$?
[ "$optimization_code" -eq 0 ] || fail \
  "Scenario manifest drift" \
  "A tracked scenario manifest changed without rebaselining, or optimization/results/public-status.json counts disagree with the manifests. The validator printed the exact remediation command above; run it locally and commit the result. Never run it in CI." 1

# --- skill contract ---------------------------------------------------------
# The only step in this gate that reads skills/<id>/SKILL.md. Without it, a pull
# request that rewrites a skill is indistinguishable from one that changes
# nothing: every other step here grades fixtures, manifests or the repository
# layout, so the gate went green because it was never looking at the thing the
# change touched.
#
# Unscoped by design. Checking all fifteen skills is milliseconds, and a
# --skills filter derived from the diff would mean a rename that orphans a
# scenario is missed precisely when it is introduced.
#
# The semantic half of the question — does the edited wording still make an
# agent produce working code — is not decidable here. The base-controlled
# pr-skill-eval-gate.yml workflow_run lane answers it with protected codegen and
# secret-free rendering; skill-eval.yml repeats it post-merge. This first-stage
# pull-request lane remains credential-free.
run_stage "skill-contract" "check the skill contract" "${CESIUM_EVAL[@]}" check skills --output "$SKILL_REPORT"
skills_code=$?
case "$skills_code" in
  0) ;;
  1) fail "Skill contract violation" \
       "A skill file broke its contract: frontmatter, activation clause, code-fence syntax, or a CesiumJS symbol that does not exist. Each violation is annotated on its file above." 1 ;;
  *) fail "Skill contract could not be checked" \
       "check skills exited $skills_code (bad --skills, missing skills root, or an unreadable/under-parsed wiki/Domain-Mapping.md). This is a pipeline bug, not a skill regression." 2 ;;
esac

# --- unit tests -------------------------------------------------------------
run_stage "unit-tests" "unit tests (eval CLI)" npm test --workspace @cesiumjs-skills/eval
tests_code=$?
[ "$tests_code" -eq 0 ] || fail "Unit tests failed" "See the vitest output above." 1

# --- scorecard, positive lane ----------------------------------------------
run_stage "score" "score deterministic fixtures (positive lane)" \
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
run_stage "verify-fixtures" "verify fixture expectations (both polarities)" \
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
run_stage "canonical-surface" "check canonical eval surface" "${CESIUM_EVAL[@]}" check canonical-surface
canonical_code=$?
[ "$canonical_code" -eq 0 ] || fail "Canonical surface violation" "See the per-failure list above." 1

run_stage "public-artifacts" "scan tracked public surface" "${CESIUM_EVAL[@]}" check public-artifacts
public_code=$?
[ "$public_code" -eq 0 ] || fail \
  "Public-artifact scan matched" "A tracked file under a scanned root contains a private or unsafe reference." 1

# --- structural guarantee ---------------------------------------------------
# Six cesium-eval optimize subcommands write tracked files. None may ever appear
# in this lane. This is the cheap mechanical proof that no gate step graded
# itself, and the backstop if workflow-safety.sh is ever bypassed. Skipped
# locally, where a dirty working tree is normal and expected.
if [ "${CI:-}" = "true" ]; then
  run_stage "working-tree" "assert working tree unchanged" assert_clean_worktree
  tree_code=$?
  if [ "$tree_code" -ne 0 ]; then
    fail "CI mutated the working tree" \
      "A gate step wrote to a tracked or untracked path. The deterministic lane is read-only by contract." 1
  fi
else
  record_stage "working-tree" "skipped" 0 "CI-only assertion"
fi

printf '\n[gate] OK: all deterministic checks passed.\n'
