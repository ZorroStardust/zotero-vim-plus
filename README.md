# Zotero Vim Plus

> **Languages:** [English](README.md) · [Español](README.es-ES.md) · [中文](README.zh-CN.md)

> Original repository: https://codeberg.org/finktank/zotero-vim
>
> This repository is forked from the original Zotero Vim project.

Vim-style keybindings for the Zotero 7–10 PDF reader and note editors. Navigate,
annotate, search and edit rich-text notes without touching the mouse.

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
  - [Note Vim editor](#note-vim-editor)
  - [Cursor mode](#cursor-mode)
  - [Visual mode](#visual-mode)
  - [Insert mode](#insert-mode)
- [Annotation workflow](#annotation-workflow)
- [TODO](#todo)
- [Customising keybindings](#customising-keybindings)
- [Settings](#settings)
- [Architecture notes](#architecture-notes)
- [License](#license)

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
- **Note Vim editor** — Normal, Insert and characterwise/linewise Visual modes
  in note tabs, the library item pane and the reader's Notes sidebar; precise
  character/pair motions, literal search, text objects, editing operators,
  command hints and compact absolute line numbers
- **Remappable reader and main-window actions** — rebind actions from the
  Preferences panel; note editing commands currently use built-in Vim keys
- **No shortcut collisions** — keys consumed by vim are intercepted before
  Zotero's reader key handling, so `l` (next page) doesn't trigger the
  built-in Read Aloud and `h`/`s`/`Ctrl+F` don't toggle the hand tool /
  pointer tool / find bar
- **Text post-processing** — all yank operations normalise Unicode ligatures
  (`ﬁ` → `fi`, etc.) and collapse PDF line-break newlines into spaces
- **Snapshot & EPUB support** — scrolling, search (`/` + `n`/`N`), `gg`/`G`
  (top/bottom) and `zt`/`zz`/`zb` work in web snapshots and EPUBs too
  (snapshots have no pages, so `h`/`l` show a hint). Reader Visual mode, cursor
  mode and annotation commands remain PDF-specific; notes have their own Visual mode
- **Marks** — vim-style position marks (`m<x>` set, `` `<x> `` instant jump,
  `dm<x>`/`dM` delete, `<space>m` explorer overlay) with `a`–`z` or `0`–`9`
  characters (sioyek-style numbered tags); optionally persisted in the parent
  item's Extra field so they survive restarts and sync

---

## Requirements

- Zotero 7–10 (the plugin uses the Zotero 7+ bootstrap API)
- macOS, Linux, or Windows

---

## Installation

1. Download `zoetero-vim-plus.xpi` from the [latest release](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest) (or build it yourself —
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
git clone https://github.com/ZorroStardust/zotero-vim-plus.git
cd zotero-vim-plus
./build.sh
```

`build.sh` zips the plugin source into `zoetero-vim-plus.xpi`. No build tools or
package managers are required — only `zip` (available by default on macOS and
most Linux distributions).

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

---

## Modes

The plugin operates in four modes, displayed in a small overlay in the
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
| `Ctrl+o` | Go back through Zotero's reading-position history |
| `Ctrl+i` | Go forward through Zotero's reading-position history |

Count prefixes multiply the step — `3j` scrolls three steps, `2ctrl+f` two full
pages, and so on.

Reading-position history is Zotero's native per-view session history. Major
jumps (`gg`/`G`, outline entries, marks, links and annotations) add entries in
the active split pane; routine `hjkl` motion deliberately does not. It is
separate from named marks and supports count prefixes (`3ctrl+o`).

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

Count prefixes repeat the page turn (`3l` = three pages forward) and `gg`/`G`
with a count jump to that page number (`5G` / `5gg` = page 5).

> **Note:** Zotero's built-in Read Aloud also listens for the `l`/`r` keys.
> The plugin blocks Zotero's reader key forwarding for keys vim consumes, so
> `l` (next page) never starts Read Aloud. To use Read Aloud, press `r`
> (unbound in vim by default) or click the Read Aloud toolbar button.

#### Fuzzy picker

| Key | Action |
|-----|--------|
| `<space>ff` | Open fuzzy picker over all items in the current library |
| `<space>fb` | Open fuzzy picker over items in the current collection |
| `<space>bj` | Open tab picker (see below) |

The picker opens a search box in the middle of the screen. Start typing to
filter items (sequential fuzzy matching — every character must appear in
order). Then:

| Key | Action |
|-----|--------|
| `↑` / `↓` (or `Ctrl+n` / `Ctrl+p`, `Ctrl+j` / `Ctrl+k`) | Move selection up / down |
| `Enter` | Select the item in the item list / jump to the selected tab |
| `Ctrl+o` | Open the selected item's PDF (items picker only) |
| `y` | Copy the selected item's full citation to the clipboard |
| `yy` | Copy the selected item's citekey to the clipboard |
| `Escape` | Close the picker |

The **tab picker** (`<space>bj`) uses the same interface for the currently
open tabs, plus **hint letters**: each tab shows a letter label, and typing
its letter(s) selects that tab directly (single- or double-letter hints
depending on the number of tabs). `y`/`yy` copying is not available in the
tab picker.

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

#### Marks

Vim-style position marks for quick jumps. `m<x>` sets a mark at the current
viewport position, `` `<x> `` jumps back to it. Mark characters can be `a`–`z`
or `0`–`9` (sioyek-style numbered tags).

| Key | Action |
|-----|--------|
| `m<x>` | Set a mark at the current position (e.g. `ma`, `m1`) |
| `` `<x> `` | Jump to the mark — instant page flip, reproducing the exact view that was marked (e.g. `` `a ``, `` `1 ``) |
| `dm<x>` | Delete the mark (e.g. `dma`) |
| `dM` | Delete all marks |
| `<space>m` | Toggle the marks explorer overlay (type a mark char to jump directly; `j`/`k` move, `Enter` jump, `d` delete, `x` delete all) |

Notes:

- Digits after a mark prefix are mark characters, not counts — `4j` still
  scrolls four steps, but `` `1 `` jumps to mark 1.
- A mark stores the viewport-centre position: whatever was in the middle of
  the screen when you pressed `m<x>` will be in the middle of the screen when
  you jump back — even mid-page.
- If an annotation is selected (via `[`/`]`), the mark also binds to it so
  follow-up commands (`[`/`]`, `zy`, `y`, …) work after a jump. `[`/`]`
  annotation navigation is unaffected.
- With **Persist marks** enabled (Preferences → Marks) the whole mark set is
  saved as a `zv-marks-<attachmentKey>:` line in the **parent item's Extra
  field** (syncs via Zotero sync — Zotero 9 attachments have no Extra field,
  so the parent item is used; multiple PDFs under one item get separate
  lines), falling back to a device-local pref. The status bar shows which
  backend was used (`· saved (extra)` / `· saved (local)`). Marks from the
  previous annotation-tag scheme are migrated automatically.
- Marks set with persistence disabled live for the current reader session only.

#### Note Vim editor

When a Zotero note editor has focus (library item pane, right-side reader context
pane or a standalone note tab), the plugin provides Vim-like navigation, search
and rich-text editing. Note Vim is independent of the PDF reader modes and is
enabled by default under **Settings → Zotero Vim Plus → Modes**.

Quick start: click inside a note, press `Escape` and check for **NOTE NORMAL**.
Use `hjkl` to move, `i` to type and `Escape` to return to Normal. Try `12G`
to jump to line 12, `f,` to find a comma, `/` to search, `viw` to select a word,
or `ci"` to replace the text inside quotes. A bottom hint explains commands
waiting for another key, such as `f`, `d` or `ci`.

| Key | Action |
|-----|--------|
| `i` | Enter note Insert mode (pass through typing) |
| `a` / `A` / `I` | Enter Insert mode at next char / line end / first non-blank |
| `o` / `O` | Open line below / above and enter Insert mode |
| `Escape` | Return to note Normal mode |
| `h` / `l` or `←` / `→` | Move caret left / right |
| `j` / `k` or `↓` / `↑` | Move caret down / up line |
| `w` / `e` / `b` | Move by word (forward start / forward end / backward) |
| `W` / `E` / `B` | Big-word variants |
| `0` / `^` / `$` | Move to line start / first non-blank / line end |
| `gg` | Jump to first line |
| `G` | Jump to last line |
| `3j` (example) | Count prefix for motions (repeat 3 times) |
| `3G` / `12gg` | Count prefix to jump to a specific line number |
| `f{char}` / `F{char}` | Find the next / previous occurrence of a character on this logical line |
| `t{char}` / `T{char}` | Move just before / after the next / previous occurrence |
| `;` / `,` | Repeat the last character find in the same / opposite direction |
| `%` | Jump between matching `()` / `[]` / `{}`; first look for a bracket at or after the caret on this line |
| `50%` (example) | Jump to the line at 50% of the document |
| `/` / `?` | Open forward / backward note search; Enter confirms, Escape cancels |
| `n` / `N` | Next / previous result in the remembered search direction (wraps) |
| `*` / `#` | Search the word under the caret forward / backward |
| `v` / `V` | Enter characterwise / logical-line Visual mode |
| `gv` | Restore the last Visual selection if the note text has not changed |
| `x` | Delete character at caret |
| `dd` | Delete current line |
| `yy` | Yank current line to clipboard |
| `dw` / `de` / `db` / `d$` | Delete by motion (word/word-end/back-word/to line end) |
| `yw` / `ye` / `yb` / `y$` | Yank by motion |
| `cw` / `ce` / `c$` | Change by motion (delete range and enter Insert mode) |
| `d{object}` / `y{object}` / `c{object}` | Delete / yank / change a text object (see below) |
| `p` / `P` | Paste characterwise text after / before caret, or whole lines below / above |
| `u` / `Ctrl+r` | Undo / redo bridge |
| `<space>...` | Main-window leader bindings are available in note Normal mode (for example `<space>n`, `<space>ff`) |
| `Shift+J` / `Shift+K` | Switch to previous / next tab in note Normal mode; type `J` / `K` in Insert mode |

`dd`, `yy`, and `x` support count prefixes (for example `3dd`, `5yy`, `4x`).
Operator+motion combos also support counts (for example `3dw`, `2y$`).
Counts before and after the operator multiply: `2d3w` deletes six words.
`1G` goes to the first line; bare `G` goes to the last line.
`p` and `P` support counts (for example `3p`) and use the internal note register,
updated by yank/delete/change operations including `x`.
Physical arrow keys are Vim motions only in note Normal/Visual mode; Insert
mode leaves arrows and their modifiers entirely native. If an editor command
palette is open (including Better Notes' `/` palette), the first `Escape`
closes that palette and remains in Insert; press `Escape` again to enter Normal.
After explicitly dismissing Better Notes' palette, deleting text back to that
same `/` does not reopen it. Typing a new `/` or `Ctrl+/` enables it again.

Precise motions work with operators and counts: `2fa` finds the second `a`,
`dt)` deletes up to but not including `)`, `df)` includes it, and `d%` includes
both bracket endpoints. `;` / `,` do not change the original remembered find
direction. A failed find leaves the text and caret unchanged. Character finds
stay on a logical line; matching pairs can span paragraphs. Pair matching is
text-based, skips escaped delimiters and one-line quoted strings, and is not
a language-aware parser.

Pending commands show a compact, non-interactive hint at the bottom of the note.
For example, `f` shows the direction and asks for a character, while `2d3f`
shows the typed command and the sixth occurrence. Counts, operators and pending
text objects also show their next expected input, in English or Chinese using
the plugin's language setting (or Zotero's locale). The hint stays visible
until completion or Escape; leaving the editor cancels it. It does not move
the selection, enter saved HTML or undo history, and is hidden when printing.

Search is case-sensitive **literal text**, not Vim regular expressions. It
supports Chinese and other Unicode text, live result counts, a highlighted
preview of the next match, and wraparound. Type the query in the small bottom search bar;
Enter returns focus to the note, while Escape or focusing elsewhere cancels
and restores the original position/selection. Empty Enter repeats the previous
query. `3n` jumps three matches; `d/search` or `c?search` combines an interactive
search with an operator. `*` / `#` match whole words rather than substrings.
This search bar is outside the managed note content and is hidden when printing.
Replacement, Vim regex syntax and a command-line interface are not implemented.

In Visual mode, motions, counts, character finds, `%`, search and text objects
extend the selection. `o` swaps its active end, `y` copies, `d` / `x` delete,
and `c` deletes and enters Insert mode. `v` / `V` switch selection types;
pressing the current type again or Escape returns to Normal mode. `J` / `K`
do not switch tabs in Visual mode. Rectangular/block Visual mode is not included.
`gv` intentionally refuses old offsets after the note text changes.

Text objects work after `d` / `y` / `c` and inside Visual mode:

| Inner / around | Object |
|----------------|--------|
| `iw` / `aw`, `iW` / `aW` | Word / whitespace-separated WORD; around includes adjacent spacing |
| `is` / `as` | Sentence, with English or Chinese ending punctuation |
| `ip` / `ap` | Paragraph; around includes adjacent empty paragraphs/lines |
| `i"` / `a"`, `i'` / `a'`, `` i` `` / `` a` `` | One-line quoted text; escaped quotes are skipped |
| `i(` / `a(`, `ib` / `ab` | Parentheses |
| `i[` / `a[`, `i{` / `a{`, `iB` / `aB`, `i<` / `a<` | Brackets / braces / angle brackets |
| `it` / `at` | Literal paired HTML/XML tags in note text, not the editor's formatting markup |

Closing bracket keys are aliases (`i)` equals `i(`, etc.). Counts select outer
nested pairs (`2ci(`); repeated objects in Visual mode also expand outward.
Try `ci"` to change quoted text, `da(` to remove a parenthesised section, or
`viw` then `y` to copy a word. Rich-text paragraph objects use the editor's
actual paragraph/heading/list-item blocks; plain-text fallback paragraphs are
groups of nonblank lines. These are practical text objects, not a full emulation
of Vim's configurable sentence/paragraph rules or syntax-aware tag parsing.

In rich-text notes, a line means a logical paragraph or an explicit hard-break
line, not a visually wrapped screen line. `o` / `O` insert a clean empty line
below / above without moving the original trailing text. Inside simple lists,
they create a sibling list item. Native editor transactions preserve the
remaining formatting and make edits available to Zotero's undo and save flow.
Insert mode passes `Ctrl+Backspace` through to the editor; `Ctrl+h` / `Ctrl+l`
remain explicit pane-focus shortcuts. `<space>bj` is also available in Normal
mode to choose a tab directly.

Turning off note editor Vim mode restores native note input. Main-window
navigation shortcuts, including Backspace (parent collection), do not intercept
keys while typing in a note tab or the side-panel note editor.

Absolute line numbers are shown by default in the active note editor, with the
current line number highlighted. They use the same logical lines as `12G`,
`12gg` and `j` / `k`: empty paragraphs and explicit breaks count, but soft
wrapping does not add numbers. Numbers reuse the compact left margin. When a
heading-level badge is present, its number is a small, flat label below the
badge instead of taking an extra column. Only these headings reserve a little
vertical clearance if needed. In tables, each cell has a small local gutter;
numbers still follow the global document order. The gutter is UI-only and is
not part of saved notes, copied note text, exports or undo history; it is also
hidden when printing. Toggle **Show absolute line numbers in note editors**
under Settings → Zotero Vim Plus → Modes. Changes apply without restarting.
Numbering requires note Vim mode and Zotero's native editor view; older editor
fallbacks without that view keep working without a gutter.

**macOS input fix (v1.10.0):** Normal-mode motions no longer insert their command
letters, and switching into Insert does not type the `i` / `a` / `o` command.
The [issue #6 reporter confirmed the fix in note tabs and side notes](https://github.com/ZorroStardust/zotero-vim-plus/issues/6#issuecomment-5947724456).
Disabling note Vim also leaves Backspace and ordinary typing native instead of
triggering collection navigation.

This is a practical Vim-style layer over Zotero's rich-text editor, not a full
Vim engine. There is no `:` command line, substitution, Vim configuration file,
named-register system, block Visual mode or custom note-command remapping yet.
The internal yank buffer is not a full Vim register implementation.

#### Library tree navigation (left pane)

These bindings act on Zotero's native left pane (collection tree and item
list) when that pane has focus.

| Key | Action |
|-----|--------|
| `j` / `k` | Move selection down / up (collections tree and item list) |
| `gg` / `G` | Jump to the first / last row |
| `h` | In item list, move focus back to collection tree; in collection tree, collapse selected collection or jump to parent |
| `l` | In collection tree, expand selected collection; if already expanded or a leaf, move focus into item list |
| `Enter` | In collection tree, move focus into item list; in item list, open the selected item/PDF |
| `Backspace` | Jump to parent collection |
| `za` | Toggle expand/collapse for the currently selected collection row |
| `zo` | Expand the current collection row (if already open, keep it open) |
| `zc` | Collapse the current collection row (if already closed, keep it closed) |
| `R` | Expand all collections in the current library tree |
| `M` | Collapse all collections in the current library tree |

#### Main window `<space>` chords

These bindings work in the main Zotero window (not inside the reader), on
whatever has focus:

| Key | Action |
|-----|--------|
| `<space>ff` | Fuzzy picker over all items in the current library |
| `<space>fb` | Fuzzy picker over items in the current collection |
| `<space>bj` | Open tab picker |
| `<space>n` | Toggle notes layout overlay |
| `<space>e` | Focus the collection tree |
| `<space>yy` | Copy the selected item's citekey to the clipboard |
| `<space>o` | Open the selected item's PDF |
| `<space>q` | Close the active PDF tab |
| `<space>/` | Focus Zotero's search bar |
| `<space>wh` | Focus the collection tree (left pane) |
| `<space>wl` | Focus the detail pane (right pane) |
| `<space>ww` | Focus the item list (middle pane) |

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
| `*` / `#` | Search the word under the caret forward / backward |
| `n` | Jump to the next search match |
| `N` | Jump to the previous search match |
| `Escape` | Clear / close search |

Search works like Vim: press `/` to open Zotero's find bar, type your query
(results highlight as you type), then press `Enter` — focus returns to the
PDF automatically and `n` / `N` cycle through the matches while the result
counter stays visible. Press `/` again to reopen the find bar with your
previous query selected. `Escape` closes the find bar and clears the
highlights. Pressing `n` / `N` without an active search shows a hint to
search first.

In Cursor mode, `*` / `#` use the word under the text caret. In Normal mode,
where no caret is visible, they use the word nearest the centre of the PDF
viewport. The command returns to Normal mode so `n` / `N` can continue the
search.

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
| `.` | Repeat the last annotation change (highlight/note, delete or recolour) |

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
After pressing `c`, the plugin shows **hint badges** (yellow letter labels) at
sentence starts across the visible page.  Picking a sentence badge opens
**word-level hints** inside that sentence: the sentence's own badge keeps its
label, so pressing the same label again places the caret exactly at the
sentence start, and every other label places the caret at that word.

#### Hint picking

- Labels are uppercase; you type lowercase keys (matched case-insensitively).
- With more candidates than letters, labels grow to two characters.
- As you type, the consumed letters dim and non-matching badges disappear;
  a complete label — or input that uniquely matches one badge — activates
  immediately.
- `Backspace` removes the last typed letter.  `Escape` returns from word
  hints to sentence hints; another `Escape` exits to Normal mode.

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
| `f<char>` / `F<char>` | Find a character forward / backward on this visual line |
| `t<char>` / `T<char>` | Move just before / after that character |
| `*` / `#` | Search the word under the caret forward / backward |
| `2w`, `3b`, ... | Count prefix repeats the motion |

Character finds accept count prefixes (`2fa`) and any single Unicode
character. `Escape` cancels a pending `f`/`F`/`t`/`T` without leaving Cursor.

> **Multi-column papers:** text flows column by column — `j` at the bottom
> of a column wraps to the next column's first line on the same page (`k`
> back the other way), then continues into the next page's first column.
> Page headers/footers are treated as decoration and skipped: a caret never
> lands on them, so `j`/`k` cannot stall there.  `0`/`$` stay within the
> column; `h`/`l`/`w`/`b` follow the reading flow across column breaks.

#### Mode switches

| Key | Action |
|-----|--------|
| `a..z` (hint) | Pick a sentence hint, then a word hint inside it to place the caret |
| `v` | Enter Visual mode from current caret |
| `Escape` | Exit to Normal mode |

---

### Visual mode

Enter Visual mode with `v` from Normal mode.  If there is no existing text
selection, the plugin shows **hint badges** (yellow letter labels) at sentence
starts across the visible page.  Pressing a sentence label opens **word-level
hints** inside that sentence: the sentence's own badge keeps its label, so
pressing the same label again anchors the selection exactly at the sentence
start, while any other label anchors it at that word.  The selection then
grows as you press movement keys.

Hint picking works like Cursor mode: uppercase labels (type lowercase),
two-character labels when needed, typed letters dim while non-matching badges
disappear, `Backspace` steps back, and `Escape` returns from word hints to
sentence hints (then to Normal mode).

#### Selection movement

| Key | Action |
|-----|--------|
| `j` / `k` or `↓` / `↑` | Extend selection down / up by one line |
| `h` / `l` or `←` / `→` | Extend selection left / right by one character |
| `w` / `b` | Extend selection forward / backward by one word |
| `0` / `$` | Extend selection to line start / line end |
| `)` / `(` | Extend selection to next / previous sentence start |
| `}` / `{` | Extend selection to paragraph end / start |
| `iw` | Select the word under the active end (`viw` directly from Normal) |
| `i"` | Select inside the surrounding double quotes |
| `i(` / `i[` / `i{` | Select inside the nearest enclosing pair |
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
| `.` | Repeat the last annotation-changing action on the current target/selection |

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
the plugin enters Insert mode and opens **its own comment overlay** over the
PDF — a floating input box rendered inside the PDF view (the only place that
receives the OS keyboard focus, so typing and IME composition work natively).
The annotation's existing comment is pre-filled; the quoted text is shown as
context.  Zotero's own popup is not used at all.

| Key | Action |
|-----|--------|
| `Enter` | New line in the comment |
| `Escape` | Save as the official annotation comment and close the overlay → Normal mode |

The comment is also autosaved 2 seconds after the last keystroke, and `visual i`
(add note) opens the same overlay for the newly created annotation.

Zotero's own annotation popup and sidebar comment fields remain fully usable
for mouse editing: clicking into either while the overlay is open saves and
closes the overlay and hands over to the native editor (Escape inside native
editors keeps its Zotero behavior).

> **Note:** if pressing `i` shows a red `✗` status instead, the plugin writes
> detailed diagnostics to `zv-startup.log` in your Zotero profile directory
> (`%APPDATA%\Zotero\Zotero\Profiles\...` on Windows).

---

## Annotation workflow

### Creating a highlight from scratch

1. Press `v` to enter Visual mode.
2. Press the hint label shown at the desired sentence start — optionally
   refine with a second (word-level) label to anchor at an exact word —
   or press `j`/`k` to begin from the current position.
3. Extend the selection with `j`/`k`/`w`/`b`/`)`/`}`/`h`/`l`.
4. Use `o` to jump to the other end of the selection if you need to trim the
   start rather than extend the end.
5. Press `zy`/`zr`/`zg`/`zb`/`zp` to create a coloured highlight, or `za` to
   add a note.

### Navigating and editing existing annotations

1. Press `]` / `[` to move to the next / previous annotation.  The annotation
   is highlighted in the PDF viewer and the sidebar scrolls to its card.
2. Press `y` to copy the highlighted text, `yy` to copy the comment.
3. Press `i` (or `Enter`) to open the comment overlay and type a note.
   The plugin's own floating input box appears over the PDF with the comment
   pre-filled and the highlighted text quoted as context (Zotero's popup is
   not used).  Press `Enter` for a new line, `Escape` to save and return to
   Normal mode.
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
- Keys are case-sensitive (`g` and `G` differ). Prefix with `ctrl+` for Ctrl
  (or Cmd on macOS); use the uppercase character instead of `shift+`.
- Multi-key sequences such as `gg`, `zy`, or `yy` are supported.
- Click **+ Add binding** to add a new row; click **×** and then **Apply
  bindings** to truly unbind it, including a default key.
- Click **Apply bindings** to save keybinding changes.
- Duplicate mode+key rows and invalid key notation are marked inline and never
  overwrite the last working configuration.
- Highlight colour, mode, marks and scroll settings save automatically on change.
- Visual, Cursor, Insert and note-editor modes can each be enabled or disabled
  under **Modes**. Note editing commands remain fixed and are not in this table.
- Note editor Vim mode can be turned on or off independently from the Preferences panel.
- Click **Reset to defaults** to restore all bindings to their defaults.

The preferences pane is registered with a stable pane id, so the panel opens
directly on the last-used section even after a restart, and its dropdowns use
native Zotero `menulist` controls to stay reliable on every open. Init
failures are reported to `zv-startup.log` in the profile directory with
`[prefs]`-prefixed lines.

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
| `navigateBack` | Go to the previous reading position |
| `navigateForward` | Go to the next reading position |
| `scrollTop` | Reposition view so current page is at top |
| `scrollCenter` | Reposition view so current page is centred |
| `scrollBottom` | Reposition view so current page is at bottom |
| `prevPage` | Previous page |
| `nextPage` | Next page |
| `firstPage` | First page |
| `lastPage` | Last page |
| `openSearch` | Open find bar |
| `findNext` | Jump to next search match |
| `findPrevious` | Jump to previous search match |
| `searchWordForward` | Search the word under the caret forward |
| `searchWordBackward` | Search the word under the caret backward |
| `repeatLastChange` | Repeat the last annotation-changing action |
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
| `visualInnerWord` | Select the inner word |
| `visualInnerDoubleQuote` | Select inside double quotes |
| `visualInnerParen` | Select inside parentheses |
| `visualInnerBracket` | Select inside square brackets |
| `visualInnerBrace` | Select inside braces |
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
| `cursorFindForward` | Find a character forward on the current line |
| `cursorFindBackward` | Find a character backward on the current line |
| `cursorTillForward` | Move before a character forward on the current line |
| `cursorTillBackward` | Move after a character backward on the current line |
| `cursorToVisual` | Enter Visual mode from current caret |
| `mainTabPick` | Open tab picker for currently open Zotero tabs |
| `mainNotesLayout` | Toggle notes layout overlay (left list + right preview) |
| `mainFuzzyAll` | Open fuzzy picker over all items in the current library |
| `mainFuzzyCollection` | Open fuzzy picker over items in the current collection |
| `mainYankCitekey` | Copy the selected item's citekey to the clipboard |
| `mainOpenPDF` | Open the selected item's PDF |
| `mainClosePDF` | Close the active PDF tab |
| `mainPrevTab` | Switch to the previous open tab |
| `mainNextTab` | Switch to the next open tab |
| `mainFocusTree` | Focus the collection tree (left pane) |
| `mainFocusItems` | Focus the item list (middle pane) |
| `mainFocusLeft` | Focus the collection tree (left pane) |
| `mainFocusRight` | Focus the detail pane (right pane) |
| `mainFocusSearch` | Focus Zotero's search bar |
| `mainNavDown` | Move selection down (collections tree / item list) |
| `mainNavUp` | Move selection up (collections tree / item list) |
| `mainNavFirst` | Jump to the first row |
| `mainNavLast` | Jump to the last row |
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
| Note editor Vim mode | on | Enable Vim-style editing in library notes, reader-side notes and note tabs |
| Note editor line numbers | on | Absolute logical line numbers with the current number highlighted; requires note Vim mode |
| Reader page progress | Briefly after navigation | `12/34 · 35%` in the mode indicator; can be Off, transient, or always visible |
| Scroll mode | Constant-speed scrolling | Step / Constant-speed / Accelerating — only the active mode's parameters are shown |
| Scroll step | 60 px | Pixels scrolled per `j`/`k`/`H`/`L` keypress (step mode; count prefixes like `3j` always use this) |
| Scroll speed | 2000 px/s | Constant hold-scroll speed (constant-speed mode) |
| Smooth initial speed | 2000 px/s | Starting speed for hold-based smooth scrolling (accelerating mode) |
| Smooth max speed | 2000 px/s | Maximum hold-scroll speed (accelerating mode) |
| Smooth acceleration | 2600 px/s² | Speed increase while holding a scroll key (accelerating mode) |
| Smooth deceleration | 4200 px/s² | Speed decrease after key release (accelerating mode) |
| Stop on release | off | If enabled, stop immediately when key is released (accelerating mode) |
| Persist marks | off | Save marks in the parent item's Extra field (`zv-marks-<attachmentKey>`) so they survive restarts and sync |
| Default highlight colour | Yellow | Colour used when no explicit colour key is pressed |

Scroll settings save automatically on change.

- **Step scrolling** moves instantly by the scroll step per `j`/`k`/`H`/`L` press.
- **Constant-speed scrolling** glides at a fixed speed while a scroll key is
  held and stops immediately on release.
- **Accelerating (trapezoid curve) scrolling** ramps from `initial speed` to
  `max speed` while held, then decelerates after release (unless *stop on
  release* is enabled). With `initial speed` and `max speed` both set to
  `2000`, it behaves like the constant-speed mode with a gentle glide on
  release.

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

---

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
