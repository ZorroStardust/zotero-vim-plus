---
---
# Development

[Documentation](README.md) · [Source repository](https://github.com/ZorroStardust/zotero-vim-plus#readme)

## Building from source

```bash
git clone https://github.com/ZorroStardust/zotero-vim-plus.git
cd zotero-vim-plus
./build.sh
```

`build.sh` uses `zip` to package the plugin as `zoetero-vim-plus.xpi`.

On Windows, use the equivalent PowerShell script instead (no bash needed):

```powershell
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

Both scripts run JS syntax, manifest, keybinding-table sync and regression
checks when `node` is available. Node.js is not a plugin runtime dependency.

```
zotero-vim-plus/
├── manifest.json          Plugin manifest (ID, version, Zotero version range)
├── bootstrap.js           Lifecycle hooks (startup/shutdown/window events)
├── build.sh               Builds zoetero-vim-plus.xpi (plus sanity checks)
├── content/
│   ├── zoteroVim.js       Core: modes, key handling, action dispatcher
│   ├── zoteroVimReader.js Reader-side methods (outline, visual/cursor, annotations)
│   ├── zoteroVimMain.js   Main-window methods (note editor, pickers, notes layout)
│   ├── zoteroVimSearch.js Native collection filtering and item quick search
│   ├── zoteroVimFocus.js  Shared focus frame for outline, PDF panes and sidebar notes
│   ├── zoteroVimHelp.js   Searchable shortcut reference and fixed command families
│   ├── keymapLabels.js   Shared English/Chinese action descriptions
│   ├── preferences.xhtml  Preferences panel UI (XUL/HTML hybrid)
│   └── prefs.js           Preferences panel JS (reads/writes Firefox prefs)
├── tools/
│   └── check-sync.js      Verifies the keybinding tables stay in sync
└── icons/
    ├── icon-64x64.png     Plugin icon (preferences pane, manifest)
    ├── icon-128x128.png   Plugin icon (manifest)
    ├── zotero vim plus.svg  Vector source of the logo
    ├── vim.svg            Legacy icon (kept for compatibility)
    ├── vim-48.png
    └── vim-96.png
```

In Zotero, open **Tools → Plugins**, click the gear, and choose **Install Plugin
From File…**. Select the XPI you built and restart Zotero if prompted. For
reader or note changes, open a PDF or note and exercise the affected shortcuts.

## Documentation website

The GitHub Pages source is the `docs/` folder of this repository. In GitHub,
open **Settings → Pages**, choose **Deploy from a branch**, and select
**main → /docs**. The project site uses the `/zotero-vim-plus` base path.

The homepage uses the shared `_layouts/home.html` template and the translations
in `_data/locales.yml`. Guides are rendered from the Markdown in each language
folder. Use `relative_url` for site assets and template navigation so the
repository subpath stays intact.

To preview locally, install the supported `github-pages` Ruby gem and run
the following from the repository root.

```bash
ruby -r github-pages -r jekyll -e \
  'Jekyll::Site.new(Jekyll.configuration({"source"=>"docs", "destination"=>ARGV.fetch(0)})).process' \
  /tmp/zvp-preview/zotero-vim-plus
python3 -m http.server 8765 --directory /tmp/zvp-preview --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/zotero-vim-plus/` in a browser.

## Architecture notes

These notes are intended for contributors or anyone debugging the plugin.

### Three-level iframe stack

Zotero's PDF reader is rendered inside nested iframes:

```
Zotero chrome window
  └─ reader.html          (reader._iframeWindow)
       └─ PDF.js iframe   (reader._internalReader._primaryView._iframeWindow)
```

Key events are captured at the innermost (PDF.js) level using a `keydown`
listener registered with `capture: true` on `pdfWin.addEventListener`.

### Cross-compartment security

`reader._internalReader` and the PDF.js viewer objects live in different
JavaScript security compartments from the Zotero chrome context.  Any
JavaScript object or array passed as an argument across this boundary must be
cloned first:

```js
Components.utils.cloneInto(value, targetWindow)
```

Primitive values (numbers, strings, booleans) cross compartments freely.
Forgetting `cloneInto` produces `"Permission denied to access property"` errors
that are easy to miss because they are often caught and silently swallowed.

### Shortcut reference

`keymapLabels.js` supplies action descriptions to the runtime and preferences
pane. `zoteroVimHelp.js` reads `getBindings()` on each open and supplements it
with `SHORTCUT_REFERENCE` for fixed note commands, marks and transient UI controls.
Update those descriptions when changing a fixed command. `tools/check-sync.js`
checks the shared language tables and defaults; `tools/check-shortcut-help.js`
exercises discovery, routing, migration and lifecycle.
The modal lives in the originating chrome window and belongs to its reader or
main-window state. Its key capture takes priority over reader and note handlers;
the native text-annotation-focus guard also suppresses Zotero's early reader
shortcuts. Closing invalidates listeners and delayed focus; tab changes or
destroyed views close without restoring stale focus. Managed note DOM is untouched.

### Focus appearance

`zoteroVimFocus.js` tracks region ownership and aligns the keyboard pane target;
its rendering remains independent of keyboard command handling.
Each reader's `_focusCue` owns pointer-transparent drawing layers with at most
one visible. PDF and outline frames draw directly in their own PDF document,
avoiding cross-compartment geometry and native browser compositing boundaries.
The note frame continues to draw around the outer editor host in chrome.
Every layer is fixed before insertion so it cannot allocate layout space.
Top-level window activation is independent of chrome document focus while an
embedded PDF is active.
The note editor's managed DOM is never modified. Native editor replacements,
split creation/closure, tab selection and window activation are reconciled by the
existing view-sync timer; closing a reader removes its observers and overlay.
Content window focus is observed alongside document focus events, because Gecko
can focus a PDF iframe without emitting `focusin`. Newly observed views also
inherit their actual native focus if activation preceded observer attachment.
Native `PDFView.focus()` focuses the outer iframe element; that element's focus
is mapped to its live PDF view instead of being discarded as incidental reader
focus. Changes in the native focus chain are also reconciled while both split
panes remain alive, without waiting for keyboard input or moving actual focus.
Focus ownership is separate from the rendering method so other cue styles can
be added without changing command handling.
Detached frame/style nodes are recreated during painting. When a PDF view is
destroyed, ownership recovery waits for native focus to return to a live reader
region and follows delayed replacement views beyond the split toggle's initial
timed callbacks. Toolbar inputs and notes retain focus throughout recovery;
the visual reconciler never calls DOM focus methods.

### Zotero built-in shortcut conflicts (Read Aloud)

Zotero's reader React app starts Read Aloud on the `l`/`r` keys and toggles
the hand tool / pointer tool on `h`/`s` from its `KeyboardManager`.  Keys
pressed inside the PDF.js iframe reach it via a **direct JS call** —
`view._onKeyDown(event)` in the reader's `pdf-view.js` — not via DOM event
propagation.  That means:

- `preventDefault()` / `stopPropagation()` inside the PDF.js iframe cannot
  stop it: Zotero's capture listener runs on the *same* window as the plugin's
  listener, and the forwarding is a plain function call, not an event dispatch.
- Native keydown events never cross the iframe boundary into reader.html, so
  document-level interceptors there never see PDF keys.

The plugin therefore patches the forwarding callback itself:

- `_patchReaderKeyForwarding()` replaces `_onKeyDown` on the PdfView instances
  (`_internalReader._primaryView` / `_secondaryView`) with a wrapper that
  drops the event when `_readerConsumesKey()` says vim will handle it (exact
  binding or prefix for the current mode).  Insert mode passes everything
  through except Escape.
- The wrapper crosses the chrome/content boundary via `Cu.unwrap` +
  `Cu.exportFunction` (a bare chrome function would be rejected by the
  content compartment).
- `_onKeyDown` additionally uses `stopImmediatePropagation()` (not
  `stopPropagation()`) wherever vim consumes a key, so Zotero's same-window
  capture listener is skipped when the plugin's listener registered first.

The patch is re-applied by the 800 ms view-sync timer so it survives view
recreation, split views, and restored sessions.  If Zotero changes the
reader's forwarding internals, re-verify `view._onKeyDown` and the
`KeyboardManager` shortcut table (keyboard-manager.js).

**Outline search ownership.** Tree command ownership is stored per reader and
updated by explicit focus commands, pointer events and focus on actual controls.
Gecko window wrappers and incidental iframe-body focus do not determine ownership;
chrome key forwarding must not refocus the PDF while the tree or picker owns input.
The tree handles keys only in its originating pane. The heading picker captures keys before
ordinary reader bindings while leaving native input/IME behavior intact;
both the forwarding wrapper and `_textAnnotationFocused` guard suppress
Zotero shortcuts in that pane. Closing a pane or reader invalidates its popup;
late outline results must never replace another popup or restore stale focus.
Tree and picker initialization share `_readerOutlineCurrentIndex()` over the
complete flattened outline. Tree loads belong to their overlay instance through
`_outlineExplorerLoad`; closing or replacing it invalidates both outline fetches
and delayed destination resolution before they can update a newer tree.

**Enter opening the annotation popup (Zotero 9).**  The popup is opened by
`PdfView._handleKeyDown()` — a bound capture listener on the PDF iframe
window registered before the plugin's listeners — which handles plain
`Enter` on a selected annotation *before* calling `view._onKeyDown`
(`Shift+Enter` does not match, which is why it inserts a newline normally).
Wrapping `_onKeyDown` can therefore never intercept it.  Instead,
`_patchReaderTextAnnotationFocus()` wraps `view._textAnnotationFocused()`
(a dynamic method call that `_handleKeyDown()` uses as its early-return
guard) to report the plugin's comment-overlay textarea as a focused text
annotation.  Zotero then skips all its key/pointer handling while the
overlay is being edited: Enter becomes a native newline, no popup opens,
and no keys reach the KeyboardManager.  The insert-mode popup guard
(`_armAnnotationPopupGuard`) closes a stray `.annotation-popup` with a
synthetic Escape as a backstop.

### Note input and native character events

Gecko can capture an original note-iframe key event in the chrome main document
before the editor window sees it. `_onMainKeyDown` must let that original event
reach the note listener; forwarded chrome copies must not execute the command.

The macOS issue #6 reports show `keypress` and cancelable `beforeinput` after
Vim already canceled `keydown`. The note iframe therefore captures all three.
Consumed-key state lasts until matching keyup, blur, editor replacement or the
next keydown, so `i`, `a`, `o` and change commands cannot leak their command
character after switching to Insert. Insert and search typing stay native.
Synchronous Vim edits bypass the input guard to retain native editing/undo.
These guards do not cancel noncancelable IME input or roll back document changes.

Library notes use `ZoteroPane.itemPane` / `#zotero-note-editor`; reader-sidebar
notes use `ZoteroContextPane`. A standalone tab's `Zotero.Notes.getByTabID`
lookup remains authoritative, including while the selected note is loading.

### Annotation navigation

`reader._internalReader.setSelectedAnnotations(Cu.cloneInto([key], readerWin))`
is the single call that handles everything — it scrolls the PDF to the
annotation, shows the selection outline, and scrolls the sidebar card into
view.  Do **not** also call `currentPageNumber = N` or `scrollPageIntoView`;
those compete with the internal navigation and cause jarring page jumps.

### Text selection in Visual mode

PDF.js renders each visual line as an absolutely-positioned `<span>` in a
`.textLayer` element (one `.textLayer` per page).  Browser APIs such as
`Selection.modify('extend', 'line')` are unreliable in this context.

The PDF.js text layer supplies the default reading order. Cached page geometry
repairs local runs with repeated evidence of column interleaving. Flash, cursor
movements and Visual movements share this sequence. Body-only selection also
uses it after filtering recognized publisher furniture. Visual mode maintains
its own anchor and active endpoint and projects the logical interval into
native DOM ranges. When the PDF text layer alternates columns in DOM order,
Gecko paints multiple ranges and copying and annotation use those same
fragments in reading order. Annotation rectangles are mapped by owning page.

### Text post-processing (yank operations)

All clipboard operations pass the raw `sel.toString()` or `annotationText`
through:

1. `text.normalize('NFKC')` — decomposes Unicode ligatures (`ﬁ` → `fi`, etc.)
2. `text.replace(/\n/g, ' ')` — collapses PDF line-wrap newlines into spaces
3. `text.replace(/ {2,}/g, ' ').trim()` — normalises whitespace

### Annotation comment field

The annotation comment is a `contenteditable` div with
`aria-label="Annotation comment"` inside a sidebar card identified by
`[data-sidebar-annotation-id="${key}"]`.  It is focused with `.focus()` only —
calling `.click()` from the chrome context creates a privileged `MouseEvent`
that content code cannot read, causing a security wrapper error.
