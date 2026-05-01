#!/bin/bash
set -e

# Netlify build script for code-wiki
# Clones the private content repo and overlays:
#   - public-safe data files (index.json, taxonomy.json, category-*.json,
#     metrics/*.json) into public/data/ — served as static CDN assets.
#   - sensitive data files (*-full.json) into private-data/ — bundled with
#     functions but never served to the public CDN. Read by full-index.ts and
#     dashboard-data.ts via filesystem.
# Wiki content (repo-locations.md, personal docs, taxonomy sources) is overlaid
# into ../wiki/ as before.

if [ -n "$PRIVATE_CONTENT_TOKEN" ] && [ -n "$PRIVATE_CONTENT_REPO" ]; then
  echo ">>> Cloning private content repo..."
  git clone --depth 1 \
    "https://x-access-token:${PRIVATE_CONTENT_TOKEN}@github.com/${PRIVATE_CONTENT_REPO}.git" \
    /tmp/private-content 2>&1 | grep -v "x-access-token"

  echo ">>> Overlaying private content onto public tree..."

  # Overlay generated data files. Split into public-safe and sensitive sets
  # so *-full.json (full index, full taxonomy) does NOT land in public/data/.
  if [ -d /tmp/private-content/web/public/data ]; then
    mkdir -p public/data/metrics
    mkdir -p private-data

    # Sensitive files: anything matching *-full.json. Bundled with functions only.
    shopt -s nullglob
    for f in /tmp/private-content/web/public/data/*-full.json; do
      cp "$f" private-data/
      echo "  - Overlaid (private-data/): $(basename "$f")"
    done

    # Public-safe files: everything else under web/public/data/.
    # Use rsync to copy while excluding the *-full.json names we already moved.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude='*-full.json' /tmp/private-content/web/public/data/ public/data/
    else
      # Fallback: cp -r, then prune any *-full.json that snuck through.
      cp -r /tmp/private-content/web/public/data/* public/data/
      find public/data -maxdepth 2 -name '*-full.json' -type f -delete
    fi
    echo "  - Overlaid public/data/ (excluding *-full.json)"
    shopt -u nullglob
  fi

  # Overlay wiki content (repo-locations.md, personal docs, future taxonomy)
  if [ -d /tmp/private-content/wiki ]; then
    cp -r /tmp/private-content/wiki/* ../wiki/
    echo "  - Overlaid wiki/"
  fi

  # Belt-and-suspenders: scrub any *-full.json that may have been in the local
  # repo from a pre-fix deploy, so we never re-publish private data.
  find public/data -maxdepth 2 -name '*-full.json' -type f -delete 2>/dev/null || true

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
