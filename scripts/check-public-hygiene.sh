#!/usr/bin/env bash
#
# Repo hygiene checks. Prevents user-specific content from landing in a repo.
#
# Usage:
#   bash scripts/check-public-hygiene.sh                    # public profile (default)
#   bash scripts/check-public-hygiene.sh --profile private  # private content repo
#
# Profiles:
#   public  — blocks absolute user paths, `visibility: private` frontmatter, local
#             agent-memory internals, likely tokens.
#   private — blocks local agent-memory internals and likely tokens. Absolute
#             paths are only reported: the private content repo's generated
#             indexes carry local paths by design.
#
# Extra, user-specific patterns (your username, private project names, ...) are
# read from an UNTRACKED file so the patterns themselves never get committed:
#   $HYGIENE_EXTRA_PATTERNS_FILE, default <git-dir>/info/hygiene-patterns
# One extended regex per line; blank lines and lines starting with # are ignored.
# The file is optional; CI runs without it.
#
# Wire as a git pre-commit hook via scripts/install-hooks.sh.
# Runs automatically in CI via .github/workflows/public-hygiene.yml.
#
# For actual secret scanning, also run a dedicated tool like gitleaks.

set -u

PROFILE="public"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ "$PROFILE" != "public" && "$PROFILE" != "private" ]]; then
  echo "Unknown profile: $PROFILE (expected public or private)" >&2
  exit 2
fi

FAIL=0
SELF=':!scripts/check-public-hygiene.sh'

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

report_count() {
  local label="$1"
  local pattern="$2"
  shift 2
  local n
  n=$(git grep -c -E "$pattern" -- "$@" | awk -F: '{s+=$NF} END {print s+0}')
  echo "INFO: $label: $n line(s)"
}

echo "== Repo hygiene (profile: $PROFILE) =="

# 1. Absolute user paths (macOS/Linux home dirs).
USER_PATH='/(Users|home)/[a-zA-Z0-9._-]+/'
if [[ "$PROFILE" == "public" ]]; then
  run_check "no absolute user paths" "$USER_PATH" "$SELF"
else
  report_count "absolute user paths (allowed in private generated indexes)" "$USER_PATH" "$SELF"
fi

# 2. visibility: private frontmatter — these docs belong in the private
# content repo. The term definition file is exempt (it defines the concept).
# repoLocationsGenerator.ts is exempt because it emits the marker as part
# of a template literal that produces frontmatter for a generated file.
if [[ "$PROFILE" == "public" ]]; then
  run_check "no visibility: private frontmatter" \
    "^visibility:[[:space:]]*\"?private\"?[[:space:]]*$" \
    ':!wiki/_taxonomy/terms/private.md' \
    ':!mcp-server/src/utils/repoLocationsGenerator.ts'
fi

# 3. Local agent-memory internals: per-user agent state directories, memory
# topic-file references and memory frontmatter. These stay on the local
# machine and belong in neither the public nor the private repo.
run_check "no local agent-memory internals" \
  '\.claude/projects/|originSessionId|node_type:[[:space:]]*memory|/memory/[A-Za-z0-9_-]+\.md' \
  "$SELF"

# 4. Likely GitHub / OpenAI / long-hex tokens. Example files are exempt if
# they clearly use a placeholder (ghp_xxxxx).
run_check "no likely tokens" \
  "(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,}|[A-Za-z_]+(SECRET|TOKEN|API_KEY|PRIVATE_KEY)=[A-Fa-f0-9]{40,})" \
  "$SELF"

# 5. Untracked, user-specific patterns.
GIT_DIR=$(git rev-parse --git-dir)
EXTRA="${HYGIENE_EXTRA_PATTERNS_FILE:-$GIT_DIR/info/hygiene-patterns}"
if [[ -f "$EXTRA" ]]; then
  n=0
  while IFS= read -r pat || [[ -n "$pat" ]]; do
    [[ -z "${pat// }" || "$pat" == \#* ]] && continue
    n=$((n + 1))
    # Label by number, not by pattern, so output never echoes the private pattern.
    run_check "extra pattern #$n" "$pat" "$SELF"
  done < "$EXTRA"
  [[ $n -eq 0 ]] && echo "INFO: extra patterns file is empty"
else
  echo "INFO: no extra patterns file (optional)"
fi

echo
if [[ $FAIL -eq 0 ]]; then
  echo "All hygiene checks passed."
  exit 0
else
  echo "Hygiene checks failed. Move personal/private content out of this repo"
  echo "(see README 'Private Content Repo' section) or sanitize before committing."
  exit 1
fi
