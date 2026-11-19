---
lang: en
guide_key: shortcuts
---
# Look up and customize shortcuts

[Documentation](../README.md) · [简体中文](../zh-CN/shortcuts.md)

## Look up your current bindings

1. Focus the library, PDF reader, or a note in Note Normal mode.
2. Press `Space`, release it, then press `/`. Search by key, action, or mode.
   The reference reflects remaps and unbindings. Press `Esc` to return.
3. To discover a chord while working, press `Space` and pause. The Spacekeys
   hint shows the continuations available in that area.

## Common default keys

| Focus | Keys | Result |
| --- | --- | --- |
| PDF in Normal mode | `j` / `k`, `h` / `l` | Scroll, or jump to the previous / next page |
| PDF in Normal mode | `/`, `Space f h` | Search PDF text, or search outline headings |
| PDF in Normal mode | `Space r t`, then `f` | Open [PDF themes](read-pdfs.md#change-the-pdf-reading-theme) and type a hint to apply a theme |
| PDF or sidebar Note Normal | `Space r n` | Toggle the reader’s notes sidebar |
| PDF in Normal mode | `v`, `c` | Enter Visual mode for a selection, or Cursor mode to move a text caret |
| PDF in Visual mode | `y`, `zy` | Copy the selection, or highlight it in yellow |
| Library item list | `j` / `k`, `Enter` | Move the selection, or open the selected item |
| Library item list | `/`, `Space f f` | Open Zotero's quick search, or the plugin's library item picker |
| Library collection tree | `/` | Filter collections or open the collection picker on older Zotero versions |
| Note Normal | `i`, `/`, `viw` | Start typing, search the note, or select the word at the cursor |

## Change a binding

1. Open Zotero's settings and go to **Zotero Vim Plus → Keybindings**.
2. Find the action in the context you want to change. Edit the key cell, or
   add a binding. Keys are case-sensitive. Write `G` for uppercase G and
   `<space>ff` for a Space chord.
3. Click **Apply bindings**. To unbind a shortcut, remove its row with **×**
   and click **Apply bindings**.
4. Open the shortcut reference to confirm the change. If you reassigned
   `Space /`, use its new binding or check the settings table.

Note editing commands such as `ci"` use fixed bindings. To disable Note Vim,
use the **Notes** tab. To enable or disable PDF modes, use the **Reader** tab.

For the library’s search, tagging, and reading lists, see the
[library guide](manage-library.md). For the PDF and note meanings of
`Shift+V`, see [Flash](annotate-pdfs.md#find-and-select-a-visible-word-with-flash)
and [note selection](edit-notes.md#find-and-select-text).

## Run commands and open settings from the keyboard

Press `:` in the library or PDF Normal mode
to open the command palette. Type an action name and press `Enter` to run the
selected command. Use `Space /` to look up bindings.

Press `Space p` in the library, PDF reader, or Note Normal mode to open the
settings overlay. Use `Shift+J` / `Shift+K` to change tabs, `Tab` to move focus,
or `f` and a hint to select a control. `Esc` leaves the current field or closes
the overlay. Apply keybinding edits with **Apply bindings**.

The **Appearance** tab previews presets and includes a **Custom** palette. Choose a
preset to change Vim Plus controls and hints, or enter six-digit hex colors
in the custom editor and choose **Apply colors**.
