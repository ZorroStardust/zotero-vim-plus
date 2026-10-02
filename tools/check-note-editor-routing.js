/* global require, __dirname, console */
// Run with: node tools/check-note-editor-routing.js
// Regression for issue #6: note motions must be handled in the selected note
// tab's real editor iframe so their printable keys never reach text input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'content/zoteroVim.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'content/zoteroVimMain.js'), 'utf8');

function makeEditorWindow(name) {
  const doc = {
    activeElement: null,
    body: {
      isContentEditable: false,
      getAttribute() { return null; },
    },
    designMode: 'off',
    querySelector() { return {}; },
  };
  const noteWin = {
    name,
    document: doc,
    location: { href: 'resource://zotero/note-editor/editor.html' },
  };
  doc.defaultView = noteWin;
  return noteWin;
}

const selectedWin = makeEditorWindow('selected');
const focusedWin = makeEditorWindow('focused-other');
const contextWin = makeEditorWindow('context');
const editorInstance = { _iframeWindow: selectedWin };
const context = vm.createContext({
  Services: { focus: { focusedWindow: focusedWin } },
  Zotero: {
    Reader: { getByTabID: () => null },
    Notes: { getByTabID: tabID => tabID === 'note-1' ? editorInstance : null },
    debug() {},
  },
});
vm.runInContext(core, context);
vm.runInContext(main, context);
const plugin = context.ZoteroVim;

function makeMainWindow(type = 'note') {
  return {
    document: { querySelectorAll() { return []; } },
    Zotero_Tabs: {
      selectedID: 'note-1',
      selectedType: type,
      _tabs: [{ id: 'note-1', type }],
    },
    ZoteroContextPane: {
      collapsed: false,
      context: { mode: 'notes' },
      activeEditor: { _editorInstance: { _iframeWindow: contextWin } },
    },
  };
}

let pass = 0;
function check(label, fn) {
  fn();
  pass++;
  console.log('  ok  ' + label);
}

check('selectedType identifies a standalone note tab', () => {
  assert.equal(plugin._isStandaloneNoteTabSelected(makeMainWindow()), true);
  assert.equal(plugin._isStandaloneNoteTabSelected(makeMainWindow('reader')), false);
});

check('Zotero.Notes resolves the selected note iframe before focused-window guesses', () => {
  assert.equal(plugin._getActiveStandaloneNoteEditorWindow(makeMainWindow()), selectedWin);
});

check('selected note tab wins over the context-pane editor', () => {
  assert.equal(plugin._getActiveMainNoteEditorWindow(makeMainWindow()), selectedWin);
});

check('loading note tab does not fall back to a different editor', () => {
  const getByTabID = context.Zotero.Notes.getByTabID;
  context.Zotero.Notes.getByTabID = () => null;
  assert.equal(plugin._getActiveMainNoteEditorWindow(makeMainWindow()), null);
  context.Zotero.Notes.getByTabID = getByTabID;
});

check('context-pane editor remains active outside a note tab', () => {
  assert.equal(plugin._getActiveMainNoteEditorWindow(makeMainWindow('reader')), contextWin);
});

check('library item-pane notes are distinct from the reader context pane', () => {
  const win = makeMainWindow('library');
  win.ZoteroPane = { itemPane: { mode: 'note' } };
  const editor = { _editorInstance: { _iframeWindow: selectedWin } };
  win.document.getElementById = id => id === 'zotero-note-editor' ? editor : null;
  assert.equal(plugin._getActiveMainNoteEditorWindow(win), selectedWin);
  win.ZoteroPane.itemPane.mode = 'item';
  assert.equal(plugin._getActiveLibraryNoteEditorWindow(win), null);
  win.ZoteroPane.itemPane.mode = 'note';
  editor.hidden = true;
  assert.equal(plugin._getActiveLibraryNoteEditorWindow(win), null);
});

check('older library notes require real editor focus when pane mode is unavailable', () => {
  const win = makeMainWindow('library');
  const editor = { _iframe: { contentWindow: selectedWin } };
  win.ZoteroPane = { itemPane: {} };
  win.document.getElementById = id => id === 'zotero-note-editor' ? editor : null;
  assert.equal(plugin._getActiveLibraryNoteEditorWindow(win), null);
  win.document.activeElement = editor._iframe;
  assert.equal(plugin._getActiveLibraryNoteEditorWindow(win), selectedWin);
});

check('main-window forwarding does not execute a note motion a second time', () => {
  const win = makeMainWindow();
  const state = {
    pickerOpen: false,
    notesLayoutOpen: false,
    _contextNoteMode: 'normal',
    _contextNoteEditorWin: null,
    _contextNoteEditorDoc: null,
  };
  let handled = 0;
  const originalNoteKeyDown = plugin._onMainContextNoteKeyDown;
  plugin.isNoteEditorVimEnabled = () => true;
  plugin._syncMainContextNoteListener = (_win, winState) => {
    winState._contextNoteEditorWin = selectedWin;
    winState._contextNoteEditorDoc = selectedWin.document;
  };
  plugin._onMainContextNoteKeyDown = () => { handled++; };

  const event = {
    view: win,
    target: { ownerDocument: win.document },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
  plugin._onMainKeyDown(event, win, state);
  plugin._onMainContextNoteKeyDown = originalNoteKeyDown;
  assert.equal(handled, 0);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

check('chrome capture lets original note events reach the editor without canceling them', () => {
  const win = makeMainWindow();
  const state = { _contextNoteMode: 'normal',
    _contextNoteEditorWin: selectedWin, _contextNoteEditorDoc: selectedWin.document };
  const event = {
    key: 'h', view: selectedWin, target: { ownerDocument: selectedWin.document },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
  plugin._onMainKeyDown(event, win, state);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, undefined);
  assert.equal(event._zvContextNoteHandled, undefined);
});

check('normal mode cancels the original event before executing a motion', () => {
  const state = { _contextNoteMode: 'normal' };
  const event = {
    target: { ownerDocument: selectedWin.document },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
  };
  plugin._keyString = () => 'h';
  plugin._syncNoteCursorVisualState = () => {};
  plugin._handleMainContextNoteNormalKey = (received) => {
    assert.equal(received.defaultPrevented, true);
    assert.equal(received.immediatePropagationStopped, true);
    return true;
  };
  plugin._onMainContextNoteKeyDown(event, makeMainWindow(), state);
  assert.equal(event.defaultPrevented, true);
});

check('insert mode still passes printable keys through untouched', () => {
  const state = { _contextNoteMode: 'insert' };
  const event = {
    target: { ownerDocument: selectedWin.document },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
  };
  plugin._keyString = () => 'h';
  plugin._onMainContextNoteKeyDown(event, makeMainWindow(), state);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.immediatePropagationStopped, undefined);
});

console.log('Note editor routing checks passed (' + pass + ' cases).');
