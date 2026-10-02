# Issue #6: archived candidate fix and note input diagnostics

The reporter [confirmed the fix in note tabs and side notes on October 2, 2026](https://github.com/ZorroStardust/zotero-vim-plus/issues/6#issuecomment-5947724456).
The instructions below are retained only to document the investigation.

`1.9.1pre3` was a temporary **candidate-fix build** sent for macOS testing. It adds
editor-level character-input guards and library item-pane note detection. Its
opt-in diagnostic observers only record events; they never modify notes or
cancel events themselves. The guards are part of the regular plugin code too.

## Install

1. Extract `zotero-vim-plus-issue-6-diagnostics.zip`.
2. In Zotero, open **Tools → Plugins**, then the gear menu →
   **Install Plugin From File…**, and select
   `zotero-vim-plus-1.9.1pre3-diagnostics.xpi`.
3. Restart Zotero. In the plugin list, confirm the name is
   **Zotero Vim Plus (Issue #6 Diagnostics)** and the version is **1.9.1pre3**.

The diagnostic package uses the existing add-on ID and retains the regular
update URL because Zotero requires it for installation. After testing, install
the regular XPI again and restart Zotero.

The earlier `1.9.1pre1` package omitted the mandatory update URL and was rejected
by Zotero 10 as incompatible. `1.9.1pre2` collected the original problem reports;
`1.9.1pre3` was the candidate fix subsequently confirmed by the reporter.

## Record the problem

1. Temporarily disable other third-party plugins and restart Zotero. Keep note
   Vim enabled in Zotero Vim Plus settings, and select an English keyboard
   input source (for example, ABC or U.S.).
2. Create a disposable note with two short lines, for example `abcdef` and
   `ghijkl`. Do not use an important note for this test.
3. Open it in a note tab. The **Issue #6 diagnostics** panel should be at the
   bottom-left of the main Zotero window.
4. Click **Start recording**, place the cursor between `c` and `d` in `abcdef`, and press
   **Esc**. Check whether the status says **NOTE NORMAL**. Then press `h`, `l`,
   `j`, and `k` once each, with a short pause between keys.
5. Click **Copy report**. This stops recording and copies the diagnostic report.
   Paste it into a plain-text file named `note-tab-report.txt` and attach it to
   your issue reply. In macOS TextEdit, use **Format → Make Plain Text** first.
   Say which keys moved the cursor, inserted text,
   or did both. If copying fails, the panel shows selected report text that you
   can copy manually.
6. If possible, repeat in the right-side note editor. Click **Start recording**
   again for a fresh report and save it as `side-panel-report.txt`. Say how you opened
   the side-panel editor. If this is unavailable, just send the note-tab result.

Also check these without recording, or in separate short recordings to avoid
the record limit:

- `i`, `a`, `o` and `O` enter Insert without adding the command letter. Then type
  a few characters and use Backspace; these should work normally.
- Search with `/`, type a query, then Enter or Escape. The search field must
  accept ordinary text without adding the opening `/` or an unwanted newline.
- Try Visual selection, a simple edit, and `u` / Ctrl+r (undo/redo).
- Test both a library note (select a note in the item list to show it on the
  right) and a reader-sidebar note (open Notes beside a PDF). These are different
  editor locations; say which one you tested.
- Turn note Vim off temporarily. Ordinary typing and Backspace must stay native.

Expected: Normal/Visual motions never alter the note text, except explicit Vim
editing commands. If character events still appear in a report, the guard should
cancel them before they result in `input` or a document change. An unrelated
DOM mutation from UI decorations is not itself proof of a text change.

Each recording stops automatically after 60 seconds or 450 records. Starting
a new recording clears the previous one, so save each report before restarting.
No separate Zotero Debug Output Logging is required. Do not submit a Debug ID:
we need the text copied by this diagnostic panel.

If the problem disappears with the other plugins disabled or the English input
source selected, please say so. You may then repeat with your usual input source
or re-enable plugins one at a time to identify which change brings it back.
Restore your usual input source and plugins when finished.

Please also report your macOS version, exact Zotero version, normal keyboard
input source, other plugins normally enabled, and whether Esc displayed
**NOTE NORMAL**.

## Privacy and interpretation

Recording begins only after **Start recording**. It is local, held in memory,
and is never uploaded automatically. The report contains build/platform
versions, anonymous window labels, mode and event flags, input data lengths,
and boolean document/selection changes. For plain Normal-mode `h/j/k/l`, it
identifies the command and whether later input matches that command; other
printable keys are redacted. It contains no note body, note titles, URLs, item
IDs, selection offsets, or prior clipboard contents. **Copy report** replaces
your clipboard contents with the report. Review it before sharing.

The observations distinguish an original note event from a forwarded event,
show whether the note handler actually canceled it, and reveal subsequent
`keypress`, `beforeinput`, `input` or composition events. They do not establish
that macOS is the cause without a reproduction.

## Build locally

Run `node tools/build-note-diagnostics.js` from the repository root. Node.js,
bash and zip are required for this diagnostic builder. Artifacts are generated
in `dist/note-diagnostics/`; the stable `manifest.json` remains unchanged.
