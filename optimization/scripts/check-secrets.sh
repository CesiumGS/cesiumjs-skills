#!/usr/bin/env bash
# Pre-push secret scan for the feat/eval-and-optimization branch.
# Run before any push to a public remote.
#
# What this scans:
# - Mode 1: gitleaks against full git history across all refs
#   (--log-opts="--all"). Catches anything ever committed, including
#   the new commits being pushed.
# - Mode 2: project-specific regex patterns against tracked content
#   only, via `git grep`. Tracked content is exactly what `git push`
#   sends, so this is the right scope.
#
# What this does NOT scan:
# - Untracked or gitignored files in the working tree. A push never
#   includes them, and scanning them produced false positives from
#   local development artifacts (for example browser run bundles under
#   optimization/runs/ that may contain local traces or injected runtime tokens).
#
# The intent: keep the scan tightly scoped to what actually leaves the
# machine on push, so the same scanner can run unmodified from any
# worktree (the canonical eval worktree, the main worktree with local
# dev content present, or a fresh checkout).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# The report path is parameterized so CI can place it inside a directory it can
# upload, and so concurrent jobs on a shared runner pool cannot race on one
# fixed /tmp path.
: "${GITLEAKS_REPORT:=${RUNNER_TEMP:-/tmp}/gitleaks-history.json}"

# Scope: full history across all refs by default. CI narrows this to the pull
# request range on pull_request events, which keeps the check cheap and stops a
# rule-set update from red-lining every open pull request at once.
: "${GITLEAKS_LOG_OPTS:=--all}"

# gitleaks is invoked directly under `set -euo pipefail`, so an absent binary
# dies with a bare 127 that is indistinguishable from a real finding. On a
# multi-node pool where one node lacks it, that presents as flake tied to runner
# assignment. Exit 3 is distinct from 1 (a leak was found).
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[check-secrets] gitleaks is not on PATH. Install it (.github/actions/install-gitleaks) before running this script." >&2
  exit 3
fi

echo "[check-secrets] Mode 1/2: git history scan (gitleaks detect --log-opts=$GITLEAKS_LOG_OPTS)"
gitleaks detect --redact --log-opts="$GITLEAKS_LOG_OPTS" \
  --report-format json --report-path "$GITLEAKS_REPORT"

echo "[check-secrets] Mode 2/2: project-specific patterns on tracked content (git grep)"
PATTERNS=(
  "Cesium\.Ion\.defaultAccessToken\s*=\s*[\"'][a-zA-Z0-9._-]{40,}[\"']"
  "access_token=eyJ[a-zA-Z0-9._-]{40,}"
  "ACCESS_TOKEN=ey[A-Za-z0-9]"
  "/Users/[a-zA-Z]+/"
  "[a-zA-Z0-9._%+-]+@bentley\.com"
)

# git grep only searches tracked content. The pathspec :! excludes
# this script itself (it contains the patterns as string literals)
# and test files (which contain test fixtures for validating safety scanners).
HITS=0
for pattern in "${PATTERNS[@]}"; do
  matches="$(git grep -lE "$pattern" -- ':!optimization/scripts/check-secrets.sh' ':!optimization/tests/' 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    echo "[check-secrets] FAIL: pattern matched: $pattern"
    echo "$matches" | head -5
    HITS=$((HITS+1))
  fi
done

if [ "$HITS" -gt 0 ]; then
  echo "[check-secrets] $HITS pattern(s) matched. Aborting."
  exit 1
fi

echo "[check-secrets] OK — no secrets detected."
