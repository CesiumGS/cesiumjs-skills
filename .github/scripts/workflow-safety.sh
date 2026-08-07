#!/usr/bin/env bash
# Structural invariants for the workflow surface.
#
# This script deliberately lives OUTSIDE .github/workflows/, which is the tree it
# scans. That is what makes the rules safe: each rule contains its own pattern as
# a literal, and a scanner inside the scanned tree matches itself. Do not move
# this file into .github/workflows/.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

fail=0
note() { printf '::error file=%s,title=%s::%s\n' "$1" "$2" "$3"; fail=1; }

# Lines that merely talk about a command (comments, GitHub annotations) are not
# invocations. Filter them before matching so a remediation hint cannot red-line
# the gate that prints it.
#
# Order and anchoring both matter, and getting either wrong turns this whole
# script into a no-op:
#
#  1. Trailing comments are STRIPPED rather than used to drop the whole line.
#     An earlier version dropped any line containing "::notice" anywhere, so
#     `pull_request_target:  # ::notice legacy` was removed from the input and
#     sailed past rule 2 while remaining a fully functional trigger (the YAML
#     parser discards the comment). Every rule below was evadable that way.
#     The [^"'] class leaves a '#' inside a quoted string alone.
#  2. The annotation exemption is ANCHORED to lines that actually EMIT one via
#     echo or printf, so it covers a genuine remediation hint such as
#     `echo "::error::never use pull_request_target here"` and covers nothing
#     else.
code_lines() {
  sed -E 's/[[:space:]]+#[^"'"'"']*$//' "$1" \
    | grep -vE '^[[:space:]]*#' \
    | grep -vE '^[[:space:]]*(-[[:space:]]+)?(run:[[:space:]]*)?(echo|printf)[[:space:]].*::(error|warning|notice)'
}

workflows=()
while IFS= read -r f; do workflows+=("$f"); done < <(
  find .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort
)

# Rules 3, 4 and 5 are scoped BY PATH, so a rename silently deletes them. That is
# not hypothetical: the ordinary .yml -> .yaml normalization (which line 23's own
# glob already anticipates) moves the file out from under a hardcoded path, and
# the `[ -e "$f" ] || continue` guard these rules used to open with turned that
# into a clean pass with `[workflow-safety] OK` and exit 0.
#
# Resolve by STEM across both extensions, and fail closed when a blocking lane
# cannot be found at all.
blocking_workflows=()
pr_gate=""
for stem in pr-gate secret-scan; do
  hit=""
  for f in "${workflows[@]}"; do
    case "${f##*/}" in "$stem".yml | "$stem".yaml) hit="$f" ;; esac
  done
  if [ -z "$hit" ]; then
    note ".github/workflows/$stem.yml" "Blocking lane not found" \
      "Rules 3-5 are scoped to this file and would pass vacuously without it. If the lane was renamed, update the stem list in workflow-safety.sh in the same change."
  else
    blocking_workflows+=("$hit")
    [ "$stem" = pr-gate ] && pr_gate="$hit"
  fi
done

# RULE 1: only optimization-loop.yml may run a tracked-file-writing command.
# The list is exhaustive and includes `loop` and `all`: both call
# updatePublicStatus() into the tracked optimization/results/public-status.json
# with no --promote guard. gate.sh is scanned too, because it is the script the
# blocking lane actually executes.
writer_re='\boptimize[[:space:]]+(rebaseline|coverage|report|promote|loop|all)\b|--promote\b'
# Composite actions are included: they are executable steps that no linter covers
# (actionlint has no composite-action mode and parses an action.yml as a
# workflow), and .github/actions/*/action.yml is a sibling of the workflows this
# rule was written for. The glob is absorbed by the -e test below when empty.
for f in "${workflows[@]}" .github/scripts/gate.sh .github/actions/*/action.yml; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in optimization-loop.yml) continue ;; esac
  if code_lines "$f" | grep -qE "$writer_re"; then
    note "$f" "CI can grade itself" \
      "This file invokes a cesium-eval optimize subcommand that writes a tracked file (optimization/results/*.json or skills/**/SKILL.md). Only optimization-loop.yml, which is dispatch-only and approval-gated, may do that."
  fi
