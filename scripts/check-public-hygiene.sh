#!/usr/bin/env bash
#
# Public-repo hygiene checks. Prevents user-specific content from landing in
# the public code-wiki repo.
#
# Usage:
#   bash scripts/check-public-hygiene.sh
#
# Wire as a git pre-commit hook (optional):
#   ln -s ../../scripts/check-public-hygiene.sh .git/hooks/pre-commit
#
# Runs automatically in CI via .github/workflows/public-hygiene.yml.
#
# For actual secret scanning, also run a dedicated tool like gitleaks.

set -u

FAIL=0

run_check() {
  local label="$1"
  local pattern="$2"
  shift 2
  local matches
  matches=$(git grep -n -E "$pattern" -- "$@" || true)
  if [[ -n "$matches" ]]; then
    echo "FAIL: $label"
    echo "$matches" | sed 's/^/  /'
    echo
    FAIL=1
  else
    echo "OK:   $label"
  fi
}

echo "== Public-repo hygiene =="

# 1. Absolute user paths (macOS/Linux home dirs). HANDOFF docs are exempt
# because they document historical decisions including local paths by design.
run_check "no absolute user paths" \
  "/(Users|home)/[a-zA-Z0-9._-]+/" \
  ':!HANDOFF*.md' \
  ':!scripts/check-public-hygiene.sh'

# 2. visibility: private frontmatter — these docs belong in the private
# content repo. The term definition file is exempt (it defines the concept).
# repoLocationsGenerator.ts is exempt because it emits the marker as part
# of a template literal that produces frontmatter for a generated file.
run_check "no visibility: private frontmatter" \
  "^visibility:[[:space:]]*\"?private\"?[[:space:]]*$" \
  ':!wiki/_taxonomy/terms/private.md' \
  ':!mcp-server/src/utils/repoLocationsGenerator.ts'

# 3. Likely GitHub / OpenAI / long-hex tokens. Example files are exempt if
# they clearly use a placeholder (ghp_xxxxx). The hygiene script itself is
# exempt (it contains the regex).
run_check "no likely tokens" \
  "(ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,}|[A-Za-z_]+(SECRET|TOKEN|API_KEY|PRIVATE_KEY)=[A-Fa-f0-9]{40,})" \
  ':!scripts/check-public-hygiene.sh'

echo
if [[ $FAIL -eq 0 ]]; then
  echo "All hygiene checks passed."
  exit 0
else
  echo "Hygiene checks failed. Move personal/private content to the private content repo"
  echo "(see README 'Private Content Repo' section) or sanitize before committing."
  exit 1
fi
