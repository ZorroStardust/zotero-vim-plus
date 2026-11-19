# Troubleshoot Zotero Vim Plus

[Documentation](../README.md) · [简体中文](../zh-CN/troubleshooting.md)

## The plugin does not appear after installation

In **Tools → Plugins**, check whether **Zotero Vim Plus** is listed and enabled.
Make sure you installed the XPI from the release assets. Check the Zotero version
in **Help → About Zotero** against the supported range in the
[release notes](https://github.com/ZorroStardust/zotero-vim-plus/releases).

## Keys do nothing or control the wrong area

1. Click the exact pane you want to control. For a PDF, click the page. For a
   note, click inside the editor and press `Esc` until **NOTE NORMAL** appears.
2. If a search field or popup is open, close it and try the key again.
3. Use `Space /` to check whether the command applies to that area and mode.
   If you remapped the command or the reference itself, check **Keybindings**
   in the plugin settings.
4. If letter keys still behave unexpectedly, finish any active composition
   and retry with a direct keyboard input source. Include the input source
   when reporting the issue.

## Vim commands are typed into a note

Confirm that **Zotero Vim Plus → Notes** has Note Vim enabled. If a note editor
palette is open, the first `Esc` may close the palette. Press `Esc` again and
check the mode indicator. If you see **NOTE NORMAL** and motion keys still insert
letters, include whether the note was in a separate tab, the library item pane,
or the reader sidebar in your report.

## Visual mode shows no text hints

Try `v` on a page where Zotero can select individual words with the mouse.
Scanned PDFs without a selectable text layer cannot supply text for hints.
Also check that Visual mode is enabled in the plugin’s **Reader** tab.

## A shortcut differs from the guide

Focus the pane you want to control, then press `Space /` and search by
action name. For example, `Shift+V` selects lines in a note and opens Flash
in a PDF. If Flash is unavailable, use `v` in the PDF to pick a sentence
or word by its hint.

## Report a problem

Include your Zotero and Vim Plus versions, operating system, focused pane,
mode, exact keystrokes, and what happened. Mention any remaps, input method,
or other keyboard-related plugins involved. [Open a GitHub issue](https://github.com/ZorroStardust/zotero-vim-plus/issues).
