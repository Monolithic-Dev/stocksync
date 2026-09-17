#!/usr/bin/env bash
# Clean up a branch after it has been merged into main.
# Usage: scripts/finish-phase.sh phase-2-data-layer
set -euo pipefail

BRANCH_NAME="${1:-}"
if [ -z "$BRANCH_NAME" ]; then
  echo "Usage: $0 <branch-name>" >&2
  exit 1
fi

git checkout main
git pull --ff-only origin main
git branch -d "$BRANCH_NAME"
git push origin --delete "$BRANCH_NAME" 2>/dev/null || echo "Remote branch already gone — continuing."

echo "Cleaned up '$BRANCH_NAME'. main is up to date."
