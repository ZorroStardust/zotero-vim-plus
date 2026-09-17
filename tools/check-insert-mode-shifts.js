/* global require, __dirname, process, console */
// Run with: node tools/check-insert-mode-shifts.js
// Regression for issue #5: Shift+J / Shift+K must not switch tabs while
// the user is editing text in a note editor or annotation comment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'content/zoteroVim.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'content/zoteroVimMain.js'), 'utf8');

const context = vm.createContext({
  Zotero: {
    Reader: { getByTabID: () => null },
    debug() {},
  },
});
vm.runInContext(core, context);
vm.runInContext(main, context);
const plugin = context.ZoteroVim;
plugin._readerState = new Map();

function makeReader(id, activeTag, mode, opts = {}) {
  const activeElement = {
    tagName: activeTag,
    isContentEditable: !!opts.contentEditable,
  };
  // By default the PDF.js iframe is in the same state as the reader.html
  // iframe — most tests care about one or the other but not both.  Tests that
  // care about the plugin's overlay textarea specifically pass opts.pdfTag.
  const pdfActive = opts.pdfTag ? {
    tagName: opts.pdfTag,
    isContentEditable: !!opts.pdfContentEditable,
  } : activeElement;
  const reader = {
    _instanceID: id,
    _iframeWindow: { document: { activeElement } },
    _internalReader: {
      _primaryView: { _iframeWindow: { document: { activeElement: pdfActive } } },
      _secondaryView: { _iframeWindow: { document: { activeElement: pdfActive } } },
    },
  };
  plugin._readerState.set(id, { mode });
  return reader;
}

let pass = 0;
function check(label, fn) {
  fn();
  pass++;
  console.log('  ok  ' + label);
}

// (1) Side-panel note editor — plugin-tracked insert mode
check('side-panel note editor insert mode is editing', () => {
  assert.equal(
    plugin._isMainTextEditing({}, { _contextNoteMode: 'insert' }),
    true);
});

// (2) Side-panel note editor — native focus on contenteditable, mode still 'normal'
//     (user clicked into the editor without pressing 'i' first)
check('side-panel note editor with contenteditable focus is editing', () => {
  const noteDoc = { activeElement: { tagName: 'DIV', isContentEditable: true } };
  assert.equal(
    plugin._isMainTextEditing({}, {
      _contextNoteMode: 'normal',
      _contextNoteEditorDoc: noteDoc,
    }),
    true);
});

// (3) Side-panel note editor — mode 'normal' and focus on body (not editing)
check('side-panel note editor with body focus is not editing', () => {
  const noteDoc = { activeElement: { tagName: 'BODY', isContentEditable: false } };
  assert.equal(
    plugin._isMainTextEditing({}, {
      _contextNoteMode: 'normal',
      _contextNoteEditorDoc: noteDoc,
    }),
    false);
});

// (4) Reader annotation comment — Zotero native textarea, mode 'normal'
//     (THIS IS THE BUG SCENARIO FROM THE USER'S TEST)
context.Zotero.Reader.getByTabID = () => makeReader('r1', 'TEXTAREA', 'normal');
check('reader textarea + normal mode is editing (no insert mode needed)', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't1' } }, {}),
    true);
});

// (5) Reader annotation comment — plugin overlay textarea, mode 'insert'.
//     The plugin's overlay textarea lives in the PDF.js iframe, NOT
//     reader.html — so reader.html's activeElement is 'BODY'.  Issue #5
//     regression: this case was previously NOT caught.
context.Zotero.Reader.getByTabID = () => makeReader('r2', 'BODY', 'insert', { pdfTag: 'TEXTAREA' });
check('plugin comment overlay textarea (PDF.js iframe) + insert mode is editing', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't2' } }, {}),
    true);
});

// (5b) Same as above but mode is 'normal' — clicking directly into the
//      plugin overlay (which the plugin auto-opens) without state.mode
//      being 'insert' yet.
context.Zotero.Reader.getByTabID = () => makeReader('r2b', 'BODY', 'normal', { pdfTag: 'TEXTAREA' });
check('plugin overlay textarea (PDF.js iframe) + normal mode is editing', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't2b' } }, {}),
    true);
});

// (6) Reader annotation comment — contenteditable span
context.Zotero.Reader.getByTabID = () =>
  makeReader('r3', 'DIV', 'normal', { contentEditable: true });
check('reader contenteditable + normal mode is editing', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't3' } }, {}),
    true);
});

// (7) Reader in normal mode, focus is on PDF body — NOT editing
context.Zotero.Reader.getByTabID = () => makeReader('r4', 'BODY', 'normal');
check('reader normal mode with focus on body is not editing', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't4' } }, {}),
    false);
});

// (8) Reader insert mode but focus on body (defensive) — NOT editing
context.Zotero.Reader.getByTabID = () => makeReader('r5', 'BODY', 'insert');
check('reader insert mode with focus on body is not editing', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't5' } }, {}),
    false);
});

// (9) No reader for current tab — NOT editing
context.Zotero.Reader.getByTabID = () => null;
check('no reader is not editing', () => {
  assert.equal(
    plugin._isMainTextEditing({ Zotero_Tabs: { selectedID: 't6' } }, {}),
    false);
});

// (10) No Zotero_Tabs on the window — NOT editing (defensive)
check('no Zotero_Tabs is not editing', () => {
  assert.equal(
    plugin._isMainTextEditing({}, {}),
    false);
});

console.log('Insert-mode shift+J/K guard checks passed (' + pass + ' cases).');