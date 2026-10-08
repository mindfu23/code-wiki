#!/usr/bin/env bash
#
# Install optional git hooks.
#
# Usage:
#   bash scripts/install-hooks.sh                         # this (public) repo
#   bash scripts/install-hooks.sh --private <repo-path>   # also the private content repo
#
# Installs:
#   - pre-commit in this repo: scripts/check-public-hygiene.sh (public profile)
#     — catches absolute user paths, visibility: private frontmatter, local
#     agent-memory internals and likely tokens.
#   - with --private: a pre-commit wrapper in the private content repo that runs
#     the same script with --profile private (memory internals + tokens).
#     The wrapper lives in that repo's .git/hooks, so it is never committed.
#
# Safe to re-run; existing hooks are replaced.

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
CHECKER="$REPO_ROOT/scripts/check-public-hygiene.sh"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "Error: $HOOKS_DIR does not exist — is this a git repository?" >&2
  exit 1
fi

ln -sf ../../scripts/check-public-hygiene.sh "$HOOKS_DIR/pre-commit"
echo "Installed pre-commit hook -> scripts/check-public-hygiene.sh"

if [[ "${1:-}" == "--private" ]]; then
  PRIVATE_REPO="${2:-}"
  if [[ -z "$PRIVATE_REPO" ]]; then
    echo "Error: --private needs the path to the private content repo" >&2
    exit 1
  fi
  PRIVATE_GIT_DIR="$(git -C "$PRIVATE_REPO" rev-parse --absolute-git-dir)"
  mkdir -p "$PRIVATE_GIT_DIR/hooks"
  HOOK="$PRIVATE_GIT_DIR/hooks/pre-commit"
  # Written to a temp file, then renamed, so a half-written hook never runs.
  TMP="$(mktemp "$PRIVATE_GIT_DIR/hooks/.pre-commit.XXXXXX")"
  cat > "$TMP" <<EOF
#!/usr/bin/env bash
# Installed by code-wiki scripts/install-hooks.sh --private. Not committed.
exec bash "$CHECKER" --profile private
EOF
  chmod +x "$TMP"
  mv "$TMP" "$HOOK"
  echo "Installed private-profile pre-commit hook in $PRIVATE_REPO"
fi

echo "Test it by running: git commit (hooks run automatically) or"
echo "                    bash scripts/check-public-hygiene.sh [--profile private]"
