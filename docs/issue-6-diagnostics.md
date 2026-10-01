# Issue #6: note input diagnostics

This is a temporary **diagnostic build**, not a confirmed fix. It observes the
existing behavior without blocking extra input events or changing Vim motions.

## Install

1. Extract `zotero-vim-plus-issue-6-diagnostics.zip`.
2. In Zotero, open **Tools → Plugins**, then the gear menu →
   **Install Plugin From File…**, and select
   `zotero-vim-plus-1.9.1pre2-diagnostics.xpi`.
3. Restart Zotero. In the plugin list, confirm the name is
   **Zotero Vim Plus (Issue #6 Diagnostics)** and the version is **1.9.1pre2**.

The diagnostic package replaces the existing plugin using the same add-on ID;
you do not need to uninstall it or reset your settings. It retains the regular
update URL because Zotero requires it for installation; the current regular
release (1.9.0) is older and will not replace this test version automatically.
You can turn off automatic updates in the plugin's details while testing.
After testing, install the regular XPI again and restart Zotero.

The earlier `1.9.1pre1` package omitted the mandatory update URL and was rejected
by Zotero 10 as incompatible. Use `1.9.1pre2`, not that earlier XPI.

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
