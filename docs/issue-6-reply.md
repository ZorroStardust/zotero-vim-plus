# Archived issue #6 candidate-fix reply (1.9.1pre3)

This reply was prepared before the reporter's macOS confirmation. The reporter
[confirmed the fix in both note tabs and side notes](https://github.com/ZorroStardust/zotero-vim-plus/issues/6#issuecomment-5947724456).
For current installation instructions, use the
[stable release](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest).

---

Thanks for the reports — they were very helpful. They show that the Vim motion
handler ran and canceled `keydown`, but subsequent character-input events still
inserted the same letter. The note-tab editor was correctly identified, so this
is not just an installation or mode-selection problem.

I've prepared **1.9.1pre3**, a candidate fix with the diagnostic panel retained.
It guards the later character-input events, lets the original key reach the
editor listener, and also recognizes the library's right-side note editor.
**The local checks pass, but I still need your macOS test before calling this
confirmed fixed.**

Could you try the attached ZIP?

1. Extract it and install `zotero-vim-plus-1.9.1pre3-diagnostics.xpi` through
   **Tools → Plugins → gear menu → Install Plugin From File…**. Restart Zotero
   and confirm the plugin name is **Zotero Vim Plus (Issue #6 Diagnostics)**,
   version **1.9.1pre3**. No uninstall or settings reset is needed.
2. Temporarily disable other third-party plugins and restart Zotero. Keep note
   Vim enabled and select an English keyboard input source, such as ABC or U.S.
3. Create a disposable note with two lines: `abcdef` and `ghijkl`. Open it in
   a note tab. You should see a small diagnostic panel at the bottom-left of
   the main Zotero window.
4. Click **Start recording**, place the cursor between `c` and `d`, then press
   **Esc**. Check whether the status says **NOTE NORMAL**. Press `h`, `l`, `j`,
   and `k` once each, pausing briefly between keys.
5. Click **Copy report**, paste into a plain-text file named
   `note-tab-report.txt`, and attach it here. In TextEdit, use
   **Format → Make Plain Text** first. Please say which keys moved the cursor,
   inserted text, or did both.
6. If possible, repeat in the right-side note editor, starting a fresh
   recording, and attach `side-panel-report.txt` too. Save the first report
   before starting another recording.

Also try `i`, `a`, `o`, `O`, search with `/`, Visual selection, and undo/redo.
The Insert-entry command letters should not appear in the note, while subsequent
typing and Backspace should work normally. Turning note Vim off should leave
ordinary typing and Backspace working too.

The library's right-side note editor (select a note in the item list) is separate
from the reader's Notes sidebar beside a PDF. If possible, test both and say
which one you used. Keep recordings short to avoid the record limit.

Please include your macOS and Zotero versions, usual keyboard input source,
other plugins normally enabled, and whether Esc displayed **NOTE NORMAL**.
If changing the input source or disabling other plugins makes the problem
disappear, that result is useful too.

Recording starts only when you click Start and stops after 60 seconds or 450
records. The report does not include note text, note titles, or item IDs, and
nothing is uploaded automatically. Please review the report before sharing;
there's no need to send your full Zotero debug log.

After testing, restore your usual plugins/input source and reinstall the
regular plugin XPI to remove the diagnostic panel. Thank you for helping
narrow this down!
