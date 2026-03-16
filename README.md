# Zotero Vim

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
  - [Visual mode](#visual-mode)
  - [Insert mode](#insert-mode)
- [Annotation workflow](#annotation-workflow)
- [Customising keybindings](#customising-keybindings)
- [Settings](#settings)
- [Architecture notes](#architecture-notes)

---

## Features

- **Normal mode** — scroll, page-navigate, jump between annotations, copy
  annotation text, delete annotations, reposition the viewport (zt/zz/zb),
  and pan horizontally when zoomed in (`Shift+h`/`Shift+l`)
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

1. Download `zotero-vim.xpi` from the releases page (or build it yourself —
   see below).
2. Open Zotero.
3. Go to **Tools → Plugins**.
4. Click the **gear icon (⚙)** in the top-right of the Plugins window.
5. Choose **Install Plugin From File…** and select `zotero-vim.xpi`.
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

`build.sh` zips the plugin source into `zotero-vim.xpi`. No build tools or
package managers are required — only `zip` (available by default on macOS and
most Linux distributions).

```
zotero-vim/
├── manifest.json          Plugin manifest (ID, version, Zotero version range)
├── bootstrap.js           Lifecycle hooks (startup/shutdown/window events)
├── build.sh               Builds zotero-vim.xpi
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
| **Visual** | `-- VISUAL --` | Text selection and annotation creation |
| **Insert** | `-- INSERT --` | Passthrough — all keys go to Zotero |

Mode transitions:

```
Normal ──v──▶ Visual ──v/Escape──▶ Normal
Normal ──i──▶ Insert ──Escape────▶ Normal
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
| `i` | Enter Insert mode |

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
| `za` | Add a **note** annotation |

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
| `enterInsert` | Enter Insert mode (also focuses comment if annotation selected) |
| `exitMode` | Return to Normal mode |
| `extendDown` | Extend selection down one line |
| `extendUp` | Extend selection up one line |
| `extendLeft` | Extend selection left one character |
| `extendRight` | Extend selection right one character |
| `extendWordForward` | Extend selection to next word |
| `extendWordBackward` | Extend selection to previous word |
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

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Visual mode | on | Allow entering Visual mode with `v` |
| Enable Insert mode | on | Allow entering Insert mode with `i` |
| Scroll step | 60 px | Pixels scrolled per `j`/`k`/`H`/`L` keypress |
| Smooth scrolling | on | Enable smooth scrolling behavior in the reader |
| Smooth initial speed | 320 px/s | Starting speed for hold-based smooth scrolling |
| Smooth max speed | 2400 px/s | Maximum hold-scroll speed |
| Smooth acceleration | 2600 px/s² | Speed increase while holding a scroll key |
| Smooth deceleration | 4200 px/s² | Speed decrease after key release |
| Stop on release | off | If enabled, stop immediately when key is released |
| Default highlight colour | Yellow | Colour used when no explicit colour key is pressed |

Scroll settings are staged and only saved when you click **Apply configuration**.

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
