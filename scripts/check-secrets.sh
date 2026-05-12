#!/usr/bin/env bash
# Pre-push secret scan for the eval-and-optimization branch.
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
#   local development artifacts (e.g., locally-generated eval traces
#   under tuning/<skill>/iterations/<n>/traces/, which are gitignored
#   on this branch and may contain old, rotated tokens that were
#   left on disk after token rotation).
#
# The intent: keep the scan tightly scoped to what actually leaves the
# machine on push, so the same scanner can run unmodified from any
# worktree (the canonical eval worktree, the main worktree with local
# dev content present, or a fresh checkout).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "[check-secrets] Mode 1/2: git history scan across all refs (gitleaks detect --log-opts=--all)"
gitleaks detect --redact --log-opts="--all" --report-format json --report-path /tmp/gitleaks-history.json

echo "[check-secrets] Mode 2/2: project-specific patterns on tracked content (git grep)"
PATTERNS=(
  "Cesium\.Ion\.defaultAccessToken\s*=\s*[\"'][a-zA-Z0-9._-]{40,}[\"']"
  "access_token=eyJ[a-zA-Z0-9._-]{40,}"
  "ACCESS_TOKEN=ey[A-Za-z0-9]"
  "/Users/[a-zA-Z]+/"
  "[a-zA-Z0-9._%+-]+@bentley\.com"
)

# git grep only searches tracked content. The pathspec :! excludes
# this script itself (it contains the patterns as string literals).
HITS=0
for pattern in "${PATTERNS[@]}"; do
  matches="$(git grep -lE "$pattern" -- ':!scripts/check-secrets.sh' 2>/dev/null || true)"
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
