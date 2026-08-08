#!/usr/bin/env bash
# Print the skill ids a range of commits touched, one per line.
#
#   changed-skills.sh <base-ref> <head-ref>
#
# A skill is "touched" when any file under skills/<id>/ changed. The unit is the
# DIRECTORY, not SKILL.md, because a skill's reference files are part of what an
# agent reads; a wording change in one of them is the same kind of change.
#
# Two filters, and both exist to stop the live lane from failing for a reason
# that is not an evaluation result:
#
#   * the skill must still have a skills/<id>/SKILL.md. A pull request that
#     deletes or renames a skill would otherwise name a directory nothing can
#     render, and the run would read as a regression rather than the deletion it
#     is. (The rename itself is caught by `cesium-eval check skills`, whose
#     scenario-coverage rule fails when scenarios outlive their skill.)
#
#   * the skill must have optimization/scenarios/<id>/. That directory IS the
#     live lane's work list; a skill without one — the orientation skill, or a
#     newly added domain whose scenarios have not landed yet — has nothing to
#     render, and `render-baselines` rejects it as a usage error. Such a skill is
#     still fully covered by the hermetic contract in the gate.
#
# Exit codes:
#   0  the diff was computed (an empty result is a normal, common answer)
#   2  usage error, or the range could not be resolved
set -uo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: changed-skills.sh <base-ref> <head-ref>" >&2
  exit 2
fi

base="$1"
head="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root" || exit 2

for ref in "$base" "$head"; do
  if ! git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
    echo "changed-skills: cannot resolve '$ref'. Check out with fetch-depth: 0." >&2
    exit 2
  fi
done

# Two dots, not three. `A...B` diffs against the merge base, which silently
# ignores a skill edit that arrived on the base branch after this branch forked
# — exactly the case where the skill's behaviour under the merged result is
# unknown. The caller passes the base commit it wants compared.
if ! changed=$(git diff --name-only "$base" "$head" -- 'skills/'); then
  echo "changed-skills: git diff failed for $base..$head" >&2
  exit 2
fi

printf '%s\n' "$changed" \
  | awk -F/ 'NF >= 2 && $1 == "skills" && $2 != "" { print $2 }' \
  | sort -u \
  | while IFS= read -r skill; do
      [ -n "$skill" ] || continue
      [ -f "skills/$skill/SKILL.md" ] || continue
      if [ ! -d "optimization/scenarios/$skill" ]; then
        echo "changed-skills: '$skill' changed but has no optimization/scenarios/$skill; the live lane has nothing to render for it." >&2
        continue
      fi
      printf '%s\n' "$skill"
    done
