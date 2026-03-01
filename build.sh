#!/usr/bin/env bash
# Build the Zotero Vim plugin as an installable .xpi file.
# Usage: ./build.sh
set -euo pipefail

PLUGIN_ID="zotero-vim@zotero-vim"
OUTPUT="zotero-vim.xpi"

echo "Building $OUTPUT ..."

# Remove previous build.
rm -f "$OUTPUT"

# An .xpi is just a zip of the plugin root (without the outer directory).
zip -r "$OUTPUT" \
  manifest.json \
  bootstrap.js \
  content/ \
  icons/

echo "Done: $OUTPUT"
echo ""
echo "To install:"
echo "  1. Open Zotero → Tools → Plugins"
echo "  2. Click the gear icon → Install Plugin From File..."
echo "  3. Select $(pwd)/$OUTPUT"
