# Future Features

Ideas for new features, triaged by implementation effort.  Move items here to
the README / CHANGELOG once implemented, and mark them done below.

## Tier 1 — Small, low-risk (recommended next batch)

| # | Feature | Notes |
|---|---------|-------|
| 1 | ~~`n` / `N` next / previous search match~~ | **Done in v1.5-dev (commit 66c9c44)** — `findNext` / `findPrevious` actions plus the `findBarReturnBridge` that returns focus to the PDF after Enter in the find popup |
| 2 | `Ctrl+o` / `Ctrl+i` reading history | Call `reader._internalReader.navigateBack() / navigateForward()` (Zotero exposes them; currently bound to Alt+←/→) |
| 3 | `+` / `-` (and `=`) zoom | Call `reader._internalReader.zoomIn() / zoomOut()` — zoom currently needs `Ctrl+=` / `Ctrl+-` |
| 4 | `V` toggle reader sidebar | `_readerSetSidebarOpen` / `_readerIsSidebarOpen` already exist (used by the outline explorer) |
| 5 | Page number / progress in the mode indicator | Read `pdfWin.PDFViewerApplication.pdfViewer.currentPageNumber` and `pdfDocument.numPages`; display like `12/34 · 35%` |
| 6 | ~~Fuzzy picker: open the selected item's PDF~~ | **Done (commit e5ffea4+)** — `Ctrl+o` in the items picker selects the item and opens its PDF (`_pickerSelectItem` + `_mainOpenPDF`); bare `o` always types into the search box, and `Ctrl+o` in the tab picker does nothing ('o' stays a hint letter) |
| 7 | `gv` re-select the last Visual selection | Store `state.lastVisualRange` on exit; restore it on re-entering Visual mode |
| 8 | `*` / `#` search the word under the caret | Reuse the `_searchSelection` pattern (open find popup, inject `input` value + dispatch `input` event). Cursor mode: word at caret; Normal mode: word at viewport centre |
| 9 | Import / export keybindings as JSON + search box in the Preferences panel | Preferences UX only, no runtime risk |
| 10 | Auto-enter Insert mode when an annotation comment field gains focus | Removes the manual `i` step when clicking into a comment |

## Tier 2 — Medium effort (most "real Vim" feel)

- **Command-line mode `:`** — `:12` jump to page, `:/foo` search, `:sidebar`,
  `:color red`, `:w` save annotation comments.  The reader currently has no
  command line; a `:`-driven overlay (like the outline explorer) would be the
  biggest vim-identity win.
- **Cursor mode `f` / `F` / `t` / `T` character find** — reuse the existing
  text-node scanning / keyword machinery from `_cursorMoveByGranularity`.
- **~~Marks `m` + `` ` ``~~** — **Done (unreleased)** — session marks (`m<x>`
  set, `` `<x> `` instant jump, `dm<x>` delete, `dM` delete all, `<space>m`
  explorer overlay; chars `a`–`z` and `0`–`9`), plus opt-in persistence as a
  child note under the PDF item (Preferences → Marks). Old annotation-tag
  marks migrate automatically.
- **Visual-mode text objects `vi"` / `vi(` / `vi[`** — only word / sentence /
  paragraph exist today.
- **`.` repeat last action** — record the last `(action, count)` and replay.
- **Note editor: `/` search and `i"` / `i(` text objects.**
- **Jump between annotations by colour / author** (`[c` / `]c`).

## Tier 3 — Large projects (stretch)

- **EPUB / snapshot support** — **partially done**: scrolling, search, `gg`/`G`
  and `zt`/`zz`/`zb` now work in snapshots and EPUBs (scroll container
  fallback + view-agnostic search state). Remaining: visual mode, cursor mode
  and annotation commands are still PDF-specific (they depend on the PDF.js
  `.textLayer` DOM and annotation APIs).
- **Deeper native sidebar integration** (README TODO) — the outline explorer
  already drives the native sidebar (`_readerSetSidebarOpen`,
  `_readerActivateOutlineTab`, `_readerOutlineSendKey`, …); extend it to a
  full native outline/annotation navigation workflow.
- **Macro recording (`q` registers)** — needs an action-recording framework.

## Implementation notes

- Every new action must be added to `content/zoteroVim.js` `DEFAULT_BINDINGS`
  **and** `content/prefs.js` (`ZV_DEFAULT_BINDINGS` + `ZV_ACTION_LABELS`) —
  `tools/check-sync.js` (run by `build.sh`) enforces this.
- Reader actions that Zotero's `KeyboardManager` also handles (Read Aloud
  `l`/`r`, tools `h`/`s`, find `Ctrl+F`) are intercepted by
  `_patchReaderKeyForwarding` / `_readerConsumesKey` — see README
  "Architecture Notes → Zotero built-in shortcut conflicts (Read Aloud)".
- The vim-style search flow (`findBarReturnBridge`) is the reference pattern
  for bridging focus between reader.html form fields and the PDF iframe.
- When closing the find popup programmatically, use
  `toggleFindPopup({ open: false })` — never re-dispatch an Escape keydown
  into the PDF.js document (the plugin's own capture listener re-processes it).
