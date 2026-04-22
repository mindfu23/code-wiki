#!/usr/bin/env bash
#
# Install optional git hooks for this repo.
#
# Usage:
#   bash scripts/install-hooks.sh
#
# Currently installs:
#   - pre-commit: runs scripts/check-public-hygiene.sh to catch absolute user
#     paths, visibility: private frontmatter, and likely tokens before they
#     land in the public repo.
#
# Safe to re-run; symlinks are replaced atomically.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "Error: $HOOKS_DIR does not exist — is this a git repository?" >&2
  exit 1
fi

ln -sf ../../scripts/check-public-hygiene.sh "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook -> scripts/check-public-hygiene.sh"
echo "Test it by running: git commit (hooks run automatically) or"
echo "                    bash scripts/check-public-hygiene.sh"
