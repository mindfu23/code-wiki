#!/bin/bash
set -e

# Netlify build script for code-wiki
# Clones the private content repo and overlays:
#   - public-safe data files (index.json, taxonomy.json,
#     category-*.json, metrics/*.json) into public/data/ — served as static
#     CDN assets. taxonomy.json is the public-filtered build output:
#     contentTags with visibility != public are stripped by taxonomyBuilder.
#   - sensitive data files (index-full.json, taxonomy-full.json) into
#     private-data/ — bundled with functions but never served to the
#     public CDN. Read by full-index.ts, full-taxonomy.ts, and
#     dashboard-data.ts via filesystem. taxonomy-full.json contains every
#     project entry including private repos and their dependsOn edges, so
#     it MUST be auth-gated.
# Wiki content (repo-locations.md, personal docs, taxonomy sources) is overlaid
# into ../wiki/ as before.

if [ -n "$PRIVATE_CONTENT_TOKEN" ] && [ -n "$PRIVATE_CONTENT_REPO" ]; then
  echo ">>> Cloning private content repo..."
  git clone --depth 1 \
    "https://x-access-token:${PRIVATE_CONTENT_TOKEN}@github.com/${PRIVATE_CONTENT_REPO}.git" \
    /tmp/private-content 2>&1 | grep -v "x-access-token"

  echo ">>> Overlaying private content onto public tree..."

  # Overlay generated data files. Sensitive files (currently just
  # index-full.json) go to private-data/ and are bundled with functions but
  # never published. Everything else goes to public/data/ as before.
  if [ -d /tmp/private-content/web/public/data ]; then
    mkdir -p public/data/metrics
    mkdir -p private-data

    SENSITIVE_FILES=("index-full.json" "taxonomy-full.json")

    # Move sensitive files to private-data/ first.
    for name in "${SENSITIVE_FILES[@]}"; do
      src="/tmp/private-content/web/public/data/$name"
      if [ -f "$src" ]; then
        cp "$src" "private-data/$name"
        echo "  - Overlaid (private-data/): $name"
      fi
    done

    # Copy everything else to public/data/. Build a find-based exclude list
    # so the rsync/cp respects the SENSITIVE_FILES allowlist above.
    if command -v rsync >/dev/null 2>&1; then
      EXCLUDES=()
      for name in "${SENSITIVE_FILES[@]}"; do
        EXCLUDES+=(--exclude="$name")
      done
      rsync -a "${EXCLUDES[@]}" /tmp/private-content/web/public/data/ public/data/
    else
      cp -r /tmp/private-content/web/public/data/* public/data/
      for name in "${SENSITIVE_FILES[@]}"; do
        find public/data -maxdepth 2 -name "$name" -type f -delete
      done
    fi
    echo "  - Overlaid public/data/ (sensitive files excluded)"
  fi

  # Overlay wiki content (repo-locations.md, personal docs, future taxonomy)
  if [ -d /tmp/private-content/wiki ]; then
    cp -r /tmp/private-content/wiki/* ../wiki/
    echo "  - Overlaid wiki/"
  fi

  # Belt-and-suspenders: scrub any sensitive file that may have been in the
  # local repo from a pre-fix deploy, so we never re-publish private data.
  for name in "${SENSITIVE_FILES[@]}"; do
    find public/data -maxdepth 2 -name "$name" -type f -delete 2>/dev/null || true
  done

  # Clean up — don't leave token-bearing clone around
  rm -rf /tmp/private-content
  echo ">>> Private content overlay complete."
else
  echo ">>> No PRIVATE_CONTENT_TOKEN/PRIVATE_CONTENT_REPO set — skipping overlay."
  echo "    (This is normal for forks without a private content repo.)"
fi

# Run the standard build
echo ">>> Running npm install..."
npm install

echo ">>> Building functions..."
npm run build:functions
