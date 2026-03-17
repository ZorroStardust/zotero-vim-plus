# Zotero Vim Plus

> Original repository: https://codeberg.org/finktank/zotero-vim
>
> This repository is forked from the original Zotero Vim project.

Vim-style keybindings for the Zotero 7/8 PDF reader. Navigate, scroll,
annotate, and copy text without touching the mouse.

Vibe coded with Claude Sonnet 4.5.

![Brief Demo Video (no audio)](BriefDemoVideo.gif)

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Building from source](#building-from-source)
- [Modes](#modes)
- [Default keybindings](#default-keybindings)
  - [Normal mode](#normal-mode)
   - [Cursor mode](#cursor-mode)
  - [Visual mode](#visual-mode)
  - [Insert mode](#insert-mode)
- [Annotation workflow](#annotation-workflow)
- [TODO](#todo)
- [Customising keybindings](#customising-keybindings)
- [Settings](#settings)
- [Architecture notes](#architecture-notes)

---

## Features

- **Normal mode** — scroll, page-navigate, jump between annotations, copy
  annotation text, delete annotations, reposition the viewport (zt/zz/zb),
  and pan horizontally when zoomed in (`Shift+h`/`Shift+l`)
- **Cursor mode** — move a text caret like browser Vim plugins without
   selecting text (`hjkl`, `w/W`, `b/B`, `0/$`, and count prefixes such as `2w`)
- **Visual mode** — build text selections by line, character, word, sentence,
  or paragraph; create coloured highlights or notes; copy selection or whole
  paragraph to clipboard
- **Insert mode** — temporarily pass all keys through to Zotero (useful when
  typing in form fields); also focuses the annotation comment field when an
  annotation is selected
- **Fully remappable** — every action can be rebound from the Preferences panel
- **Text post-processing** — all yank operations normalise Unicode ligatures
  (`ﬁ` → `fi`, etc.) and collapse PDF line-break newlines into spaces

---

## Requirements

- Zotero 7 or 8 (the plugin uses the Zotero 7+ bootstrap API)
- macOS, Linux, or Windows

---

## Installation

1. Download `zoetero-vim-plus.xpi` from the releases page (or build it yourself —
   see below).
2. Open Zotero.
3. Go to **Tools → Plugins**.
4. Click the **gear icon (⚙)** in the top-right of the Plugins window.
5. Choose **Install Plugin From File…** and select `zoetero-vim-plus.xpi`.
6. Restart Zotero when prompted.

To update, repeat the same steps with the new `.xpi`. Zotero will replace the
old version automatically.

---

## Building from source

```bash
git clone https://github.com/zotero-vim/zotero-vim.git
cd zotero-vim
./build.sh
```

`build.sh` zips the plugin source into `zoetero-vim-plus.xpi`. No build tools or
package managers are required — only `zip` (available by default on macOS and
most Linux distributions).

```
zotero-vim/
├── manifest.json          Plugin manifest (ID, version, Zotero version range)
├── bootstrap.js           Lifecycle hooks (startup/shutdown/window events)
├── build.sh               Builds zoetero-vim-plus.xpi
├── content/
│   ├── zoteroVim.js       Main plugin object — all keybinding logic
│   ├── preferences.xhtml  Preferences panel UI (XUL/HTML hybrid)
│   └── prefs.js           Preferences panel JS (reads/writes Firefox prefs)
└── icons/
    ├── vim.svg
    ├── vim-48.png
    └── vim-96.png
```

---

## Modes

The plugin operates in three modes, displayed in a small overlay in the
bottom-right corner of the PDF viewer:

| Mode | Indicator | Purpose |
|------|-----------|---------|
| **Normal** | *(hidden)* | Default — navigation and annotation commands |
| **Cursor** | `-- CURSOR --` | Caret navigation without text selection |
| **Visual** | `-- VISUAL --` | Text selection and annotation creation |
| **Insert** | `-- INSERT --` | Passthrough — all keys go to Zotero |

Mode transitions:

```
Normal ──c──▶ Cursor ──Escape────▶ Normal
Normal ──v──▶ Visual ──v/Escape──▶ Normal
Normal ──i──▶ Insert ──Escape────▶ Normal
Cursor ──v──▶ Visual ──v/Escape──▶ Normal
```

---

## Default keybindings

### Normal mode

#### Scrolling

| Key | Action |
|-----|--------|
| `j` | Scroll down |
| `k` | Scroll up |
| `Shift+h` (`H`) | Scroll left |
| `Shift+l` (`L`) | Scroll right |
| `Ctrl+d` | Half-page down |
| `Ctrl+u` | Half-page up |
| `Ctrl+f` | Full-page down |
| `Ctrl+b` | Full-page up |

#### Page navigation

| Key | Action |
|-----|--------|
| `h` | Previous page |
| `l` | Next page |
| `gg` | First page |
| `G` | Last page |
| `Shift+J` (`J`) | Switch to previous open tab |
| `Shift+K` (`K`) | Switch to next open tab |
| `<space>bj` | Open tab picker (hint-based jump to open tab) |
| `<space>n` | Open notes layout overlay (left: note titles list, right: note preview) |

#### Notes layout overlay

Left side shows note entries (title only), grouped into Current item notes and All notes.
Right side shows preview content of the currently selected note.
If the current tab is a PDF reader, opening a note from this overlay will
prefer Zotero's right-side note editor so you can read and edit side by side.

| Key | Action |
|-----|--------|
| `j` / `k` | Move note focus down / up |
| `Ctrl+d` / `Ctrl+u` | Fast move down / up in note list |
| `Ctrl+j` / `Ctrl+k` | Switch between current-item notes and all-notes sections in the left list |
| `Ctrl+l` | Move focus to right preview pane |
| `Ctrl+h` | Move focus back to left note list |
| `n` | Create a new child note under the selected note's parent item and open in right-side note editor |
| `Shift+N` | Create a new child note under current selected item and open in a new note tab |
| `gg` / `G` | Jump to first / last note in overlay |
| Hint letters | Quick focus by hint label (single or double key) |
| `Enter` | Open selected note in right-side note editor (reader tabs preferred) |
| `Shift+Enter` | Open selected note in a new note tab |
| `Escape` | Close notes layout overlay |

#### Outline explorer

| Key | Action |
|-----|--------|
| `<space>e` | Toggle custom outline explorer overlay |
| `j` / `k` | Move outline selection down / up |
| `Ctrl+d` / `Ctrl+u` | Fast move down / up |
| `l` | Expand selected outline node |
| `h` | Collapse selected outline node |
| `R` / `M` | Expand all / collapse all outline nodes |
| `gg` / `G` | Jump to top / bottom outline item |
| Hint letters | Select the hinted outline item without jumping |
| `Enter` | Jump to selected outline entry and return to Normal mode |
| `Escape` | Close the outline explorer |

When the outline explorer opens, it will try to preselect the nearest/current
outline entry for your reading position; if the PDF metadata does not allow
reliable mapping, it falls back to the first visible outline item. Each visible
item also shows a hint label.
If the number of items is small the hints are single characters; otherwise they
expand to two-character hints. Typing a hint only changes the current selection;
you still press `Enter` to jump.

#### Reader split view

| Key | Action |
|-----|--------|
| `<space>-` | Toggle horizontal split (top/bottom) |
| `<space>\|` | Toggle vertical split (left/right) |
| `Ctrl+h` | Return from the right-side note editor to the active reader pane; otherwise focus the split pane to the left |
| `Ctrl+j` | Focus split pane below (or toggle pane in vertical split) |
| `Ctrl+k` | Focus split pane above (or toggle pane in vertical split) |
| `Ctrl+l` | In vertical split, move to the right reader pane first and then the right-side note editor; otherwise focus the split pane to the right |

#### Note editor (context pane and standalone note tab)

When a Zotero note editor has focus (right-side context pane or a standalone
note tab), the plugin provides a minimal Vim-like layer.

| Key | Action |
|-----|--------|
| `i` | Enter note Insert mode (pass through typing) |
| `a` / `A` / `I` | Enter Insert mode at next char / line end / line start |
| `o` / `O` | Open line below / above and enter Insert mode |
| `Escape` | Return to note Normal mode |
| `h` / `l` | Move caret left / right |
| `j` / `k` | Move caret down / up line |
| `w` / `e` / `b` | Move by word (forward start / forward end / backward) |
| `W` / `E` / `B` | Big-word variants |
| `0` / `^` / `$` | Move to line start / first non-blank (approx) / line end |
| `gg` | Jump to first line |
| `G` | Jump to last line |
| `3j` (example) | Count prefix for motions (repeat 3 times) |
| `3G` / `12gg` | Count prefix to jump to a specific line number |
| `x` | Delete character at caret |
| `dd` | Delete current line |
| `yy` | Yank current line to clipboard |
| `dw` / `de` / `db` / `d$` | Delete by motion (word/word-end/back-word/to line end) |
| `yw` / `ye` / `yb` / `y$` | Yank by motion |
| `cw` / `ce` / `c$` | Change by motion (delete range and enter Insert mode) |
| `diw` / `yiw` / `ciw` | Inner-word text object (delete/yank/change) |
| `p` / `P` | Paste last yanked/deleted text after / before caret |
| `u` / `Ctrl+r` | Undo / redo bridge |
| `<space>...` | Main-window leader bindings are available in note Normal mode (for example `<space>n`, `<space>ff`) |
| `Shift+J` / `Shift+K` | Switch to previous / next tab from note Normal mode |

`dd`, `yy`, and `x` support count prefixes (for example `3dd`, `5yy`, `4x`).
Operator+motion combos also support counts (for example `3dw`, `2y$`).
`p` and `P` use the plugin's internal note register (updated by `yy` and `dd`).

#### Library tree navigation (left pane)

These bindings act on Zotero's native left collection tree when that tree has focus.

| Key | Action |
|-----|--------|
| `h` | In item list, move focus back to collection tree; in collection tree, collapse selected collection or jump to parent |
| `l` | In collection tree, expand selected collection; if already expanded or a leaf, move focus into item list |
| `Enter` | In collection tree, move focus into item list; in item list, open the selected item/PDF |
| `Backspace` | Jump to parent collection |
| `za` | Toggle expand/collapse for the currently selected collection row |
| `zo` | Expand the current collection row (if already open, keep it open) |
| `zc` | Collapse the current collection row (if already closed, keep it closed) |
| `R` | Expand all collections in the current library tree |
| `M` | Collapse all collections in the current library tree |

#### Viewport positioning (like Vim's z commands)

| Key | Action |
|-----|--------|
| `zt` | Scroll so the current page is at the **top** of the view |
| `zz` | Scroll so the current page is at the **centre** of the view |
| `zb` | Scroll so the current page is at the **bottom** of the view |

#### Search

| Key | Action |
|-----|--------|
| `/` | Open the PDF find bar |
| `Escape` | Clear / close search |

#### Sidebar filter by colour

| Key | Action |
|-----|--------|
| `Zy` | Filter sidebar → Yellow annotations only |
| `Zr` | Filter sidebar → Red annotations only |
| `Zg` | Filter sidebar → Green annotations only |
| `Zb` | Filter sidebar → Blue annotations only |
| `Zp` | Filter sidebar → Purple annotations only |
| `Za` | Clear colour filter (show all annotations) |

> **Tip:** `z` (lowercase) acts *on* an annotation (recolour). `Z` (uppercase) acts *on the sidebar view* (filter).

#### Annotation navigation and editing

Use `[` and `]` to move between annotations. The selected annotation is
highlighted in the PDF and scrolled to in the sidebar.

| Key | Action |
|-----|--------|
| `[` | Jump to previous annotation |
| `]` | Jump to next annotation |
| `Enter` | Open the selected annotation's comment field for editing |
| `i` | Enter Insert mode **and** focus the annotation comment field |
| `y` | Copy the annotation's **highlighted text** to the clipboard |
| `yy` | Copy the annotation's **comment text** to the clipboard |
| `dd` | Delete the selected annotation |
| `zy` | Change annotation colour → Yellow |
| `zr` | Change annotation colour → Red |
| `zg` | Change annotation colour → Green |
| `zb` | Change annotation colour → Blue |
| `zp` | Change annotation colour → Purple |

> **Tip:** `y` vs `yy` — the plugin waits up to 800 ms for the second `y`
> before firing the single-`y` action. Typing `yy` quickly always wins.

#### Mode switches

| Key | Action |
|-----|--------|
| `v` | Enter Visual mode |
| `c` | Enter Cursor mode |
| `i` | Enter Insert mode |

---

### Cursor mode

Enter Cursor mode with `c` from Normal mode.
After pressing `c`, the plugin shows hint badges (same visual style as Visual mode)
at candidate text positions in the viewport. Press a hint letter to place the
caret there.

#### Caret movement

| Key | Action |
|-----|--------|
| `j` / `k` | Move caret down / up by one visual line |
| `h` / `l` | Move caret left / right by one character |
| `w` | Move caret forward by one word |
| `W` | Move caret forward by one WORD (non-whitespace chunk) |
| `b` | Move caret backward by one word |
| `B` | Move caret backward by one WORD (non-whitespace chunk) |
| `0` / `$` | Move caret to line start / line end |
| `2w`, `3b`, ... | Count prefix repeats the motion |

#### Mode switches

| Key | Action |
|-----|--------|
| `a..z` (hint) | Place caret at selected hinted text position |
| `v` | Enter Visual mode from current caret |
| `Escape` | Exit to Normal mode |

---

### Visual mode

Enter Visual mode with `v` from Normal mode.  If there is no existing text
selection, the plugin shows **hint badges** (yellow letter labels) at sentence
starts across the visible page.  Press the corresponding letter to anchor the
selection at that position.  The selection then grows as you press movement
keys.

#### Selection movement

| Key | Action |
|-----|--------|
| `j` / `k` | Extend selection down / up by one line |
| `h` / `l` | Extend selection left / right by one character |
| `w` / `b` | Extend selection forward / backward by one word |
| `0` / `$` | Extend selection to line start / line end |
| `)` / `(` | Extend selection to next / previous sentence start |
| `}` / `{` | Extend selection to paragraph end / start |
| `o` | **Swap anchor and focus** — jump to the opposite end of the selection (like Vim's `o` in Visual mode); subsequent movement keys extend from the new end |

#### Creating annotations

| Key | Action |
|-----|--------|
| `zy` | Create a **yellow** highlight |
| `zr` | Create a **red** highlight |
| `zg` | Create a **green** highlight |
| `zb` | Create a **blue** highlight |
| `zp` | Create a **purple** highlight |
| `za` | Add a **note** annotation (creates highlight + opens comment editor) |
| `i` | Same as `za` (quick note + enter Insert on comment) |

#### Copying text

| Key | Action |
|-----|--------|
| `y` | Copy the **current selection** to the clipboard |
| `yy` | Copy the **whole paragraph** containing the selection to the clipboard |
| `#` | Open the find bar and search for the **current selection** |

All copy operations apply Unicode NFKC normalisation (resolves ligatures such
as `ﬁ` → `fi`) and collapse PDF line-break newlines into spaces.

#### Exiting Visual mode

| Key | Action |
|-----|--------|
| `v` | Exit to Normal mode (clears selection) |
| `Escape` | Exit to Normal mode (clears selection) |

---

### Insert mode

In Insert mode every key is passed through to Zotero unchanged.  This is
useful when you need to type into Zotero's own UI elements without the vim
bindings intercepting your keystrokes.

When `i` is pressed in Normal mode while an annotation is selected (via `[`/`]`),
the plugin automatically enters Insert mode **and** focuses the annotation's
comment field so you can start typing immediately.  Press `Escape` to save and
return to Normal mode.

| Key | Action |
|-----|--------|
| `Escape` | Exit Insert mode → Normal mode |

---

## Annotation workflow

### Creating a highlight from scratch

1. Press `v` to enter Visual mode.
2. Press the hint letter shown at the desired sentence start (or `j`/`k` to
   begin from the current position).
3. Extend the selection with `j`/`k`/`w`/`b`/`)`/`}`/`h`/`l`.
4. Use `o` to jump to the other end of the selection if you need to trim the
   start rather than extend the end.
5. Press `zy`/`zr`/`zg`/`zb`/`zp` to create a coloured highlight, or `za` to
   add a note.

### Navigating and editing existing annotations

1. Press `]` / `[` to move to the next / previous annotation.  The annotation
   is highlighted in the PDF viewer and the sidebar scrolls to its card.
2. Press `y` to copy the highlighted text, `yy` to copy the comment.
3. Press `i` (or `Enter`) to open the comment field and type a note.  Press
   `Escape` to return to Normal mode.
4. Press `dd` to delete the annotation.

---

## TODO

- [ ] Native reader sidebar integration:
   integrate with Zotero/PDF.js's built-in left sidebar directly. The custom
   outline explorer overlay is available, but the native sidebar workflow is
   still deferred because its focus/DOM behavior is less stable.

---

## Customising keybindings

Open **Edit → Preferences** (macOS: **Zotero → Settings**) and navigate to the
**Zotero Vim** tab.

- Every row in the **Keybindings** table maps a *mode + key sequence* to an
  *action*.
- Click the key sequence cell to edit it directly.
- Use lowercase letters.  Prefix with `ctrl+` for Ctrl (or Cmd on macOS).
- Multi-key sequences such as `gg`, `zy`, or `yy` are supported.
- Click **+ Add binding** to add a new row; click **×** to remove one.
- Click **Apply bindings** to save keybinding changes.
- Scroll behavior settings have a separate **Apply configuration** button.
- Highlight colour and mode-enable toggles save automatically on change.
- Note editor Vim mode can be turned on or off independently from the Preferences panel.
- Click **Reset to defaults** to restore all bindings to their defaults.

### Action reference

| Action | Description |
|--------|-------------|
| `scrollDown` | Scroll down by the configured step |
| `scrollUp` | Scroll up by the configured step |
| `scrollLeft` | Scroll left by the configured step |
| `scrollRight` | Scroll right by the configured step |
| `halfPageDown` | Scroll down half a viewport |
| `halfPageUp` | Scroll up half a viewport |
| `fullPageDown` | Scroll down a full viewport |
| `fullPageUp` | Scroll up a full viewport |
| `scrollTop` | Reposition view so current page is at top |
| `scrollCenter` | Reposition view so current page is centred |
| `scrollBottom` | Reposition view so current page is at bottom |
| `prevPage` | Previous page |
| `nextPage` | Next page |
| `firstPage` | First page |
| `lastPage` | Last page |
| `openSearch` | Open find bar |
| `clearSearch` | Close / clear find bar |
| `prevAnnotation` | Jump to previous annotation |
| `nextAnnotation` | Jump to next annotation |
| `editAnnotation` | Focus annotation comment field (Enter) |
| `deleteAnnotation` | Delete selected annotation |
| `filterYellow` | Filter sidebar to Yellow annotations only |
| `filterRed` | Filter sidebar to Red annotations only |
| `filterGreen` | Filter sidebar to Green annotations only |
| `filterBlue` | Filter sidebar to Blue annotations only |
| `filterPurple` | Filter sidebar to Purple annotations only |
| `filterClear` | Clear colour filter (show all annotations) |
| `recolorYellow` | Change selected annotation colour to Yellow |
| `recolorRed` | Change selected annotation colour to Red |
| `recolorGreen` | Change selected annotation colour to Green |
| `recolorBlue` | Change selected annotation colour to Blue |
| `recolorPurple` | Change selected annotation colour to Purple |
| `yankAnnotation` | Copy annotation highlighted text |
| `yankAnnotationComment` | Copy annotation comment text |
| `enterVisual` | Enter Visual mode |
| `enterCursor` | Enter Cursor mode |
| `enterInsert` | Enter Insert mode (also focuses comment if annotation selected) |
| `exitMode` | Return to Normal mode |
| `extendDown` | Extend selection down one line |
| `extendUp` | Extend selection up one line |
| `extendLeft` | Extend selection left one character |
| `extendRight` | Extend selection right one character |
| `extendWordForward` | Extend selection to next word |
| `extendWordBackward` | Extend selection to previous word |
| `extendLineStart` | Extend selection to start of current line |
| `extendLineEnd` | Extend selection to end of current line |
| `extendSentenceForward` | Extend selection to next sentence start |
| `extendSentenceBackward` | Extend selection to previous sentence start |
| `extendParagraphForward` | Extend selection to end of current paragraph |
| `extendParagraphBackward` | Extend selection to start of current paragraph |
| `highlightYellow` | Create yellow highlight |
| `highlightRed` | Create red highlight |
| `highlightGreen` | Create green highlight |
| `highlightBlue` | Create blue highlight |
| `highlightPurple` | Create purple highlight |
| `addNote` | Add note annotation |
| `copySelection` | Copy current selection to clipboard |
| `searchSelection` | Open find bar and search for current selection |
| `yankParagraph` | Copy whole paragraph to clipboard |
| `swapVisualEnds` | Swap selection anchor and focus |
| `cursorDown` | Move caret down one visual line (Cursor mode) |
| `cursorUp` | Move caret up one visual line (Cursor mode) |
| `cursorLeft` | Move caret left one character (Cursor mode) |
| `cursorRight` | Move caret right one character (Cursor mode) |
| `cursorWordForward` | Move caret forward one word (Cursor mode) |
| `cursorBigWordForward` | Move caret forward one WORD (Cursor mode) |
| `cursorWordBackward` | Move caret backward one word (Cursor mode) |
| `cursorBigWordBackward` | Move caret backward one WORD (Cursor mode) |
| `cursorLineStart` | Move caret to start of line (Cursor mode) |
| `cursorLineEnd` | Move caret to end of line (Cursor mode) |
| `cursorToVisual` | Enter Visual mode from current caret |
| `mainTabPick` | Open tab picker for currently open Zotero tabs |
| `mainNotesLayout` | Toggle notes layout overlay (left list + right preview) |
| `toggleReaderSidebarOutline` | Toggle the custom outline explorer overlay |
| `focusReaderSidebar` | Focus or reopen the custom outline explorer overlay |
| `toggleReaderSplitHorizontal` | Toggle reader horizontal split view |
| `toggleReaderSplitVertical` | Toggle reader vertical split view |
| `focusReaderSplitLeft` | Focus left split pane (or toggle in horizontal split) |
| `focusReaderSplitDown` | Focus lower split pane (or toggle in vertical split) |
| `focusReaderSplitUp` | Focus upper split pane (or toggle in vertical split) |
| `focusReaderSplitRight` | Focus right split pane (or toggle in horizontal split) |
| `mainActivate` | In collections, enter the item list; in items, open the selected item/PDF |
| `mainTreeToggle` | Toggle expand/collapse for the selected collection |
| `mainTreeOpenOnly` | Expand the selected collection without changing pane |
| `mainTreeCloseOnly` | Collapse the selected collection without moving to parent |
| `mainTreeExpand` | Expand selected collection or move focus into the item list |
| `mainTreeCollapse` | Collapse selected collection, move to parent, or return focus to the collection tree |
| `mainTreeParent` | Move selection to parent collection |
| `mainTreeExpandAll` | Expand all collections in the left tree |
| `mainTreeCollapseAll` | Collapse all collections in the left tree |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Visual mode | on | Allow entering Visual mode with `v` |
| Enable Cursor mode | on | Allow entering Cursor mode with `c` |
| Enable Insert mode | on | Allow entering Insert mode with `i` |
| Scroll step | 60 px | Pixels scrolled per `j`/`k`/`H`/`L` keypress |
| Smooth scrolling | on | Enable smooth scrolling behavior in the reader |
| Smooth initial speed | 2000 px/s | Starting speed for hold-based smooth scrolling |
| Smooth max speed | 2000 px/s | Maximum hold-scroll speed |
| Smooth acceleration | 2600 px/s² | Speed increase while holding a scroll key |
| Smooth deceleration | 4200 px/s² | Speed decrease after key release |
| Stop on release | off | If enabled, stop immediately when key is released |
| Default highlight colour | Yellow | Colour used when no explicit colour key is pressed |

Scroll settings are staged and only saved when you click **Apply configuration**.

By default, `initial speed` and `max speed` are both `2000`, which gives a
more constant "no acceleration jump" feel that many users perceive as smoother.
If you prefer stronger acceleration/deceleration dynamics, you can set
different values for these parameters.

---

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

The plugin implements its own line extension (`_extendByLine`) using
`document.caretPositionFromPoint` and a fallback span-geometry scan.
Sentence and paragraph extensions (`_extendBySentence`, `_extendByParagraph`)
scan all `.textLayer span` elements from *all pages* using
`document.querySelectorAll('.textLayer span')` — **not**
`document.querySelector('.textLayer')` which returns only the first page.

Selections are tracked with `state.visualCursor = { textNode, offset }` as the
anchor so that `sel.addRange()` can rebuild the correct range after PDF.js
occasionally clears the browser selection.

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
