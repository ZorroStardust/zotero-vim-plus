# Agent Guidelines for zotero-vim

## Project Overview

zotero-vim is a Zotero 7/8 plugin that brings Vim keybindings to the Zotero PDF reader.
Built as a Firefox/Gecko extension using the Bootstrap API — pure vanilla JavaScript,
no framework, no npm, no build pipeline beyond a simple zip script.

## Build / Install / Test

### Building the plugin
```bash
./build.sh
```
Creates `zotero-vim.xpi` — a zip of `manifest.json`, `bootstrap.js`, `content/`, and `icons/`.

### Installing
1. Open Zotero → Tools → Add-ons → Gear icon → "Install Add-on From File..."
2. Select `zotero-vim.xpi`
3. Restart Zotero

### Debugging
- Use `Zotero.debug('[ZoteroVim] message')` for logging — output appears in Zotero's
  Error Console (Help → Developer → Developer Options → Error Console).
- For UI feedback, use `this._showStatus(state, 'message', durationMs)` on the current
  reader state object.

### Testing
There is **no automated test suite**. Test changes by:
1. Building (`./build.sh`)
2. Re-installing the `.xpi` in Zotero
3. Restarting Zotero
4. Manually exercising the changed functionality in the PDF reader

## Code Style

### Indentation
Use **2 spaces** for indentation. Do not use tabs.

### File Structure
The codebase has three primary files:
- `bootstrap.js` — Zotero lifecycle entry point (install/uninstall hooks)
- `content/zoteroVim.js` — Main plugin logic (~5200 lines), structured as a single
  object literal (`var ZoteroVim = { ... }`)
- `content/prefs.js` — Preferences service helper

### JavaScript Conventions

**No ES6 classes.** Use object literals:
```js
var ZoteroVim = {
    init({ id, version, rootURI }) { ... },
    shutdown() { ... },
    // methods here
};
```

**No semicolons** — the codebase relies on ASI. Do not add semicolons at line ends.

**Global declarations.** Every file must declare its globals at the top:
```js
/* global Zotero, Components, Services */
/* eslint-disable no-unused-vars */
```

**Naming:**
- Methods and variables: `camelCase` (e.g., `_executeAction`, `_readerState`)
- Private/internal methods: underscore prefix (e.g., `_waitAndInject`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `PREF_PREFIX`, `COLORS`)
- Binding mode prefixes: `'normal:j'`, `'visual:zy'`, `'main: ff'` (with a space before the key)

### Imports / Dependencies
There are no imports — no `require`, no `import`, no npm packages.
Global Zotero/Firefox APIs are accessed directly:
```js
Components.classes["@mozilla.org/preferences-service;1"]
    .getService(Components.interfaces.nsIPrefBranch);
```

### Formatting
- **Single quotes** preferred in `zoteroVim.js`; double quotes in `prefs.js` — match the
  surrounding file.
- **Max line length:** ~100 characters. Use line breaks to stay readable.
- Use ASCII box-drawing comments as section dividers:
  ```js
  // ── Constants ────────────────────────────────────────────────────────────
  // ── Lifecycle ─────────────────────────────────────────────────────────────
  ```

### Error Handling
- Silent catches (when error is expected/non-critical):
  ```js
  try { something(); } catch (_) {}
  ```
- Log unexpected errors with `Zotero.debug()`:
  ```js
  Zotero.debug('[ZoteroVim] _executeAction error (' + action + '): ' + e);
  ```

### State Management
- Store per-reader state in a `Map` keyed by `instanceID`:
  ```js
  _readerState: new Map(),
  ```
- Never use module-level `let`/`var` for reader-specific state.

### Cross-Compartment Security (Chrome ↔ Content)
Objects and arrays passed across the chrome/content boundary **must** be cloned:
```js
Components.utils.cloneInto(value, targetWindow)
```
Failing to do this throws a security error.

### JSDoc
Add JSDoc-style block comments for non-obvious methods explaining parameters and side effects.
Inline comments are welcome for complex logic — use `//` style.

## Architecture Notes

The plugin operates across a **three-level iframe stack** in the Zotero PDF reader.
Key architectural decisions are documented in `README.md` under "Architecture Notes."
Read them before making changes to annotation navigation, text selection, or iframe injection.

The plugin also patches Zotero's reader key-forwarding callback (`_onKeyDown`
on the PdfView instances) so keys consumed by vim are not re-handled by Zotero
(Read Aloud on `l`/`r`, tools on `h`/`s`). Keep `_patchReaderKeyForwarding` /
`_readerConsumesKey` in mind when touching key handling or iframe injection;
see README "Architecture Notes → Zotero built-in shortcut conflicts (Read Aloud)".

## Key Files

| File | Purpose |
|------|---------|
| `bootstrap.js` | Zotero lifecycle hooks (install, uninstall, start, shutdown); loads the three content scripts |
| `content/zoteroVim.js` | Core plugin object: modes, keybindings, key handling, action dispatcher |
| `content/zoteroVimReader.js` | Reader-side methods (outline explorer, visual/cursor mode, annotations) |
| `content/zoteroVimMain.js` | Main-window methods (note editor, split views, pickers, notes layout) |
| `content/prefs.js` | Preferences panel JS + the hand-maintained default-binding tables |
| `content/preferences.xhtml` | Preferences panel UI (XUL/HTML hybrid) |
| `tools/check-sync.js` | Verifies `prefs.js` binding tables match `zoteroVim.js` (run by `build.sh`) |
| `manifest.json` | Extension manifest |
| `build.sh` | Builds the `.xpi` (runs syntax + binding-sync checks when `node` is available) |
| `FUTURE_FEATURES.md` | Triaged ideas for new features (Tier 1–3 by effort) |
| `PENDING_ISSUES.md` | Shelved issues with investigation notes |

## Important Constraints

- **Zotero 7/8 only.** The plugin targets the Firefox Gecko runtime. Do not assume Node.js
  or browser APIs not available in Gecko.
- **No external dependencies.** Do not add npm packages, CDN scripts, or external libraries.
- **No TypeScript.** The codebase is plain JavaScript.
- **No CI.** There are no automated checks. Code quality is maintained manually.
- **No pre-commit hooks.** Linting is optional and manual.