done

# RULE 2: pull_request_target is banned outright, with no allowlist.
for f in "${workflows[@]}"; do
  [ -e "$f" ] || continue
  if code_lines "$f" | grep -q 'pull_request_target'; then
    note "$f" "pull_request_target is banned" \
      "It runs base-repo code with base-repo secrets and a write token against a fork's head ref. Nothing in this pipeline needs it; use workflow_run instead."
  fi
done

# RULE 3: blocking lanes must not suppress failures.
for f in "${blocking_workflows[@]}"; do
  # The waiver filter must run BEFORE code_lines(), not after: code_lines strips
  # the trailing comment, so a waiver placed exactly where this rule's own
  # remediation text tells the author to put it would already be gone by the
  # time the filter looked for it, and the rule would red-line a workflow for
  # not doing the thing it had just done.
  #
  # It also must not move INSIDE code_lines(): that would exempt the annotated
  # line from all eight rules, letting `pull_request_target: # SAFETY-WAIVER: x`
  # through rule 2 and `runs-on: self-hosted # SAFETY-WAIVER: x` through rule 5.
  if code_lines <(grep -vE '#[[:space:]]*SAFETY-WAIVER:' "$f") | grep -qE 'continue-on-error|\|\|[[:space:]]*true'; then
    note "$f" "Error suppression in a blocking lane" \
      "Advisory-ness is expressed by a lane being non-required, never by suppressing an error. If a conditional pass is genuinely correct, annotate the line with '# SAFETY-WAIVER: <reason>' so the exemption is a reviewable diff."
  fi
done

# RULE 4: the blocking eval lane must consume no secrets. Secret-freedom is what
# makes this gate produce a real signal on a fork pull request.
# Fails closed: a missing gate is a violation, not an exemption.
if [ -z "$pr_gate" ] || code_lines "$pr_gate" | grep -qE 'secrets\.[A-Z_]+'; then
  note "${pr_gate:-.github/workflows/pr-gate.yml}" "Gate must stay secret-free" \
    "Move any secret-consuming step to the nightly lane."
fi

