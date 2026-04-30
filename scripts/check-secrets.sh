#!/usr/bin/env bash
# Two-mode secret scan for the eval branch.
# Run before any push to a public remote AND before the first commit.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "[check-secrets] Mode 1/2: git history scan across all refs (gitleaks detect --log-opts=--all)"
gitleaks detect --redact --log-opts="--all" --report-format json --report-path /tmp/gitleaks-history.json

echo "[check-secrets] Mode 2/2: working-tree scan (gitleaks --no-git, includes untracked + ignored)"
gitleaks detect --no-git --redact --source . --report-format json --report-path /tmp/gitleaks-tree.json

echo "[check-secrets] Project-specific patterns"
PATTERNS=(
  "Cesium\.Ion\.defaultAccessToken\s*=\s*[\"'][a-zA-Z0-9._-]{40,}[\"']"
  "access_token=eyJ[a-zA-Z0-9._-]{40,}"
  "ACCESS_TOKEN=ey[A-Za-z0-9]"
  "/Users/[a-zA-Z]+/"
  "[a-zA-Z0-9._%+-]+@bentley\.com"
)

# Excludes for the project-specific grep:
# - .git as a FILE (linked worktrees have a .git pointer file containing an absolute /Users/... path)
# - scripts/check-secrets.sh (it contains the patterns themselves)
# - .git and node_modules as directories
EXCLUDE_FILES="--exclude=.git --exclude=check-secrets.sh"
EXCLUDE_DIRS="--exclude-dir=.git --exclude-dir=node_modules"

HITS=0
for pattern in "${PATTERNS[@]}"; do
  matches="$(grep -rE $EXCLUDE_DIRS $EXCLUDE_FILES "$pattern" . 2>/dev/null || true)"
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
