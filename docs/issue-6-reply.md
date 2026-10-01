Thanks for testing again and confirming that you're using macOS. I haven't
reproduced this locally yet, so I don't want to assume that macOS itself is the
cause. I've prepared a temporary diagnostic build to check where the motion
keys are being handled and why they can still insert text. **This is a
diagnostic build, not a confirmed fix.**

Could you try the attached ZIP?

1. Extract it and install `zotero-vim-plus-1.9.1pre2-diagnostics.xpi` through
   **Tools → Plugins → gear menu → Install Plugin From File…**. Restart Zotero
   and confirm the plugin name is **Zotero Vim Plus (Issue #6 Diagnostics)**,
   version **1.9.1pre2**. No uninstall or settings reset is needed.
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
