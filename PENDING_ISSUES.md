# Pending Issues

## ZV-002: Note editor `o` / `O` still splits text after caret (shelved)

- Status: Shelved (temporarily)
- Reported on: 2026-03-18
- Area: Note editor Vim emulation (`content/zoteroVim.js`)

### Summary
In note editor Normal mode, pressing `o` or `O` is intended to open a new line below/above and enter insert mode.
Current behavior is still inconsistent in some editor DOM states: pressing `o`/`O` can move text after the caret to the new line (line split) rather than creating a clean empty line relative to the current logical line.

### Reproduction
1. Open a note editor and ensure Normal mode is active.
2. Place caret in the middle of a line with text after the caret.
3. Press `o` (or `O`).
4. Observe the content after caret moving/splitting to a new line in affected states.

### Expected Behavior
- `o`: open a clean empty line below current logical line and enter insert mode.
- `O`: open a clean empty line above current logical line and enter insert mode.
- Neither command should split/move trailing text from the original line.

### Actual Behavior
- In some note editor structures, `o`/`O` still acts like a split at caret position.
- Upper/lowercase behavior can also become indistinguishable in those states.

### Notes From Previous Attempts
- Added insert-mode cursor-state sync after `o`/`O` mode switch.
- Added contenteditable-specific line insertion path and multiple fallbacks.
- Tried top-level block insertion strategy, but issue is still reproducible.

### Next Investigation Directions
- Inspect real note editor DOM for the failing case (block structure, selection anchors, editor normalization after mutation).
- Avoid synthetic fallback paths that trigger caret-position paragraph splits.
- Prefer editor-native transaction/command API if available instead of raw DOM insertion.
- Add debug traces around `o`/`O` command path to capture:
  - selection anchor/focus node + offset
  - resolved line/root nodes
  - actual inserted node parent/position
  - post-mutation normalized DOM

## ZV-001: `za` / `zo` / `zc` on collections tree is unstable (shelved)

- Status: Shelved (temporarily)
- Reported on: 2026-03-17
- Area: Main window keyboard navigation (`content/zoteroVim.js`)

### Summary
When focus is in the left collections tree, `za` / `zo` / `zc` are expected to toggle expand/collapse of the current collection row.
In practice, the operation can jump back to the item list and then perform expand/collapse behavior on the item list instead of the collections tree.

### Reproduction
1. Open Zotero main window.
2. Move focus to collections tree (left pane) and navigate into collection list.
3. Press `za` (or `zo` / `zc`).
4. Observe focus/behavior switching to item list in some states.

### Expected Behavior
- `za`: Toggle expand/collapse on the current collections row only.
- `zo`: Open current collections row only.
- `zc`: Close current collections row only.
- Focus should remain in collections tree unless explicitly moved by user.

### Actual Behavior
- Focus may return to item list.
- Expand/collapse can affect item list rows instead of collections rows.

### Notes From Previous Attempts
- Tried direct `collectionsView` API path (`isContainer`, `isContainerOpen`, `isContainerEmpty`, `toggleOpenState`).
- Added selection fallback and row resolution logic.
- Added refocus logic after toggle.
- Issue still reproducible in real usage.

### Next Investigation Directions
- Trace panel/focus source-of-truth right before and after `_mainTreeToggle`/`_mainTreeOpenOnly`/`_mainTreeCloseOnly`.
- Add temporary debug logs for:
  - `document.activeElement`
  - `collectionsView.selection.focused`
  - resolved row id/type
  - panel detection result from `_mainDetectFocusedPanel`
- Verify whether any selection/focus events from Zotero internals asynchronously move focus to item tree.
- Consider a short post-action focus lock to collections tree only when action originated from collections pane.