# RULE 5: no UNGUARDED self-hosted routing in a pull_request-reachable lane.
#
# The pool itself is allowed (hosted concurrency queues these lanes for an hour
# at a time), but only through the fork guard. What must stay impossible is a
# FORK pull request landing on a persistent shared node that also holds
# checkouts of write-capable workflows: RUNNER_LABELS is a repository variable,
# so without the guard a one-line variable edit silently opens that door with no
# diff anywhere in this tree.
#
# So the rule is a SHAPE check, not a ban. It matches the WHOLE expression
# against one canonical literal rather than looking for the guard as a substring,
# because presence of the guard text does not mean the guard PROTECTS anything:
#
#   fromJSON(vars.RUNNER_LABELS || (<fork test> && '["ubuntu-latest"]') || ...)
#
# contains every token a substring check would look for and still routes a fork
# straight to the pool, because `||` returns the FIRST truthy operand and
# RUNNER_LABELS is always truthy when set. Operand ORDER is the entire safety
# property here, and only whole-expression equality constrains order.
#
# The canonical form pins BOTH untrusted-code events to hosted:
#   - a pull request whose head repo is a fork
#   - every merge_group run, unconditionally, because that payload carries no
#     pull_request object, so the fork test is blind on the one event whose
#     merge commit already contains the contributor's code
#
# A bare `self-hosted` literal stays banned outright: it hardcodes the pool with
# no fork branch at all.
canonical_runs_on="runs-on: \${{ fromJSON((github.event_name == 'merge_group' || github.event.pull_request.head.repo.fork) && '[\"ubuntu-latest\"]' || vars.RUNNER_LABELS || '[\"ubuntu-latest\"]') }}"
for f in "${blocking_workflows[@]}"; do
  if code_lines "$f" | grep -qE '(^|[^_[:alnum:]])self-hosted'; then
    note "$f" "Hardcoded self-hosted runner in a blocking lane" \
      "A literal self-hosted label has no fork branch, so it routes fork pull requests onto the pool. Use the canonical fork-guarded expression from pr-gate.yml instead."
  fi
  # Leading indentation and runs of internal whitespace are normalised first, so
  # the comparison is about expression STRUCTURE and not YAML nesting depth.
  while IFS= read -r line; do
    [ "$line" = "$canonical_runs_on" ] && continue
    note "$f" "Non-canonical self-hosted routing in a blocking lane" \
      "A blocking lane may name RUNNER_LABELS only in the exact guarded form used by pr-gate.yml, because operand order decides whether a fork reaches the pool. Expected: $canonical_runs_on"
  done < <(code_lines "$f" | grep -F 'RUNNER_LABELS' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+/ /g')
done

# RULE 6: the threshold comes from eval.config.json and nowhere else, so
# changing it is a visible one-line diff under CODEOWNERS review.
for f in "${workflows[@]}"; do
  [ -e "$f" ] || continue
  if code_lines "$f" | grep -q -- '--threshold'; then
    note "$f" "Threshold override" \
      "--threshold in a workflow bypasses eval.config.json. Change it there instead."
  fi
done

# RULE 7: every job bounds its own runtime. A job without a timeout inherits 360
# minutes.
#
# Counting must be scoped to the `jobs:` mapping. A naive grep for two-space keys
# also matches the trigger keys under `on:` (pull_request, merge_group, push,
# schedule, workflow_dispatch, workflow_call), which inflates the job count and
# red-lines a perfectly correct workflow. The awk below enters on a column-zero
# `jobs:` line, leaves on the next column-zero key, and attributes four-space
# keys to the job heading that opened the block, so a step-level `uses:` or
# `timeout-minutes:` (six spaces or deeper) is never miscredited to its job.
#
# A job is satisfied by EITHER a job-level `timeout-minutes:` OR a job-level
# `uses:`. GitHub rejects `timeout-minutes` on a reusable-workflow call, so
# demanding one there would make a correct workflow unlintable; the called
# workflow's own jobs carry the bound and are checked when that file is scanned.
for f in "${workflows[@]}"; do
  [ -e "$f" ] || continue
  read -r n_jobs n_bounded <<EOF
$(awk '
  /^jobs:[[:space:]]*$/ { in_jobs=1; next }
  /^[^[:space:]#]/      { in_jobs=0 }
  in_jobs && /^  [A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*$/ { cur=$0; jobs++; next }
  in_jobs && cur != "" && /^    (timeout-minutes:[[:space:]]*[0-9]+|uses:[[:space:]]*[^[:space:]])/ {
    if (!counted[cur]++) bounded++
  }
  END { printf "%d %d\n", jobs+0, bounded+0 }
' "$f")
EOF
  if [ "$n_jobs" -gt 0 ] && [ "$n_bounded" -lt "$n_jobs" ]; then
    note "$f" "Missing timeout-minutes" \
      "Found $n_jobs job(s) but only $n_bounded with a job-level timeout-minutes (or a reusable-workflow uses:). Every job needs one, or it inherits the 360-minute default."
  fi
done

# RULE 8: PRD acceptance criterion 9, second half. Evaluation code must not
# depend on optimization (FR10).
if [ -d packages/eval/src/evaluation ]; then
  hits=$(grep -rnE '^[[:space:]]*import .* from ["'"'"'][^"'"'"']*optimization/' packages/eval/src/evaluation/ || true)
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits"
    note "packages/eval/src/evaluation" "Evaluation imports optimization" \
      "FR10: optimization code may depend on evaluation APIs; evaluation code must not depend on optimization."
  fi
fi

# RULE 9: the Copilot credential is an Environment secret, never a general
# repository secret available to an arbitrary job. Check at JOB scope: merely
# having one protected job elsewhere in the same file must not excuse an
# unprotected preflight or helper job that also references the token.
for f in "${workflows[@]}"; do
  [ -e "$f" ] || continue
  if ! code_lines "$f" | grep -q 'secrets\.COPILOT_GITHUB_TOKEN'; then
    continue
  fi

  if code_lines "$f" | grep -qE '^[[:space:]]{2}(pull_request|pull_request_target|merge_group):'; then
    note "$f" "Copilot secret reachable from untrusted code" \
      "A workflow that references COPILOT_GITHUB_TOKEN must not have a pull-request or merge-group trigger. Run credentialed evaluation only from trusted main-branch state."
  fi
  if ! code_lines "$f" | grep -q 'refs/heads/main'; then
    if code_lines "$f" | grep -qE '^[[:space:]]{2}workflow_run:'; then
      if ! code_lines "$f" | grep -qE 'workflows:[[:space:]]*\["PR Gate"\]'; then
        note "$f" "Privileged workflow_run has no trusted prerequisite" \
          "A Copilot workflow_run lane must be triggered only by the default-branch PR Gate workflow."
      fi
      if ! code_lines "$f" | grep -q 'ref:.*github\.event\.repository\.default_branch'; then
        note "$f" "Privileged workflow_run does not check out the default branch" \
          "The evaluator must come from the trusted default branch; the pull-request head is data, never executable code."
      fi
      if code_lines "$f" | grep -q 'ref:.*workflow_run\..*head'; then
        note "$f" "Privileged workflow_run checks out pull-request code" \
          "Never check out workflow_run.head_sha in a secret-bearing workflow; fetch bounded candidate documents as data instead."
      fi
    else
      note "$f" "Copilot workflow is not main-bound" \
        "A workflow that references COPILOT_GITHUB_TOKEN must run on refs/heads/main or through the base-controlled PR Gate workflow_run lane."
    fi
  fi

  while IFS='|' read -r job has_secret protected hosted readiness; do
    [ "$has_secret" = 1 ] || continue
    if [ "$protected" != 1 ]; then
      note "$f" "Copilot secret outside protected Environment" \
        "Job '$job' references COPILOT_GITHUB_TOKEN but does not declare job-level environment: copilot-inference."
    fi
    if [ "$hosted" != 1 ]; then
      note "$f" "Copilot secret on a non-ephemeral runner" \
        "Job '$job' references COPILOT_GITHUB_TOKEN but is not pinned to runs-on: ubuntu-latest."
    fi
    if [ "$readiness" != 1 ]; then
      note "$f" "Copilot environment lacks an explicit readiness guard" \
        "Job '$job' must remain skipped until COPILOT_INFERENCE_READY is true, so a workflow cannot auto-create an unprotected Environment."
    fi
  done < <(awk '
    function emit() {
      if (job != "") printf "%s|%d|%d|%d|%d\n", job, has_secret, protected, hosted, readiness
    }
    /^jobs:[[:space:]]*$/ { in_jobs=1; next }
    /^[^[:space:]#]/      { if (in_jobs) emit(); in_jobs=0; job="" }
    in_jobs && /^  [A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*$/ {
      emit()
      job=$0
      sub(/^[[:space:]]+/, "", job)
      sub(/:[[:space:]]*$/, "", job)
      has_secret=0
      protected=0
      hosted=0
      readiness=0
      next
    }
    in_jobs && job != "" && /secrets\.COPILOT_GITHUB_TOKEN/ { has_secret=1 }
    in_jobs && job != "" && /^    environment:[[:space:]]*copilot-inference[[:space:]]*$/ { protected=1 }
    in_jobs && job != "" && /^    runs-on:[[:space:]]*ubuntu-latest[[:space:]]*$/ { hosted=1 }
    in_jobs && job != "" && /COPILOT_INFERENCE_READY/ { readiness=1 }
    END { if (in_jobs) emit() }
  ' "$f")
done

if [ "$fail" -ne 0 ]; then
  printf '[workflow-safety] FAIL\n'
  exit 1
fi
printf '[workflow-safety] OK: all workflow invariants hold.\n'
