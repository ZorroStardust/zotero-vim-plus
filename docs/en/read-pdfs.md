# Read and navigate PDFs

[Documentation](../README.md) · [简体中文](../zh-CN/read-pdfs.md)

Click the PDF page to focus the reader. Use Normal mode for the commands below.
If a search box, outline, or note is active, close it or click the PDF again
before entering a reader command.

## Move through a paper

| Keys | Result |
| --- | --- |
| `j` / `k` | Scroll down / up |
| `Ctrl+d` / `Ctrl+u` | Scroll half a page down / up |
| `h` / `l` | Go to the previous / next page |
| `gg` / `G` | Go to the first / last page |
| `5G` | Go to page 5 |
| `Ctrl+o` / `Ctrl+i` | Go back / forward through reading positions |

Reading history records jumps such as opening an outline entry. To return to an
exact spot after scrolling, set a mark with `ma`. Jump back by typing a backtick
followed by `a`. Press `Space m` to see your marks. To keep them after restart, enable
**Persist marks** in the plugin settings. Saved marks normally go in the
parent item’s Extra field, with device-local storage as a fallback.

## Find a term or a section

- To find text, press `/`, type a query, and press `Enter`. Use `n` / `N` to move
  through matches and `Esc` to close the search.
- To find a section by title, press `Space f h`. If the PDF has an outline, the
  picker starts at your current chapter. Type part of a heading, select it,
  and press `Enter` to jump.
- To browse the outline as a tree, press `Space e`. Use `j` / `k` to move and
  `l` / `h` to expand or collapse a heading. Press `Enter` to jump or `Esc`
  to close the outline.

## Compare two parts of the same PDF

Press `Space -` to open a top/bottom split. Search or jump to a heading in the
new pane while keeping the original view available. Use `Ctrl+j` or `Ctrl+k` to
switch focus between panes. Press `Space -` again to close the split. For a
left/right split, press Space then `|` and use `Ctrl+h` / `Ctrl+l` to move
focus between the two PDF panes.

For facing pages in the focused pane, press `Space s`. Press `Space S` to
switch odd/even pairing. Page pairing follows the physical PDF order, including
cover pages.

## Follow links and find captions

In PDF Normal mode, press `f` to show
letter hints on visible links, citations, and annotations. Type the hint to
jump within the paper, select an annotation, or preview a reference or external
link. In a preview, use `Enter` to open the selected target and `Esc` to back
out. For a list of references, use `Ctrl+j` / `Ctrl+k` to move and `Space` to
mark rows. Press `y` to copy the marked references.

To find a figure or table by its caption, press `Space f g`, search by label,
caption text, or page, then press `Enter` on a match. Use these keys to move
by target in reading order:

| Previous / next | Target |
| --- | --- |
| `[f` / `]f` | Figure |
| `[t` / `]t` | Table |
| `[s` / `]s` | Outline heading |
| `[m` / `]m` | Saved Vim mark |
| `[a` / `]a` | Annotation |

While typing in PDF search, use `Ctrl+j` to toggle **Highlight all**,
`Ctrl+k` for **Match case**, or `Ctrl+l` for **Whole words**. In the PDF,
press `:` and run **Toggle body text only** to skip recognized headers,
page numbers, captions, and footnotes in Flash and keyboard selections. Run
the command again to include all selectable text.

## Change the PDF reading theme

In PDF Normal mode, press `Space r t` to open Zotero's Appearance popup.
Press `f` to show letter hints, then type a hint to apply the theme.
Press `Esc` to close the popup. To change the colors of Vim Plus panels
and hints, use [Vim Plus settings](shortcuts.md#run-commands-and-open-settings-from-the-keyboard).

## Read EPUBs and snapshots

Click inside an EPUB or web snapshot to scroll with `j` / `k`. Use `/` and
`n` / `N` to search, or `gg` / `G` to go to the beginning or end. The
keyboard text-selection and annotation workflows in this guide apply to PDFs.
