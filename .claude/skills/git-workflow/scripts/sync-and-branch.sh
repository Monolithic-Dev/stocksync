#!/usr/bin/env bash
# Safely sync main and cut a new branch from it.
# Usage: scripts/sync-and-branch.sh phase-2-data-layer
set -euo pipefail

BRANCH_NAME="${1:-}"
if [ -z "$BRANCH_NAME" ]; then
  echo "Usage: $0 <branch-name>" >&2
  exit 1
fi

git checkout main

if ! git pull --ff-only origin main; then
  echo "ERROR: local main has diverged from origin/main. Stopping." >&2
  echo "Investigate before branching — do not force past this." >&2
  exit 1
fi

git checkout -b "$BRANCH_NAME"
echo "Created '$BRANCH_NAME' from up-to-date main."
