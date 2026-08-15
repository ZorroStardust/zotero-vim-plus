#!/usr/bin/env bash
# Build the Zotero Vim plugin as an installable .xpi file.
# Usage: ./build.sh
set -euo pipefail

PLUGIN_ID="zotero-vim-plus@zotero-vim"
OUTPUT="zoetero-vim-plus.xpi"

# Optional sanity checks. Only `zip` is required to build; if `node` is
# available, verify JS syntax and that the hand-maintained keybinding/i18n
# tables (zoteroVim.js vs prefs.js/i18n.js) have not drifted.
if command -v node >/dev/null 2>&1; then
  echo "Checking JS syntax and binding-table sync ..."
  node --check bootstrap.js
  node --check content/i18n.js
  node --check content/zoteroVim.js
  node --check content/zoteroVimReader.js
  node --check content/zoteroVimMain.js
  node --check content/prefs.js
  node tools/check-sync.js
else
  echo "Warning: node not found — skipping syntax and sync checks."
fi

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
