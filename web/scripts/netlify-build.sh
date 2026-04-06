#!/bin/bash
set -e

# Netlify build script for code-wiki
# Clones the private content repo and overlays it onto the public tree
# before running the standard build. See HANDOFF-rearchitecture.md.

if [ -n "$PRIVATE_CONTENT_TOKEN" ] && [ -n "$PRIVATE_CONTENT_REPO" ]; then
  echo ">>> Cloning private content repo..."
  git clone --depth 1 \
    "https://x-access-token:${PRIVATE_CONTENT_TOKEN}@github.com/${PRIVATE_CONTENT_REPO}.git" \
    /tmp/private-content 2>&1 | grep -v "x-access-token"

  echo ">>> Overlaying private content onto public tree..."

  # Overlay generated data files (index, categories, metrics, diagram-signals)
  if [ -d /tmp/private-content/web/public/data ]; then
    cp -r /tmp/private-content/web/public/data/* public/data/
    echo "  - Overlaid web/public/data/"
  fi

  # Overlay wiki content (repo-locations.md, personal docs, future taxonomy)
  if [ -d /tmp/private-content/wiki ]; then
    cp -r /tmp/private-content/wiki/* ../wiki/
    echo "  - Overlaid wiki/"
  fi

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
