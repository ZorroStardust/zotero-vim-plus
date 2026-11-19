# Select text and annotate PDFs

[Documentation](../README.md) · [简体中文](../zh-CN/annotate-pdfs.md)

Start in a PDF with selectable text. Click the PDF page and make sure the reader
is in Normal mode.

## Make a highlight

1. Press `v` to enter Visual mode. Letter hints appear at visible sentence starts.
2. Type a sentence hint to show the words in that sentence. Type the same hint
   again to start at the beginning of the sentence, or choose another hint to
   start at a specific word. Type the letters in lowercase.
3. Extend the selection with `w` / `b` by word or `j` / `k` by line.
   Press `o` to switch which end you are adjusting.
4. Press `z` then `y` to create a yellow highlight. Use `y` alone to copy the
   selected text, or `za` to highlight and open the annotation comment editor.

The indicator at the lower right shows the selected character count as you
adjust the selection and reminds you of `y` to copy, `i` to add a comment,
`z` for annotation colors, and `t` to translate.

While choosing hints, `Esc` backs up one level. When a selection is active, it
exits Visual mode. To place a text caret first, press `c` in Normal mode,
choose a hint, then press `v` from Cursor mode to start selecting there.

## Revisit an annotation

Press `]a` / `[a` in the PDF to select the next / previous annotation.
You can see the selected annotation in the PDF and in the annotation sidebar.
Press `i` or `Enter` to edit its comment. `Enter` inserts a new line in the
editor and `Esc` saves the comment and returns to Normal mode.

With an annotation selected, press `y` for its highlighted text or type `yy`
quickly for its comment. Check the selected annotation before pressing `dd`,
which deletes it. To filter the annotation sidebar by color, use `Zy` for
yellow, `Zr` for red, `Zg` for green, `Zb` for blue, or `Zp` for purple.
`Za` clears the filter.

## Find and select a visible word with Flash

With the PDF focused, press `Shift+V` (`V`)
and type part of a word or phrase visible in the current pane. Type a result's
hint letters or click its badge to select the full match. Press `Enter` to
choose the match nearest the center of the viewport. You can then extend the
selection, copy it with `y`, or highlight it with `zy`.

Press `Shift+V` again in Visual mode to move the active end of the selection
while keeping its anchor. Press `Esc` to cancel the lookup and restore the
prior selection. For a caret at the start of a match, use `Shift+C` from
Normal or Cursor mode.

Type `giw` to select the word at the active end of a PDF selection.

## Copy or translate a passage

In PDF Visual mode, press `y` to copy selected text, `yy` to copy the whole
paragraph, or `#` to search for the selection in the PDF.

To translate, install and configure [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)
with a version that provides its public translation API. Select text and press
`t`. This sends the selected text to the configured translation service.
A single word uses the dictionary when that option is enabled in Translate for
Zotero. In the popup, use `j` / `k` to scroll, `y` to copy the result, and
`Esc` to return to the selection.

## Underline and restyle annotations

In Visual mode, pause after `z` to see the
color shortcuts. Use a lowercase second key for a highlight or uppercase for
an underline. For example, `zy` makes a yellow highlight and `zY` a yellow
underline.

To select an on-screen annotation directly, press `f` in Normal mode and
type its hint.
With a highlight or underline selected, use the same color chords to change
its color or switch between highlight and underline. Press `Esc` to clear
the annotation selection.
