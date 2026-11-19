# Edit Zotero notes with Vim keys

[Documentation](../README.md) · [简体中文](../zh-CN/edit-notes.md)

Note Vim works in standalone note tabs, the library item pane, and the reader's
Notes sidebar. Click inside the editor and press `Esc`. Look for
**NOTE NORMAL** before entering editing commands.

## Try an edit

1. In a note, type a short line such as `Status: "draft"` in Insert mode. To start
   typing from Note Normal, press `i`.
2. Press `Esc`, then use `h` / `l` to put the cursor on a letter in `draft`.
3. Type `ci"` to clear the text inside the quotes and enter Insert mode.
   Type `reviewed` and press `Esc`. The quotes remain around the new word.

## Find and select text

- Press `/` in Note Normal, type a query, and press `Enter`. Use `n` / `N` to
  move through the matches.
- To select the word at the cursor, type `viw`. Use `y` to copy the selection or
  `Esc` to leave Visual mode.
- In the note editor, `v` selects characters and `Shift+V` (`V`) selects
  logical lines. A line that wraps on screen still counts as one logical line.
- Use `u` / `Ctrl+r` in Note Normal to undo / redo.

If the editor stays in ordinary typing mode, check **Zotero Vim Plus → Modes**
in Zotero's settings. Note Vim can be toggled independently of reader modes.
See [Troubleshooting](troubleshooting.md#vim-commands-are-typed-into-a-note) if
keys appear as text after **NOTE NORMAL** is visible.

## Find a note while reading

In the library or PDF reader, press `Space n` to open the notes layout. The
left pane lists notes for the current item and the library. The right pane
previews the selected note. Use `j` / `k` to move and `Ctrl+j` / `Ctrl+k` to
switch between the two lists. Press `Enter` to open a note, or `Shift+Enter`
to open it in a separate tab. From a PDF, `Enter` prefers the reader's
side-by-side note editor.

Press `Space r n` to toggle the reader’s notes sidebar. The
shortcut also works from **NOTE NORMAL** inside the sidebar. Closing it
returns focus to the PDF. Reopening it shows the same note if one was open.
