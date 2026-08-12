# Pending Issues

## ZV-004: hjkl unresponsive for several seconds after Zotero restart on restored readers (shelved)

- Status: Shelved (pre-existing, not a regression — v1.5.0 also affected on re-test)
- Reported on: 2026-08-12
- Area: Reader startup / injection (`bootstrap.js`, `content/zoteroVim.js`)

### Summary
After restarting Zotero, restored PDF reader tabs ignore hjkl for several
seconds (roughly until the PDF document finishes loading). Switching items /
opening a new reader works immediately. Initial report suggested this was new
in v1.6.0, but re-testing v1.5.0 showed the same wait — it is a long-standing
startup issue.

### Investigation so far
- Environment: Zotero 9.0.6 (user machine). Zotero 9 differs from 7/8:
  `Zotero.Reader._readers` is an array (not a Map) and `Zotero_Tabs` has no
  public `tabs` property (only `_tabs`) — the original full-tab sweep
  (`win.Zotero_Tabs?.tabs`) was silently dead on Zotero 9.
- FIXED: `_rescanSelectedReader` now enumerates `Zotero.Reader._readers`
  (array or Map, with a `_tabs`/`tabs` fallback). File-log evidence
  (`zv-startup.log` in the profile dir) shows restored readers are now
  injected ~11 ms after startup.
- Remaining delay is AFTER injection: keys still do nothing until the PDF
  document finishes loading. Leading theory: PDF.js document load — scroll
  actions on the unrendered container have no visible effect. The "PDF
  loading…" status hint (`_maybePdfLoadingStatus`, covers both the
  smooth-hold path and the classic scroll path) was added to prove keys are
  captured during load but was not yet confirmed by the reporter.
- Other changes made while chasing this (keep): two-phase startup in
  bootstrap.js (listeners/window injection before
  `Zotero.initializationPromise`, idempotent), main-window key forwarding to
  the selected reader (`_forwardReaderKey` + auto-focus), outer-document
  always-forward in `outerKeyHandler`, pdf-view listener re-sync tightened
  800 ms → 250 ms, marks loading retry when the item DB is not ready.

### Next investigation directions
- Confirm via `zv-startup.log` whether `scroll during pdf load (no pdfDocument)`
  lines appear during the wait (keys captured?) or not (capture chain broken).
- Inspect Zotero 9's `_createView` iframe lifecycle — whether the PDF view's
  `_iframeWindow` at early injection is a placeholder that gets replaced when
  the document loads (listeners would then attach to a dead window until the
  250 ms re-sync catches up).
- Check whether focus during the wait sits outside the PDF iframe (main window
  `<browser>` / reader.html body) and whether the forwarding/auto-focus paths
  actually fire then.

## ZV-003: Marks persistence — Zotero 9 storage limitations (RESOLVED via parent-item Extra field)

- Status: Resolved in working tree (v1.6.2-dev) — marks now persist across restarts
- Reported on: 2026-08-12
- Area: Reader marks persistence (`content/zoteroVimReader.js` `_saveMarks`)

### Marks feature (solution summary)

Vim-style marks added in v1.6.0 (issue: number-key tags from sioyek):

- `m<x>` set, `` `<x> `` instant jump, `dm<x>` delete, `dM` delete all,
  `<space>m` marks explorer overlay (type a mark char to jump directly;
  `j`/`k` move, `Enter` jump, `d` delete, `x` delete all, `Esc` close).
- Mark characters are `a`–`z` + `0`–`9`; digits only act as counts when no
  prefix key is pending, so `4j` still scrolls and `` `1 `` jumps to mark 1.
- Marks store the viewport-centre position (`pageIndex` + in-page ratio), so a
  jump reproduces the exact view that was marked (instant page flip via
  `pdfViewer.currentPageNumber`, forced-instant scroll).

### Problem and root cause (finally pinned down with Zotero 9 source + DB inspection)

Persistence silently failed on Zotero 9: `saved (extra)` appeared, intra-session
reload worked, but marks vanished after restart. Three version-specific traps
in Zotero 9 (`C:\Program Files\Zotero\app\omni.ja` source, item.js/itemFields.js/
zoteroTypeSchemaData.js):

1. **No `.extra` property on `Zotero.Item`** — fields go through
   `getField('extra')` / `setField('extra', ...)`. A plain `item.extra = …`
   assignment creates an own property that `saveTx()` never persists
   (silently — it just writes nothing).
2. **The `extra` field (ID 22) is NOT valid for the `attachment` item type**
   (type 14's field list is `[110, 27, 1]`) — `setField('extra', …)` on an
   attachment throws `'extra' is not a valid field for type 'attachment'`.
3. **Child notes cannot be parented to attachments** — `saveTx()` throws
   `Parent item … must be a regular item` (Zotero 9's own note code uses
   `item.parentID = attachment.parentID`).

The original note→attachment-extra→pref cascade therefore failed on both
synced backends on Zotero 9 (the extra fallback's try/catch silently degraded
to the dead `.extra` assignment).

### Fix (working tree)

Storage moved to the **parent item's Extra field**, namespaced per attachment:
`zv-marks-<attachmentKey>: {json}` lines (multiple PDFs under one item get
separate lines; `setField` marks the change so `saveTx` persists). Cascade is
now: parent-item Extra (synced) → local pref. Note backend removed.

### Reproduction (original)

1. Preferences → Marks → enable "Persist marks", click Apply configuration.
2. Open a PDF, press `ma` — status shows `· saved (extra)`.
3. Restart Zotero — marks are gone (DB never received the write).

### Verification

- DB inspection (zotero.sqlite itemData/itemDataValues) confirmed the extra
  field was empty for the test attachments before the fix; re-verify after.

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
