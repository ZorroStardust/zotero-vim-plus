# Pending Issues

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
